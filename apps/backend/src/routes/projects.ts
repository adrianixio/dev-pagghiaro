/**
 * Project CRUD + bulk lifecycle routes
 *
 * GET    /api/projects
 * POST   /api/projects
 * GET    /api/projects/:projectId
 * PATCH  /api/projects/:projectId
 * DELETE /api/projects/:projectId
 *
 * GET    /api/projects/:projectId/states        — all service runtime states
 * POST   /api/projects/:projectId/start-all
 * POST   /api/projects/:projectId/stop-all
 * POST   /api/projects/:projectId/restart-all
 *
 * NOTE: Elysia matches routes in registration order. The parameterised
 * /:projectId handler must come AFTER all literal sub-paths so that
 * /api/projects/:projectId/states is not swallowed by /:projectId.
 * We achieve this by using full absolute paths (no prefix shorthand) and
 * registering specific paths before the catch-all param routes.
 */

import { Elysia, t } from "elysia";
import { randomUUID } from "node:crypto";
import type {
  BulkOperationResult,
  CreateProjectBody,
  ServiceState,
  UpdateProjectBody,
} from "@dev-pagghiaro/shared";
import {
  addProject,
  getProject,
  getProjects,
  removeProject,
  updateProject,
} from "../config-store";
import { processManager } from "../process-manager";
import { reloadProjectProcessContext } from "../process-context";
import { runOrderedProjectOperation } from "../project-execution";

// ─── Validation schemas ───────────────────────────────────────────────────────

const CreateProjectSchema = t.Object({
  name: t.String({ minLength: 1 }),
  rootPath: t.String({ minLength: 1 }),
  executionOrder: t.Optional(
    t.Object({
      serviceIds: t.Array(t.String()),
      delayMs: t.Optional(t.Number({ minimum: 0 })),
    })
  ),
});

const UpdateProjectSchema = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  rootPath: t.Optional(t.String({ minLength: 1 })),
  executionOrder: t.Optional(
    t.Object({
      serviceIds: t.Array(t.String()),
      delayMs: t.Optional(t.Number({ minimum: 0 })),
    })
  ),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildBulkResult(
  projectId: string,
  results: ServiceState[]
): BulkOperationResult {
  return {
    projectId,
    results,
    succeeded: results.filter((s) => s.status !== "error").length,
    failed: results.filter((s) => s.status === "error").length,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────
// Routes are registered with full paths (no prefix) so Elysia's router can
// distinguish /api/projects/:id/states from /api/projects/:id correctly.

export const projectsRouter = new Elysia()

  // ── Collection ──────────────────────────────────────────────────────────────

  .get("/api/projects", async () => {
    return getProjects();
  })

  .post(
    "/api/projects",
    async ({ body, set }) => {
      const payload = body as CreateProjectBody;
      const project = {
        id: randomUUID(),
        name: payload.name,
        rootPath: payload.rootPath,
        services: [],
        executionOrder: payload.executionOrder,
        createdAt: new Date().toISOString(),
      };
      await addProject(project);
      set.status = 201;
      return project;
    },
    { body: CreateProjectSchema }
  )

  // ── Sub-resource routes BEFORE /:projectId to avoid param swallowing ────────

  .get("/api/projects/:projectId/states", async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: "NOT_FOUND", message: "Project not found" };
    }
    return project.services.map((s) => {
      return (
        processManager.getState(s.id) ?? {
          serviceId: s.id,
          projectId: params.projectId,
          status: "stopped" as const,
        }
      );
    });
  })

  .post("/api/projects/:projectId/start-all", async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: "NOT_FOUND", message: "Project not found" };
    }
    const results = await runOrderedProjectOperation(project, params.projectId, 'start');
    return buildBulkResult(params.projectId, results);
  })

  .post("/api/projects/:projectId/stop-all", async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: "NOT_FOUND", message: "Project not found" };
    }
    const settled = await Promise.allSettled(
      project.services.map((s) => processManager.stop(s.id))
    );
    const results: ServiceState[] = settled.map((r, i) => {
      const svc = project.services[i];
      if (r.status === "fulfilled" && r.value) return r.value;
      return {
        serviceId: svc?.id ?? "",
        projectId: params.projectId,
        status: "stopped" as const,
      };
    });
    return buildBulkResult(params.projectId, results);
  })

  .post("/api/projects/:projectId/restart-all", async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: "NOT_FOUND", message: "Project not found" };
    }
    const results = await runOrderedProjectOperation(project, params.projectId, 'restart');
    return buildBulkResult(params.projectId, results);
  })

  .post("/api/projects/:projectId/reload-context", async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: "NOT_FOUND", message: "Project not found" };
    }

    await reloadProjectProcessContext(project);

    const activeServices = project.services.filter((service) => {
      const status = processManager.getState(service.id)?.status;
      return status === 'running' || status === 'restarting';
    });

    const results = await Promise.all(
      activeServices.map((service) =>
        processManager.restart(params.projectId, service, project.rootPath)
      )
    );

    return {
      projectId: params.projectId,
      reloadedAt: new Date().toISOString(),
      restartedServiceIds: results.map((result) => result.serviceId),
      runningServices: results.length,
    };
  })

  // ── Single project CRUD (registered after sub-resource routes) ──────────────

  .get("/api/projects/:projectId", async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: "NOT_FOUND", message: "Project not found" };
    }
    return project;
  })

  .patch(
    "/api/projects/:projectId",
    async ({ params, body, set }) => {
      const patch = body as UpdateProjectBody;
      const updated = await updateProject(params.projectId, patch);
      if (!updated) {
        set.status = 404;
        return { error: "NOT_FOUND", message: "Project not found" };
      }
      return updated;
    },
    { body: UpdateProjectSchema }
  )

  .delete("/api/projects/:projectId", async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (project) {
      await Promise.allSettled(
        project.services.map((s) => processManager.stop(s.id))
      );
    }
    const removed = await removeProject(params.projectId);
    if (!removed) {
      set.status = 404;
      return { error: "NOT_FOUND", message: "Project not found" };
    }
    set.status = 204;
    return null;
  });

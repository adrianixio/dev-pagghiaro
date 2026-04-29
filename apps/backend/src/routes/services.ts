import type { CreateServiceBody, UpdateServiceBody } from '@dev-pagghiaro/shared';
import { Elysia, t } from 'elysia';
import { randomUUID } from 'node:crypto';
import { watchRegistry } from '../debug/watch-registry';
import {
  addService,
  getProject,
  getService,
  removeService,
  updateService,
} from '../config-store';
import { logBus } from '../log-bus';
import { metricsCollector } from '../metrics-collector';
import { killProcessesListeningOnPort } from '../port-processes';
import { processManager } from '../process-manager';

const CreateServiceSchema = t.Object({
  name: t.String({ minLength: 1 }),
  command: t.String({ minLength: 1 }),
  cwd: t.String({ minLength: 1 }),
  env: t.Optional(t.Record(t.String(), t.String())),
  autoStart: t.Optional(t.Boolean()),
  port: t.Optional(t.Nullable(t.Number())),
  color: t.Optional(t.String()),
  debug: t.Optional(t.Boolean()),
  persistDebugWatches: t.Optional(t.Boolean()),
});

const UpdateServiceSchema = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  command: t.Optional(t.String({ minLength: 1 })),
  cwd: t.Optional(t.String({ minLength: 1 })),
  env: t.Optional(t.Record(t.String(), t.String())),
  autoStart: t.Optional(t.Boolean()),
  port: t.Optional(t.Nullable(t.Number())),
  color: t.Optional(t.String()),
  debug: t.Optional(t.Boolean()),
  persistDebugWatches: t.Optional(t.Boolean()),
});

const BASE = '/api/projects/:projectId/services';

export const servicesRouter = new Elysia()
  .get(BASE, async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Project not found' };
    }
    return project.services;
  })
  .post(
    BASE,
    async ({ params, body, set }) => {
      const project = await getProject(params.projectId);
      if (!project) {
        set.status = 404;
        return { error: 'NOT_FOUND', message: 'Project not found' };
      }

      const payload = body as CreateServiceBody;
      const service = {
        id: randomUUID(),
        name: payload.name,
        command: payload.command,
        cwd: payload.cwd,
        ...(payload.env !== undefined ? { env: payload.env } : {}),
        ...(payload.autoStart !== undefined ? { autoStart: payload.autoStart } : {}),
        ...(payload.port != null ? { port: payload.port } : {}),
        ...(payload.color !== undefined ? { color: payload.color } : {}),
        ...(payload.debug !== undefined ? { debug: payload.debug } : {}),
        ...(payload.persistDebugWatches !== undefined
          ? { persistDebugWatches: payload.persistDebugWatches }
          : {}),
      };

      const created = await addService(params.projectId, service);
      if (!created) {
        set.status = 500;
        return { error: 'INTERNAL', message: 'Failed to persist service' };
      }

      set.status = 201;
      return created;
    },
    { body: CreateServiceSchema }
  )
  .post(`${BASE}/:serviceId/start`, async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Project not found' };
    }

    const service = project.services.find((entry) => entry.id === params.serviceId);
    if (!service) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }

    return processManager.start(params.projectId, service, project.rootPath);
  })
  .post(`${BASE}/:serviceId/stop`, async ({ params, set }) => {
    const state = await processManager.stop(params.serviceId);
    if (!state) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not running' };
    }
    return state;
  })
  .post(`${BASE}/:serviceId/restart`, async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Project not found' };
    }

    const service = project.services.find((entry) => entry.id === params.serviceId);
    if (!service) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }

    return processManager.restart(params.projectId, service, project.rootPath);
  })
  .post(`${BASE}/:serviceId/kill-port`, async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Project not found' };
    }

    const service = project.services.find((entry) => entry.id === params.serviceId);
    if (!service) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }

    if (service.port == null) {
      set.status = 400;
      return { error: 'BAD_REQUEST', message: 'Service has no configured port' };
    }

    const outcome = await killProcessesListeningOnPort(service.port);
    return {
      serviceId: service.id,
      ...outcome,
    };
  })
  .post(`${BASE}/:serviceId/clear-logs`, async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project?.services.some((service) => service.id === params.serviceId)) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }

    const timestamp = logBus.clearHistory(params.serviceId);
    return { serviceId: params.serviceId, clearedAt: timestamp };
  })
  .get(`${BASE}/:serviceId/state`, ({ params }) => {
    return (
      processManager.getState(params.serviceId) ?? {
        serviceId: params.serviceId,
        projectId: params.projectId,
        status: 'stopped' as const,
      }
    );
  })
  .get(`${BASE}/:serviceId/metrics`, ({ params, set }) => {
    const metrics = metricsCollector.getLatest(params.serviceId);
    if (!metrics) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'No metrics available' };
    }
    return metrics;
  })
  .get(`${BASE}/:serviceId`, async ({ params, set }) => {
    const service = await getService(params.projectId, params.serviceId);
    if (!service) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }
    return service;
  })
  .patch(
    `${BASE}/:serviceId`,
    async ({ params, body, set }) => {
      const patch = body as UpdateServiceBody;
      const nextPatch: UpdateServiceBody = {
        ...patch,
        ...(patch.persistDebugWatches === true
          ? { debugWatches: watchRegistry.listWatches(params.serviceId) }
          : {}),
      };
      const updated = await updateService(params.projectId, params.serviceId, nextPatch);
      if (!updated) {
        set.status = 404;
        return { error: 'NOT_FOUND', message: 'Service not found' };
      }
      return updated;
    },
    { body: UpdateServiceSchema }
  )
  .delete(`${BASE}/:serviceId`, async ({ params, set }) => {
    await processManager.stop(params.serviceId);
    const removed = await removeService(params.projectId, params.serviceId);
    if (!removed) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }
    set.status = 204;
    return null;
  });

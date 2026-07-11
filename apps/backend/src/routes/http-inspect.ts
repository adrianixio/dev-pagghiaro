import { Elysia, t } from 'elysia';
import type { HttpHeader } from '@dev-pagghiaro/shared';
import { getProject } from '../config-store';
import { httpCaptureStore } from '../http-capture-store';
import { sendConsoleRequest } from '../http-console';

const BASE = '/api/projects/:projectId/services/:serviceId/http';

const SendSchema = t.Object({
  method: t.String({ minLength: 1 }),
  path: t.String({ minLength: 1 }),
  headers: t.Optional(t.Array(t.Object({ name: t.String(), value: t.String() }))),
  body: t.Optional(t.String()),
});

async function findService(projectId: string, serviceId: string) {
  const project = await getProject(projectId);
  if (!project) return { error: 'project' as const };
  const service = project.services.find((s) => s.id === serviceId);
  if (!service) return { error: 'service' as const };
  return { project, service };
}

export const httpInspectRouter = new Elysia()
  .get(BASE, async ({ params, set }) => {
    const found = await findService(params.projectId, params.serviceId);
    if ('error' in found) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: `${found.error} not found` };
    }
    return httpCaptureStore.query(params.serviceId);
  })
  .delete(BASE, async ({ params, set }) => {
    const found = await findService(params.projectId, params.serviceId);
    if ('error' in found) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: `${found.error} not found` };
    }
    httpCaptureStore.clear(params.serviceId);
    set.status = 204;
    return null;
  })
  .post(`${BASE}/send`, async ({ params, body, set }) => {
    const found = await findService(params.projectId, params.serviceId);
    if ('error' in found) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: `${found.error} not found` };
    }
    if (found.service.port == null) {
      set.status = 400;
      return { error: 'BAD_REQUEST', message: 'Service has no configured port' };
    }
    const payload = body as { method: string; path: string; headers?: HttpHeader[]; body?: string };
    return sendConsoleRequest(params.serviceId, found.service.port, {
      method: payload.method,
      path: payload.path,
      headers: payload.headers ?? [],
      ...(payload.body !== undefined ? { body: payload.body } : {}),
    });
  }, { body: SendSchema });

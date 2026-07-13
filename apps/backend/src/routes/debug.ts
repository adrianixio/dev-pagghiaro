import { Elysia } from 'elysia';
import type { DebugInfo } from '@dev-pagghiaro/shared';
import { getProject } from '../config-store';
import { processManager } from '../process-manager';
import { fetchInspectorWsUrl } from '../debug-inspector';
import { DEBUG_DEFAULT_PORT } from '../debug-options';

const BASE = '/api/projects/:projectId/services/:serviceId/debug';

async function findService(projectId: string, serviceId: string) {
  const project = await getProject(projectId);
  if (!project) return { error: 'Project' as const };
  const service = project.services.find((s) => s.id === serviceId);
  if (!service) return { error: 'Service' as const };
  return { service };
}

export const debugRouter = new Elysia()
  .get(BASE, async ({ params, set }) => {
    const found = await findService(params.projectId, params.serviceId);
    if ('error' in found) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: `${found.error} not found` };
    }
    const { service } = found;
    const port = service.debug?.port ?? DEBUG_DEFAULT_PORT;
    const enabled = service.debug?.enabled === true;
    const running = processManager.getState(params.serviceId)?.status === 'running';

    let listening = false;
    let wsUrl: string | undefined;
    if (enabled && running) {
      wsUrl = (await fetchInspectorWsUrl(port)) ?? undefined;
      listening = wsUrl != null;
    }

    const info: DebugInfo = {
      enabled,
      port,
      platform: process.platform,
      breakInSupported: process.platform !== 'win32',
      listening,
      ...(wsUrl ? { wsUrl } : {}),
    };
    return info;
  })
  .post(`${BASE}/break-in`, async ({ params, set }) => {
    const found = await findService(params.projectId, params.serviceId);
    if ('error' in found) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: `${found.error} not found` };
    }
    if (process.platform === 'win32') {
      set.status = 400;
      return { error: 'BAD_REQUEST', message: 'Break-in not supported on Windows' };
    }
    const pid = processManager.getState(params.serviceId)?.pid;
    if (pid == null) {
      set.status = 400;
      return { error: 'BAD_REQUEST', message: 'Service is not running' };
    }
    try {
      process.kill(pid, 'SIGUSR1');
      return { ok: true, port: DEBUG_DEFAULT_PORT };
    } catch (err) {
      set.status = 400;
      return { error: 'BAD_REQUEST', message: err instanceof Error ? err.message : String(err) };
    }
  });

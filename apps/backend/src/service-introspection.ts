// apps/backend/src/service-introspection.ts
import { existsSync } from 'node:fs';
import type { ProjectConfig, ServiceConfig, ServiceIntrospection, PortInfo } from '@dev-pagghiaro/shared';
import { describeServiceEnv } from './process-context';
import { resolveShellArgs } from './pty-adapter';
import { findListeningPids } from './port-processes';
import { processManager, resolveCwd } from './process-manager';
import { healthMonitor } from './health-monitor';

export async function buildServiceIntrospection(
  project: ProjectConfig,
  service: ServiceConfig
): Promise<ServiceIntrospection> {
  const resolved = resolveCwd(service.cwd, project.rootPath);
  const argv = resolveShellArgs(service.command);
  const env = await describeServiceEnv(project.rootPath, service);
  const state = processManager.getState(service.id);

  let port: PortInfo | null = null;
  if (service.port != null) {
    const pids = await findListeningPids(service.port);
    port = { configured: service.port, inUse: pids.length > 0, pids };
  }

  const uptimeMs =
    state?.status === 'running' && state.startedAt
      ? Date.now() - new Date(state.startedAt).getTime()
      : undefined;

  return {
    serviceId: service.id,
    projectId: project.id,
    cwd: { raw: service.cwd, resolved, exists: existsSync(resolved) },
    command: { raw: service.command, shell: argv[0], argv: [...argv] },
    env,
    port,
    runtime: {
      status: state?.status ?? 'stopped',
      ...(state?.pid !== undefined ? { pid: state.pid } : {}),
      ...(state?.startedAt ? { startedAt: state.startedAt } : {}),
      ...(uptimeMs !== undefined ? { uptimeMs } : {}),
      ...(state?.lastExitCode !== undefined ? { lastExitCode: state.lastExitCode } : {}),
    },
    health: healthMonitor.getHealth(service.id),
  };
}

import type { ProjectConfig, ServiceConfig, ServiceState } from '@dev-pagghiaro/shared';
import { processManager } from './process-manager';

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function getExecutionServices(project: ProjectConfig, options?: { autoStartOnly?: boolean }): ServiceConfig[] {
  const services = options?.autoStartOnly
    ? project.services.filter((service) => service.autoStart)
    : project.services;

  const configuredIds = project.executionOrder?.serviceIds;
  if (!configuredIds) {
    return services;
  }

  const availableById = new Map(services.map((service) => [service.id, service]));
  return configuredIds
    .map((serviceId) => availableById.get(serviceId))
    .filter((service): service is ServiceConfig => Boolean(service));
}

function getAutoStartServices(project: ProjectConfig): ServiceConfig[] {
  const autoStartServices = project.services.filter((service) => service.autoStart);
  const orderedIds = project.executionOrder?.serviceIds ?? [];
  const autoStartById = new Map(autoStartServices.map((service) => [service.id, service]));
  const ordered = orderedIds
    .map((serviceId) => autoStartById.get(serviceId))
    .filter((service): service is ServiceConfig => Boolean(service));

  const includedIds = new Set(ordered.map((service) => service.id));
  const remainder = autoStartServices.filter((service) => !includedIds.has(service.id));
  return [...ordered, ...remainder];
}

export async function runOrderedProjectOperation(
  project: ProjectConfig,
  projectId: string,
  operation: 'start' | 'restart'
): Promise<ServiceState[]> {
  const services = getExecutionServices(project);
  const delayMs = Math.max(0, project.executionOrder?.delayMs ?? 0);
  const results: ServiceState[] = [];

  for (let index = 0; index < services.length; index += 1) {
    const service = services[index];
    if (!service) {
      continue;
    }

    try {
      const state = operation === 'start'
        ? await processManager.start(projectId, service, project.rootPath)
        : await processManager.restart(projectId, service, project.rootPath);
      results.push(state);
    } catch {
      results.push({
        serviceId: service.id,
        projectId,
        status: 'error',
      });
    }

    if (delayMs > 0 && index < services.length - 1) {
      await wait(delayMs);
    }
  }

  return results;
}

export async function autoStartProjectServices(project: ProjectConfig): Promise<void> {
  const services = getAutoStartServices(project);
  const delayMs = Math.max(0, project.executionOrder?.delayMs ?? 0);

  for (let index = 0; index < services.length; index += 1) {
    const service = services[index];
    if (!service) {
      continue;
    }

    try {
      await processManager.start(project.id, service, project.rootPath);
    } catch {
      // keep auto-starting the remaining services
    }
    if (delayMs > 0 && index < services.length - 1) {
      await wait(delayMs);
    }
  }
}

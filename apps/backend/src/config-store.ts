/**
 * Config store - reads/writes pagghiaro.json.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  DebugWatch,
  PagghiaroConfig,
  ProjectConfig,
  ProjectExecutionOrder,
  ServiceConfig,
} from '@dev-pagghiaro/shared';

const DEFAULT_CONFIG: PagghiaroConfig = { version: '1', projects: [] };

function resolveConfigPath(): string {
  const envPath = process.env['PAGGHIARO_CONFIG_PATH'];
  if (envPath) {
    return resolve(envPath);
  }

  const candidates = [
    join(process.cwd(), 'pagghiaro.json'),
    join(import.meta.dir, '..', '..', '..', 'pagghiaro.json'),
    join(import.meta.dir, '..', '..', 'pagghiaro.json'),
  ];

  const existing = candidates.find((candidate) => existsSync(candidate));
  return existing ?? candidates[0]!;
}

const CONFIG_PATH = resolveConfigPath();

function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
}

function isHealthCheckConfig(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return (
    (c['enabled'] === undefined || typeof c['enabled'] === 'boolean') &&
    (c['path'] === undefined || typeof c['path'] === 'string') &&
    (c['intervalMs'] === undefined ||
      (typeof c['intervalMs'] === 'number' && Number.isFinite(c['intervalMs']) && c['intervalMs'] >= 0))
  );
}

function isHttpInspectConfig(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return (
    (c['enabled'] === undefined || typeof c['enabled'] === 'boolean') &&
    (c['proxyPort'] === undefined ||
      (typeof c['proxyPort'] === 'number' && Number.isFinite(c['proxyPort']) && c['proxyPort'] >= 0))
  );
}

function isDebugConfig(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    (c['enabled'] === undefined || typeof c['enabled'] === 'boolean') &&
    (c['port'] === undefined ||
      (typeof c['port'] === 'number' && Number.isFinite(c['port']) && c['port'] >= 0))
  );
}

// Ported from 3e08ce1 (debug watch stack). Validates the persisted shape of a
// single debug watch as stored on ServiceConfig.debugWatches. mode must match
// DebugWatchMode ('interval' | 'onChange') exactly - rejecting 'onChange'
// here would fail validation on the very next config read after a panel user
// creates an onChange watch, since watchRegistry.addWatch/persistWatchList
// happily writes it to disk.
function isDebugWatch(value: unknown): value is DebugWatch {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<DebugWatch>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.serviceId === 'string' &&
    typeof candidate.expr === 'string' &&
    (candidate.mode === 'interval' || candidate.mode === 'onChange') &&
    typeof candidate.intervalMs === 'number' &&
    Number.isFinite(candidate.intervalMs) &&
    typeof candidate.bufferSize === 'number' &&
    Number.isFinite(candidate.bufferSize) &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt)
  );
}

export function isServiceConfig(value: unknown): value is ServiceConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ServiceConfig>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.command === 'string' &&
    typeof candidate.cwd === 'string' &&
    isStringRecord(candidate.env) &&
    (candidate.autoStart === undefined || typeof candidate.autoStart === 'boolean') &&
    (candidate.port === undefined || typeof candidate.port === 'number') &&
    (candidate.color === undefined || typeof candidate.color === 'string') &&
    isHealthCheckConfig((candidate as { healthCheck?: unknown }).healthCheck) &&
    isHttpInspectConfig((candidate as { httpInspect?: unknown }).httpInspect) &&
    isDebugConfig((candidate as { debug?: unknown }).debug) &&
    (candidate.persistDebugWatches === undefined || typeof candidate.persistDebugWatches === 'boolean') &&
    (candidate.debugWatches === undefined ||
      (Array.isArray(candidate.debugWatches) && candidate.debugWatches.every((watch) => isDebugWatch(watch))))
  );
}

function isProjectExecutionOrder(value: unknown): value is ProjectExecutionOrder {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ProjectExecutionOrder>;
  return (
    Array.isArray(candidate.serviceIds) &&
    candidate.serviceIds.every((serviceId) => typeof serviceId === 'string') &&
    (candidate.delayMs === undefined || (typeof candidate.delayMs === 'number' && Number.isFinite(candidate.delayMs) && candidate.delayMs >= 0))
  );
}

function isProjectConfig(value: unknown): value is ProjectConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ProjectConfig>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.rootPath === 'string' &&
    typeof candidate.createdAt === 'string' &&
    isProjectExecutionOrder(candidate.executionOrder) &&
    Array.isArray(candidate.services) &&
    candidate.services.every((service) => isServiceConfig(service))
  );
}

function assertConfig(value: unknown): asserts value is PagghiaroConfig {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid pagghiaro.json: expected an object');
  }

  const candidate = value as Partial<PagghiaroConfig>;
  if (candidate.version !== '1') {
    throw new Error('Invalid pagghiaro.json: unsupported version');
  }

  if (!Array.isArray(candidate.projects) || !candidate.projects.every((project) => isProjectConfig(project))) {
    throw new Error('Invalid pagghiaro.json: invalid projects structure');
  }
}

async function readRaw(): Promise<PagghiaroConfig> {
  const file = Bun.file(CONFIG_PATH);
  const exists = await file.exists();
  if (!exists) {
    await Bun.write(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    return structuredClone(DEFAULT_CONFIG);
  }

  const rawText = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Failed to parse pagghiaro.json at ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }

  assertConfig(parsed);
  return parsed;
}

async function writeRaw(config: PagghiaroConfig): Promise<void> {
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

export async function getConfig(): Promise<PagghiaroConfig> {
  return readRaw();
}

export async function getProjects(): Promise<ProjectConfig[]> {
  const cfg = await readRaw();
  return cfg.projects;
}

export async function getProject(id: string): Promise<ProjectConfig | undefined> {
  const cfg = await readRaw();
  return cfg.projects.find((project) => project.id === id);
}

export async function addProject(project: ProjectConfig): Promise<void> {
  const cfg = await readRaw();
  cfg.projects.push(project);
  await writeRaw(cfg);
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<ProjectConfig, 'id' | 'createdAt' | 'services'>>
): Promise<ProjectConfig | undefined> {
  const cfg = await readRaw();
  const index = cfg.projects.findIndex((project) => project.id === id);
  if (index === -1) {
    return undefined;
  }

  const existing = cfg.projects[index];
  if (!existing) {
    return undefined;
  }

  const updated: ProjectConfig = { ...existing, ...patch };
  cfg.projects[index] = updated;
  await writeRaw(cfg);
  return updated;
}

export async function removeProject(id: string): Promise<boolean> {
  const cfg = await readRaw();
  const before = cfg.projects.length;
  cfg.projects = cfg.projects.filter((project) => project.id !== id);
  if (cfg.projects.length === before) {
    return false;
  }
  await writeRaw(cfg);
  return true;
}

export async function getService(projectId: string, serviceId: string): Promise<ServiceConfig | undefined> {
  const project = await getProject(projectId);
  return project?.services.find((service) => service.id === serviceId);
}

// Restored from 3e08ce1: resolves a service by id across all projects, since
// the debug watch/recording routes are keyed only by serviceId (no projectId
// in the URL). Returns the owning projectId alongside the service so callers
// can thread it into project-scoped mutators like updateService.
export async function findServiceById(
  serviceId: string
): Promise<{ projectId: string; service: ServiceConfig } | undefined> {
  const cfg = await readRaw();
  for (const project of cfg.projects) {
    const service = project.services.find((entry) => entry.id === serviceId);
    if (service) {
      return { projectId: project.id, service };
    }
  }
  return undefined;
}

export async function addService(projectId: string, service: ServiceConfig): Promise<ServiceConfig | undefined> {
  const cfg = await readRaw();
  const project = cfg.projects.find((entry) => entry.id === projectId);
  if (!project) {
    return undefined;
  }
  project.services.push(service);
  await writeRaw(cfg);
  return service;
}

export async function updateService(
  projectId: string,
  serviceId: string,
  patch: Partial<Omit<ServiceConfig, 'id'>>
): Promise<ServiceConfig | undefined> {
  const cfg = await readRaw();
  const project = cfg.projects.find((entry) => entry.id === projectId);
  if (!project) {
    return undefined;
  }

  const index = project.services.findIndex((service) => service.id === serviceId);
  if (index === -1) {
    return undefined;
  }

  const existing = project.services[index];
  if (!existing) {
    return undefined;
  }

  const updated: ServiceConfig = { ...existing, ...patch };
  if (patch.port === null) {
    delete updated.port;
  }
  project.services[index] = updated;
  await writeRaw(cfg);
  return updated;
}

export async function removeService(projectId: string, serviceId: string): Promise<boolean> {
  const cfg = await readRaw();
  const project = cfg.projects.find((entry) => entry.id === projectId);
  if (!project) {
    return false;
  }

  const before = project.services.length;
  project.services = project.services.filter((service) => service.id !== serviceId);
  if (project.services.length === before) {
    return false;
  }
  await writeRaw(cfg);
  return true;
}

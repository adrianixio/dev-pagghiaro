import { join, resolve } from 'node:path';
import type { EnvVarProvenance, ProjectConfig, ServiceConfig } from '@dev-pagghiaro/shared';

const BASE_ENV_FILES = ['.env', '.env.local'];
const DEFAULT_MODE = 'development';

export async function buildServiceProcessContext(
  projectRootPath: string,
  service: ServiceConfig
): Promise<Record<string, string>> {
  const serviceRoot = resolveServiceRoot(projectRootPath, service.cwd);
  const mode = resolveEnvMode();
  const projectEnv = await loadEnvDirectory(projectRootPath, mode);
  const serviceEnv = serviceRoot === projectRootPath ? {} : await loadEnvDirectory(serviceRoot, mode);

  return {
    ...projectEnv,
    ...serviceEnv,
    ...(service.env ?? {}),
  };
}

export async function reloadProjectProcessContext(project: ProjectConfig): Promise<void> {
  await Promise.all(project.services.map((service) => buildServiceProcessContext(project.rootPath, service)));
}

async function loadEnvFile(filePath: string): Promise<Record<string, string>> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return {};
  }
  return parseDotEnv(await file.text());
}

export async function describeServiceEnv(
  projectRootPath: string,
  service: ServiceConfig
): Promise<EnvVarProvenance[]> {
  const serviceRoot = resolveServiceRoot(projectRootPath, service.cwd);
  const mode = resolveEnvMode();
  const fileNames = getEnvFileCandidates(mode);

  // Layers low → high precedence (mirrors buildServiceProcessContext).
  const layers: Array<{ source: string; env: Record<string, string> }> = [];
  for (const fileName of fileNames) {
    layers.push({ source: `project/${fileName}`, env: await loadEnvFile(join(projectRootPath, fileName)) });
  }
  if (serviceRoot !== projectRootPath) {
    for (const fileName of fileNames) {
      layers.push({ source: `service/${fileName}`, env: await loadEnvFile(join(serviceRoot, fileName)) });
    }
  }
  layers.push({ source: 'service.env', env: service.env ?? {} });

  const map = new Map<string, { value: string; source: string; shadowed: Array<{ source: string; value: string }> }>();
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.env)) {
      const existing = map.get(key);
      if (existing) {
        existing.shadowed.push({ source: existing.source, value: existing.value });
        existing.value = value;
        existing.source = layer.source;
      } else {
        map.set(key, { value, source: layer.source, shadowed: [] });
      }
    }
  }

  return [...map.entries()].map(([key, v]) => ({ key, value: v.value, source: v.source, shadowed: v.shadowed }));
}

function resolveServiceRoot(projectRootPath: string, serviceCwd: string): string {
  if (serviceCwd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(serviceCwd)) {
    return resolve(serviceCwd);
  }

  return resolve(projectRootPath, serviceCwd);
}

function resolveEnvMode(): string {
  const value = process.env['NODE_ENV']?.trim();
  return value && value.length > 0 ? value : DEFAULT_MODE;
}

async function loadEnvDirectory(directoryPath: string, mode: string): Promise<Record<string, string>> {
  const files = getEnvFileCandidates(mode);
  const env: Record<string, string> = {};

  for (const fileName of files) {
    const filePath = resolve(directoryPath, fileName);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      continue;
    }

    Object.assign(env, parseDotEnv(await file.text()));
  }

  return env;
}

function getEnvFileCandidates(mode: string): string[] {
  const modeFiles = [`.env.${mode}`, `.env.${mode}.local`];
  const ordered = [...BASE_ENV_FILES, ...modeFiles];
  return [...new Set(ordered)];
}

function parseDotEnv(source: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const lines = source.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    const rawValue = normalized.slice(separatorIndex + 1);
    entries[key] = parseEnvValue(rawValue);
  }

  return entries;
}

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }

  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return decodeEscapes(trimmed.slice(1, -1), quote === '"');
  }

  const commentIndex = trimmed.indexOf(' #');
  const value = commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed;
  return decodeEscapes(value.trim(), true);
}

function decodeEscapes(value: string, decodeNewlines: boolean): string {
  return decodeNewlines
    ? value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    : value;
}

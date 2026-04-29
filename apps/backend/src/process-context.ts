import { resolve } from 'node:path';
import { platform } from 'node:process';
import type { ProjectConfig, ServiceConfig } from '@dev-pagghiaro/shared';

const BASE_ENV_FILES = ['.env', '.env.local'];
const DEFAULT_MODE = 'development';

// ─── Python support ───────────────────────────────────────────────────────────

const PYTHON_COMMAND_PREFIXES = [
  'python', 'python3', 'python2',
  'uvicorn', 'gunicorn', 'flask', 'fastapi',
  'django-admin', 'manage.py', './manage.py',
  'celery', 'pytest', 'py.test', 'ruff', 'mypy',
];

const VENV_CANDIDATES = ['venv', '.venv', 'env', 'virtualenv'];

function isPythonCommand(command: string): boolean {
  const firstWord = command.trim().split(/\s+/)[0] ?? '';
  // Strip leading ./ or ../
  const base = firstWord.replace(/^\.\.?\//, '');
  return PYTHON_COMMAND_PREFIXES.some(
    (prefix) => base === prefix || base.startsWith(prefix + ' ')
  );
}

async function detectVenvBinDir(serviceRoot: string): Promise<string | null> {
  const isWindows = platform === 'win32';
  const subDir = isWindows ? 'Scripts' : 'bin';
  const pythonExe = isWindows ? 'python.exe' : 'python';

  for (const candidate of VENV_CANDIDATES) {
    const pythonPath = resolve(serviceRoot, candidate, subDir, pythonExe);
    const file = Bun.file(pythonPath);
    if (await file.exists()) {
      return resolve(serviceRoot, candidate, subDir);
    }
  }
  return null;
}

async function buildPythonEnv(serviceRoot: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };

  const venvBin = await detectVenvBinDir(serviceRoot);
  if (venvBin) {
    const currentPath = process.env['PATH'] ?? '';
    const separator = platform === 'win32' ? ';' : ':';
    env['PATH'] = `${venvBin}${separator}${currentPath}`;
    env['VIRTUAL_ENV'] = resolve(venvBin, '..'); // parent of bin/Scripts
  }

  return env;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function buildServiceProcessContext(
  projectRootPath: string,
  service: ServiceConfig
): Promise<Record<string, string>> {
  const serviceRoot = resolveServiceRoot(projectRootPath, service.cwd);
  const mode = resolveEnvMode();
  const projectEnv = await loadEnvDirectory(projectRootPath, mode);
  const serviceEnv = serviceRoot === projectRootPath ? {} : await loadEnvDirectory(serviceRoot, mode);
  const pythonEnv = isPythonCommand(service.command)
    ? await buildPythonEnv(serviceRoot)
    : {};

  return {
    ...pythonEnv,
    ...projectEnv,
    ...serviceEnv,
    ...(service.env ?? {}),
  };
}

export async function reloadProjectProcessContext(project: ProjectConfig): Promise<void> {
  await Promise.all(project.services.map((service) => buildServiceProcessContext(project.rootPath, service)));
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

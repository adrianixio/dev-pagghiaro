/**
 * Detect the runtime of a service command and produce the spawn-time mutations
 * required to launch it under an inspector. Node/Bun expose a CDP WebSocket
 * (URL is parsed from stdout); Python uses debugpy's DAP listener on a
 * pre-allocated TCP port.
 */

import type { DebugLanguage } from '@dev-pagghiaro/shared';

export interface SpawnMutation {
  /** Optional command rewrite. */
  command?: string;
  /** Extra env vars to merge on top of the service env. */
  env: Record<string, string>;
}

const BUN_BINS = new Set(['bun', 'bunx']);
const NODE_BINS = new Set(['node', 'tsx', 'ts-node', 'nodemon']);
const NPM_LIKE = new Set(['npm', 'yarn', 'pnpm']);
const PY_INTERPRETERS = new Set(['python', 'python3', 'python2', 'py']);
const PY_MODULE_BINS = new Set([
  'uvicorn', 'gunicorn', 'flask', 'fastapi',
  'django-admin', 'celery', 'pytest', 'py.test', 'ruff', 'mypy',
]);

function firstWord(command: string): string {
  return command.trim().split(/\s+/)[0] ?? '';
}

function bareName(word: string): string {
  const noQuotes = word.replace(/^["']|["']$/g, '');
  const tail = noQuotes.split(/[\\/]/).pop() ?? noQuotes;
  return tail.replace(/\.exe$/i, '').toLowerCase();
}

export function detectLanguage(command: string): DebugLanguage | null {
  const head = bareName(firstWord(command));
  if (BUN_BINS.has(head)) return 'bun';
  if (NODE_BINS.has(head) || NPM_LIKE.has(head)) return 'node';
  if (PY_INTERPRETERS.has(head) || PY_MODULE_BINS.has(head)) return 'python';
  return null;
}

/** Node and tsx both honour NODE_OPTIONS, including when launched via npm. */
export function planNodeSpawn(): SpawnMutation {
  return { env: { NODE_OPTIONS: '--inspect=127.0.0.1:0' } };
}

/** Bun only reads --inspect from the CLI, so we splice the flag after `bun`. */
export function planBunSpawn(command: string): SpawnMutation {
  const trimmed = command.trim();
  const head = firstWord(trimmed);
  const rest = trimmed.slice(head.length);
  return {
    command: `${head} --inspect=127.0.0.1:0${rest}`,
    env: { BUN_INSPECT_NOTIFY: '1' },
  };
}

/**
 * Wrap a Python-style command with debugpy on a pre-allocated port. The
 * rewrite preserves whatever module/script invocation the user already wrote:
 *   - `python script.py args`     → `python -m debugpy ... script.py args`
 *   - `python -m mod args`        → `python -m debugpy ... -m mod args`
 *   - `uvicorn app:app args`      → `python -m debugpy ... -m uvicorn app:app args`
 */
export function planPythonSpawn(command: string, port: number): SpawnMutation | null {
  const trimmed = command.trim();
  const tokens = trimmed.split(/\s+/);
  const head = bareName(tokens[0] ?? '');
  if (!head) return null;

  // -X frozen_modules=off silences debugpy's "frozen modules" warning that
  // pollutes the log on every Python 3.11+ startup. Goes after `python` and
  // before `-m debugpy` so it applies to the interpreter, not debugpy.
  const debugpyPrefix = `python -X frozen_modules=off -m debugpy --listen 127.0.0.1:${port} --wait-for-client`;
  // PYDEVD_DISABLE_FILE_VALIDATION silences the second debugpy noise line.
  const debugEnv = {
    PYTHONUNBUFFERED: '1',
    PYDEVD_DISABLE_FILE_VALIDATION: '1',
  };

  if (PY_INTERPRETERS.has(head)) {
    // Drop the original interpreter token; debugpy is invoked via `python`.
    const rest = tokens.slice(1).join(' ');
    return {
      command: `${debugpyPrefix} ${rest}`.trim(),
      env: debugEnv,
    };
  }

  if (PY_MODULE_BINS.has(head)) {
    // Run the module via `-m <bin>` so debugpy attaches to the same process.
    const rest = tokens.slice(1).join(' ');
    return {
      command: `${debugpyPrefix} -m ${head}${rest ? ' ' + rest : ''}`,
      env: debugEnv,
    };
  }

  return null;
}

const INSPECTOR_URL_RE = /(ws:\/\/[^\s'"]+)/;

/** Best-effort extraction of the CDP WebSocket URL from a stdout chunk. */
export function extractInspectorUrl(chunk: string): string | null {
  const match = chunk.match(INSPECTOR_URL_RE);
  return match ? match[1] ?? null : null;
}

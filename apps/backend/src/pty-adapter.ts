/**
 * PTY Adapter - isolates all pseudoterminal concerns from the process manager.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { statSync } from 'node:fs';

interface BunSpawnOptions extends SpawnOptions {
  pty?: boolean;
}

function spawnPtyProcess(exe: string, args: string[], opts: BunSpawnOptions): ChildProcess {
  return nodeSpawn(exe, args, opts as SpawnOptions);
}

export interface PtySize {
  cols: number;
  rows: number;
}

export interface PtyHandle {
  readonly pid: number;
  write(data: string): void;
  resize(size: PtySize): void;
  kill(signal?: NodeJS.Signals | number): void;
  readonly exited: Promise<number>;
  onData(fn: (chunk: string) => void): void;
}

export interface SpawnPtyOptions {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  initialSize?: PtySize;
}

const DEFAULT_SIZE: PtySize = { cols: 220, rows: 50 };
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

export function spawnPty(opts: SpawnPtyOptions): PtyHandle {
  const size = opts.initialSize ?? DEFAULT_SIZE;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(opts.env ?? {}),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '1',
    COLUMNS: String(size.cols),
    LINES: String(size.rows),
  };

  const [exe, ...args] = resolveShellArgs(opts.command);
  const child = spawnPtyProcess(exe, args, {
    cwd: opts.cwd,
    env,
    stdio: 'pipe',
    pty: true,
  });

  if (child.pid === undefined) {
    throw new Error(`[pty-adapter] Failed to allocate PTY for: ${opts.command}`);
  }

  const pid = child.pid;
  const listeners: Array<(chunk: string) => void> = [];
  const decoder = new TextDecoder();

  const dispatchChunk = (chunk: Buffer): void => {
    const text = decoder.decode(chunk, { stream: true });
    for (const listener of listeners) {
      listener(text);
    }
  };

  child.stdout?.on('data', dispatchChunk);
  child.stderr?.on('data', dispatchChunk);

  const exited = new Promise<number>((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });

  return {
    pid,
    exited,
    write(data: string): void {
      if (child.stdin && !child.killed) {
        child.stdin.write(data);
      }
    },
    resize(newSize: PtySize): void {
      if (process.platform !== 'win32') {
        void applyUnixResize(pid, newSize);
      }
    },
    kill(signal?: NodeJS.Signals | number): void {
      try {
        if (signal !== undefined) {
          child.kill(signal as NodeJS.Signals);
        } else {
          child.kill();
        }
      } catch {
        // already gone
      }
    },
    onData(fn: (chunk: string) => void): void {
      listeners.push(fn);
    },
  };
}

async function applyUnixResize(pid: number, size: PtySize): Promise<void> {
  const tty = await getProcessTty(pid);
  if (!tty) {
    return;
  }

  const ttyPath = tty.startsWith('/dev/') ? tty : `/dev/${tty}`;
  const args = process.platform === 'darwin'
    ? ['-f', ttyPath, 'cols', String(size.cols), 'rows', String(size.rows)]
    : ['-F', ttyPath, 'cols', String(size.cols), 'rows', String(size.rows)];

  await new Promise<void>((resolve) => {
    const stty = spawnPtyProcess('stty', args, {
      stdio: ['ignore', 'ignore', 'ignore'],
      pty: false,
    });
    stty.on('exit', () => resolve());
    stty.on('error', () => resolve());
  });

  try {
    process.kill(pid, 'SIGWINCH');
  } catch {
    // process already exited
  }
}

async function getProcessTty(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    const ps = spawnPtyProcess('ps', ['-o', 'tty=', '-p', String(pid)], {
      stdio: ['ignore', 'pipe', 'ignore'],
      pty: false,
    });

    let output = '';
    ps.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    ps.on('exit', () => {
      const tty = output.trim();
      resolve(tty && tty !== '?' ? tty : null);
    });
    ps.on('error', () => resolve(null));
  });
}

function resolveShellArgs(command: string): [string, ...string[]] {
  if (process.platform === 'win32') {
    try {
      statSync(GIT_BASH);
      return [GIT_BASH, '--login', '-c', command];
    } catch {
      return ['cmd.exe', '/c', command];
    }
  }

  return ['/bin/sh', '-c', command];
}

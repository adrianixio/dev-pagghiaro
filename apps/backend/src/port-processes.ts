import { setTimeout as delay } from 'node:timers/promises';

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface PortKillOutcome {
  port: number;
  pids: number[];
  killed: number[];
  failed: Array<{ pid: number; reason: string }>;
}

export async function killProcessesListeningOnPort(port: number): Promise<PortKillOutcome> {
  const pids = await findListeningPids(port);
  const uniquePids = [...new Set(pids)].filter((pid) => pid !== process.pid);

  const killed: number[] = [];
  const failed: Array<{ pid: number; reason: string }> = [];

  for (const pid of uniquePids) {
    const result = process.platform === 'win32'
      ? await killPidWindows(pid)
      : await killPidUnix(pid);

    if (result.ok) {
      killed.push(pid);
      continue;
    }

    failed.push({ pid, reason: result.reason });
  }

  return {
    port,
    pids: uniquePids,
    killed,
    failed,
  };
}

async function findListeningPids(port: number): Promise<number[]> {
  if (process.platform === 'win32') {
    return findListeningPidsWindows(port);
  }

  const fromLsof = await findListeningPidsWithLsof(port);
  if (fromLsof.length > 0) {
    return fromLsof;
  }

  return findListeningPidsWithSs(port);
}

async function findListeningPidsWindows(port: number): Promise<number[]> {
  const result = await runCommand(['netstat', '-ano', '-p', 'tcp']);
  if (result.exitCode !== 0) {
    return [];
  }

  const pids: number[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) {
      continue;
    }

    const protocol = cols[0]?.toUpperCase();
    const localAddress = cols[1] ?? '';
    const state = cols[3]?.toUpperCase();
    const pid = Number(cols[4]);

    if (protocol !== 'TCP' || state !== 'LISTENING' || !Number.isInteger(pid)) {
      continue;
    }

    if (extractPort(localAddress) === port) {
      pids.push(pid);
    }
  }

  return pids;
}

async function findListeningPidsWithLsof(port: number): Promise<number[]> {
  const result = await runCommand(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid));
}

async function findListeningPidsWithSs(port: number): Promise<number[]> {
  const result = await runCommand(['ss', '-ltnp']);
  if (result.exitCode !== 0) {
    return [];
  }

  const pids: number[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!new RegExp(`:${port}(?:\\s|$)`).test(line)) {
      continue;
    }

    for (const match of line.matchAll(/pid=(\d+)/g)) {
      const pid = Number(match[1]);
      if (Number.isInteger(pid)) {
        pids.push(pid);
      }
    }
  }

  return pids;
}

async function killPidWindows(pid: number): Promise<{ ok: boolean; reason: string }> {
  const result = await runCommand(['taskkill', '/PID', String(pid), '/T', '/F']);
  if (result.exitCode === 0) {
    return { ok: true, reason: '' };
  }
  const reason = result.stderr.trim() || result.stdout.trim() || 'taskkill failed';
  return { ok: false, reason };
}

async function killPidUnix(pid: number): Promise<{ ok: boolean; reason: string }> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    return { ok: false, reason: formatError(error) };
  }

  await delay(250);
  if (!isPidAlive(pid)) {
    return { ok: true, reason: '' };
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    return { ok: false, reason: formatError(error) };
  }

  await delay(100);
  if (!isPidAlive(pid)) {
    return { ok: true, reason: '' };
  }

  return { ok: false, reason: 'process is still alive after SIGKILL' };
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function extractPort(address: string): number | null {
  const index = address.lastIndexOf(':');
  if (index === -1) {
    return null;
  }
  const value = Number(address.slice(index + 1).replace(/\]$/, ''));
  return Number.isInteger(value) ? value : null;
}

export async function runCommand(command: string[]): Promise<CommandResult> {
  try {
    const proc = Bun.spawn(command, {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdoutBuffer, stderrBuffer, exitCode] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).arrayBuffer(),
      proc.exited,
    ]);

    return {
      exitCode,
      stdout: new TextDecoder().decode(stdoutBuffer),
      stderr: new TextDecoder().decode(stderrBuffer),
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: formatError(error),
    };
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

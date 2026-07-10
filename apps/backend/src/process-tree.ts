/**
 * Process-tree termination.
 *
 * Kills the ENTIRE descendant tree of a root pid, not just the root, so that
 * shells (`/bin/sh -c`, `cmd.exe /c`) do not leave orphaned grandchildren
 * (npm → node → vite/nodemon) holding onto ports.
 *
 * Unix:    enumerate descendants via `ps`, then SIGTERM/SIGKILL each pid,
 *          plus an opportunistic process-group kill.
 * Windows: `taskkill /T` walks the tree by PPID for us.
 */

import { setTimeout as delay } from "node:timers/promises";
import { isPidAlive, runCommand } from "./port-processes";

export { isPidAlive };

const POLL_INTERVAL_MS = 100;

export async function snapshotProcessTree(pid: number): Promise<number[]> {
  if (process.platform === "win32") {
    return [pid];
  }
  const descendants = await collectUnixDescendants(pid);
  return [pid, ...descendants];
}

export async function stopProcessTree(
  pid: number,
  opts: { graceMs?: number; onLog?: (msg: string) => void } = {}
): Promise<boolean> {
  const graceMs = Math.max(0, opts.graceMs ?? 5000);

  if (process.platform === "win32") {
    return stopWindowsTree(pid);
  }
  return stopUnixTree(pid, graceMs);
}

// ─── Unix ───────────────────────────────────────────────────────────────────

async function stopUnixTree(rootPid: number, graceMs: number): Promise<boolean> {
  // Snapshot BEFORE signalling: once the shell dies its children reparent to
  // init and can no longer be found by walking down from rootPid.
  const pids = await snapshotProcessTree(rootPid);

  signalUnix(pids, rootPid, "SIGTERM");

  if (graceMs > 0) {
    const deadline = graceMs;
    let waited = 0;
    while (waited < deadline && pids.some((pid) => isPidAlive(pid))) {
      await delay(POLL_INTERVAL_MS);
      waited += POLL_INTERVAL_MS;
    }
  }

  if (pids.some((pid) => isPidAlive(pid))) {
    signalUnix(pids, rootPid, "SIGKILL");
    await delay(POLL_INTERVAL_MS);
  }

  return pids.every((pid) => !isPidAlive(pid));
}

function signalUnix(pids: number[], rootPid: number, signal: NodeJS.Signals): void {
  // Opportunistic group kill (works when rootPid is a group leader; otherwise
  // ESRCH, which is harmless — a non-leader pid never names another group).
  try {
    process.kill(-rootPid, signal);
  } catch {
    // no such group / not permitted — fall through to per-pid kills
  }
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

async function collectUnixDescendants(rootPid: number): Promise<number[]> {
  const result = await runCommand(["ps", "-A", "-o", "pid=,ppid="]);
  if (result.exitCode !== 0) {
    return [];
  }

  const childrenByParent = new Map<number, number[]>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const [pidStr, ppidStr] = line.trim().split(/\s+/);
    const pid = Number(pidStr);
    const ppid = Number(ppidStr);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
      continue;
    }
    const siblings = childrenByParent.get(ppid) ?? [];
    siblings.push(pid);
    childrenByParent.set(ppid, siblings);
  }

  const descendants: number[] = [];
  const queue = [rootPid];
  const seen = new Set<number>([rootPid]);
  while (queue.length > 0) {
    const parent = queue.shift() as number;
    for (const child of childrenByParent.get(parent) ?? []) {
      if (seen.has(child)) {
        continue;
      }
      seen.add(child);
      descendants.push(child);
      queue.push(child);
    }
  }

  return descendants;
}

// ─── Windows ──────────────────────────────────────────────────────────────

async function stopWindowsTree(rootPid: number): Promise<boolean> {
  // Windows has no working graceful terminate for headless console trees:
  // `taskkill /T` without /F is rejected for windowless console processes
  // (node/vite/npm dev servers), so a graceful attempt would only waste the
  // grace period. Go straight to a forced tree-kill.
  await runCommand(["taskkill", "/PID", String(rootPid), "/T", "/F"]);
  await delay(POLL_INTERVAL_MS);
  return !isPidAlive(rootPid);
}

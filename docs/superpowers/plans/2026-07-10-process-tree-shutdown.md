# Process Tree-Kill & Clean Shutdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop, restart, and server shutdown terminate the entire child-process tree of each service (not just the wrapping shell), so no orphans survive and ports are freed reliably.

**Architecture:** A new backend module `process-tree.ts` snapshots a process's descendants and terminates the whole tree with a graceful-then-force policy (Unix: enumerate descendants via `ps` + kill each + opportunistic process-group kill; Windows: `taskkill /T` then `/T /F`). `process-manager.stop()` routes through it, marks the stop as intentional so the exit handler reports `stopped` (never `error`), and falls back to the existing port-killer if the tree still holds the port. A small `shutdown.ts` bounds server shutdown with a global timeout.

**Tech Stack:** Bun (runtime + `bun test`), TypeScript, Elysia. No new dependencies.

## Global Constraints

- Runtime is Bun; tests run with `bun test` (Bun's built-in runner). No Jest/Vitest.
- No new npm dependencies. Use `node:child_process` / `Bun.spawn` and `node:timers/promises` only.
- Cross-platform: every kill path must have a Windows branch (`taskkill`) and a Unix branch (`process.kill` / `ps`). Guard with `process.platform === 'win32'`.
- The wrapping shell is `cmd.exe /d /s /c <cmd>` (Windows) or `/bin/sh -c <cmd>` (Unix), spawned in `pty-adapter.ts`. Do NOT change how it is spawned.
- Graceful grace period default: `5000` ms. Shutdown global timeout: `8000` ms.
- Kill helpers must never throw on `ESRCH` (process already gone) — treat as success.

---

## File Structure

- `apps/backend/src/process-tree.ts` — **new**. Snapshot + graceful/force tree termination. Exports: `isPidAlive`, `snapshotProcessTree`, `stopProcessTree`.
- `apps/backend/src/port-processes.ts` — **modify**. Export the existing `isPidAlive` and `runCommand` helpers for reuse (DRY); no behavior change.
- `apps/backend/src/process-manager.ts` — **modify**. Rewrite `stop()` to use `stopProcessTree`; add an intentional-stop flag so the exit handler reports `stopped`.
- `apps/backend/src/shutdown.ts` — **new**. `gracefulShutdown()` with injectable deps + global timeout.
- `apps/backend/src/index.ts` — **modify**. Signal handlers call `gracefulShutdown()` then `process.exit`.
- `apps/backend/package.json` — **modify**. Add a `test` script.

**Deviation from spec (Component 2):** the spec proposed spawning the Unix shell `detached: true` and relying on process-group kill. This plan instead enumerates descendants via `ps` (with an opportunistic group-kill), which is strictly more robust and avoids the unverified `detached` + `pty` interaction under Bun. Therefore `pty-adapter.ts` is left unchanged. The goal (a killable tree, no orphans) is fully covered.

---

## Task 1: `process-tree.ts` — snapshot and stop a whole process tree

**Files:**
- Modify: `apps/backend/src/port-processes.ts` (export `isPidAlive`, `runCommand`)
- Create: `apps/backend/src/process-tree.ts`
- Create: `apps/backend/src/process-tree.test.ts`
- Modify: `apps/backend/package.json` (add `test` script)

**Interfaces:**
- Consumes: `runCommand(command: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>` and `isPidAlive(pid: number): boolean` from `./port-processes`.
- Produces:
  - `isPidAlive(pid: number): boolean` (re-exported)
  - `snapshotProcessTree(pid: number): Promise<number[]>` — returns `[pid, ...descendants]` on Unix; `[pid]` on Windows (the OS `taskkill /T` walks the tree itself).
  - `stopProcessTree(pid: number, opts?: { graceMs?: number; onLog?: (msg: string) => void }): Promise<boolean>` — graceful-then-force; resolves `true` if the tree is dead afterwards.

- [ ] **Step 1: Export the shared helpers from `port-processes.ts`**

In `apps/backend/src/port-processes.ts`, change these two declarations from private to exported (bodies unchanged):

```ts
export async function runCommand(command: string[]): Promise<CommandResult> {
```

```ts
export function isPidAlive(pid: number): boolean {
```

- [ ] **Step 2: Add a `test` script to the backend package**

In `apps/backend/package.json`, add to `"scripts"`:

```json
    "test": "bun test"
```

- [ ] **Step 3: Write the failing test**

Create `apps/backend/src/process-tree.test.ts`:

```ts
import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { isPidAlive, snapshotProcessTree, stopProcessTree } from "./process-tree";

const isWin = process.platform === "win32";

// A shell that spawns a nested child which spawns a long-lived grandchild.
// The trailing `; true` / `& call` prevents the shell from exec-optimising
// away the intermediate process, guaranteeing a real multi-level tree.
function spawnTree(): { pid: number } {
  if (isWin) {
    const comspec = process.env["ComSpec"] ?? "cmd.exe";
    const child = spawn(comspec, ["/d", "/s", "/c", "ping -n 300 127.0.0.1 >NUL"], {
      stdio: "ignore",
    });
    if (child.pid === undefined) throw new Error("no pid");
    return { pid: child.pid };
  }
  const child = spawn("/bin/sh", ["-c", "sh -c 'sleep 300; true'; true"], {
    stdio: "ignore",
  });
  if (child.pid === undefined) throw new Error("no pid");
  return { pid: child.pid };
}

test("snapshotProcessTree includes the root pid", async () => {
  const { pid } = spawnTree();
  await delay(300); // let descendants spawn
  try {
    const tree = await snapshotProcessTree(pid);
    expect(tree).toContain(pid);
    if (!isWin) {
      // Unix enumeration must see at least one descendant (the nested sh/sleep).
      expect(tree.length).toBeGreaterThanOrEqual(2);
    }
  } finally {
    await stopProcessTree(pid, { graceMs: 0 });
  }
});

test("stopProcessTree kills the whole tree, including descendants", async () => {
  const { pid } = spawnTree();
  await delay(300);
  const tree = await snapshotProcessTree(pid);

  const ok = await stopProcessTree(pid, { graceMs: 0 });
  await delay(200);

  expect(ok).toBe(true);
  expect(isPidAlive(pid)).toBe(false);
  if (!isWin) {
    for (const descendant of tree) {
      expect(isPidAlive(descendant)).toBe(false);
    }
  }
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `bun test src/process-tree.test.ts` (from `apps/backend`)
Expected: FAIL — cannot resolve module `./process-tree` (file does not exist yet).

- [ ] **Step 5: Implement `process-tree.ts`**

Create `apps/backend/src/process-tree.ts`:

```ts
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
    return stopWindowsTree(pid, graceMs);
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

async function stopWindowsTree(rootPid: number, graceMs: number): Promise<boolean> {
  // Graceful: taskkill without /F asks the tree to close.
  await runCommand(["taskkill", "/PID", String(rootPid), "/T"]);

  if (graceMs > 0) {
    let waited = 0;
    while (waited < graceMs && isPidAlive(rootPid)) {
      await delay(POLL_INTERVAL_MS);
      waited += POLL_INTERVAL_MS;
    }
  }

  if (isPidAlive(rootPid)) {
    await runCommand(["taskkill", "/PID", String(rootPid), "/T", "/F"]);
    await delay(POLL_INTERVAL_MS);
  }

  return !isPidAlive(rootPid);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test src/process-tree.test.ts` (from `apps/backend`)
Expected: PASS — both tests green (2 pass).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/process-tree.ts apps/backend/src/process-tree.test.ts apps/backend/src/port-processes.ts apps/backend/package.json
git commit -m "feat(backend): add process-tree module for whole-tree termination"
```

---

## Task 2: `process-manager.stop()` — route through tree-kill, report `stopped` not `error`

**Files:**
- Modify: `apps/backend/src/process-manager.ts`
- Create: `apps/backend/src/process-manager.test.ts`

**Interfaces:**
- Consumes: `stopProcessTree(pid, opts)` and `isPidAlive(pid)` from `./process-tree`; existing `killProcessesListeningOnPort(port)` from `./port-processes`.
- Produces: unchanged public API of `processManager` (`start`, `stop`, `restart`, `stopAll`, …). Behavioural change only: after `stop()` the service's tree is dead and its state is `stopped`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/process-manager.test.ts`:

```ts
import { test, expect } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import type { ServiceConfig } from "@dev-pagghiaro/shared";
import { processManager } from "./process-manager";
import { isPidAlive, snapshotProcessTree } from "./process-tree";

const isWin = process.platform === "win32";

function treeCommand(): string {
  return isWin ? "ping -n 300 127.0.0.1 >NUL" : "sh -c 'sleep 300; true'; true";
}

function makeService(id: string): ServiceConfig {
  return { id, name: id, command: treeCommand(), cwd: "." };
}

test("stop() kills the whole tree and reports 'stopped', not 'error'", async () => {
  const service = makeService("test-stop-tree");
  // import.meta.dir is an existing directory with no .env files → safe rootPath
  const state = await processManager.start("proj", service, import.meta.dir);
  expect(state.status).toBe("running");
  const pid = state.pid as number;

  await delay(300);
  const tree = await snapshotProcessTree(pid);

  const stopped = await processManager.stop(service.id);
  await delay(200);

  expect(stopped?.status).toBe("stopped");
  expect(processManager.getState(service.id)?.status).toBe("stopped");
  expect(isPidAlive(pid)).toBe(false);
  if (!isWin) {
    for (const descendant of tree) {
      expect(isPidAlive(descendant)).toBe(false);
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/process-manager.test.ts` (from `apps/backend`)
Expected: FAIL — the descendant assertions fail (orphans survive) and/or the final status is `error` (non-zero exit from the kill is mapped to `error`).

- [ ] **Step 3: Add the intentional-stop flag and imports**

In `apps/backend/src/process-manager.ts`, update the import of tree helpers. Replace:

```ts
import { killProcessesListeningOnPort } from "./port-processes";
```

with:

```ts
import { killProcessesListeningOnPort } from "./port-processes";
import { stopProcessTree } from "./process-tree";
```

Then, next to the existing module state maps (after the line `const states = new Map<string, ServiceState>();`), add:

```ts
// Service ids currently being stopped intentionally. The exit handler consults
// this so a kill-induced non-zero exit is reported as "stopped", not "error".
const stopping = new Set<string>();
```

- [ ] **Step 4: Make the exit handler respect an intentional stop**

In `start()`, replace the exit-watch block:

```ts
    // Watch for process exit
    void pty.exited.then((code) => {
      metricsCollector.untrack(service.id);
      processes.delete(service.id);
      const exitState = setState(service.id, projectId, {
        status: code === 0 ? "stopped" : "error",
        lastExitCode: code,
        pid: null,
      });
      logBus.emit(
        service.id,
        `\r\n[DevPagghiaro] Process exited with code ${code}\r\n`
      );
      logBus.emitStatus(service.id, exitState.status);
    });
```

with:

```ts
    // Watch for process exit
    void pty.exited.then((code) => {
      metricsCollector.untrack(service.id);
      processes.delete(service.id);
      const intentional = stopping.has(service.id);
      const status = intentional || code === 0 ? "stopped" : "error";
      const exitState = setState(service.id, projectId, {
        status,
        lastExitCode: code,
        pid: null,
      });
      logBus.emit(
        service.id,
        `\r\n[DevPagghiaro] Process exited with code ${code}\r\n`
      );
      logBus.emitStatus(service.id, exitState.status);
    });
```

Also, at the very start of `start()`, clear any stale flag so a fresh run is never treated as stopping. Immediately after the idempotency check `if (existing) { ... }` block and before `setState(service.id, projectId, { status: "restarting" });`, add:

```ts
    stopping.delete(service.id);
```

- [ ] **Step 5: Rewrite `stop()` to use `stopProcessTree`**

Replace the entire `stop()` method:

```ts
  async stop(serviceId: string): Promise<ServiceState | undefined> {
    const managed = processes.get(serviceId);
    if (!managed) {
      return states.get(serviceId);
    }

    const { pty, projectId } = managed;

    // Mark stopped immediately so the UI updates before the process dies
    setState(serviceId, projectId, { status: "stopped" });
    logBus.emitStatus(serviceId, "stopped");

    // Graceful SIGTERM → wait up to 5 s → SIGKILL
    pty.kill();
    await Promise.race([
      pty.exited,
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
    pty.kill(9);

    metricsCollector.untrack(serviceId);
    processes.delete(serviceId);

    const state = setState(serviceId, projectId, {
      status: "stopped",
      pid: null,
    });

    logBus.emit(serviceId, "\r\n[DevPagghiaro] Process stopped.\r\n");
    return state;
  },
```

with:

```ts
  async stop(serviceId: string): Promise<ServiceState | undefined> {
    const managed = processes.get(serviceId);
    if (!managed) {
      return states.get(serviceId);
    }

    const { pty, projectId } = managed;

    // Flag the stop as intentional so the exit handler reports "stopped".
    stopping.add(serviceId);
    setState(serviceId, projectId, { status: "stopped" });
    logBus.emitStatus(serviceId, "stopped");

    // Graceful terminate → wait up to grace → force-kill the WHOLE tree.
    const killed = await stopProcessTree(pty.pid, {
      graceMs: 5000,
      onLog: (msg) => logBus.emit(serviceId, msg),
    });

    // Last-resort safety net: if the tree still holds a configured port, free it.
    const port = servicePorts.get(serviceId);
    if (!killed && port != null) {
      const outcome = await killProcessesListeningOnPort(port);
      if (outcome.killed.length > 0) {
        logBus.emit(
          serviceId,
          `\r\n[DevPagghiaro] Freed port ${port} by stopping PID ${outcome.killed.join(", ")}\r\n`
        );
      }
    }

    metricsCollector.untrack(serviceId);
    processes.delete(serviceId);

    const state = setState(serviceId, projectId, {
      status: "stopped",
      pid: null,
    });
    logBus.emitStatus(serviceId, "stopped");
    stopping.delete(serviceId);

    logBus.emit(serviceId, "\r\n[DevPagghiaro] Process stopped.\r\n");
    return state;
  },
```

- [ ] **Step 6: Track each service's configured port for the safety net**

The rewritten `stop()` reads `servicePorts.get(serviceId)`. Add this map next to the `stopping` set:

```ts
// Last-known configured port per service, so stop() can free it as a fallback.
const servicePorts = new Map<string, number>();
```

And record it inside `start()`, immediately after `const cwd = resolveCwd(...)`:

```ts
    if (service.port != null) {
      servicePorts.set(service.id, service.port);
    } else {
      servicePorts.delete(service.id);
    }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test src/process-manager.test.ts` (from `apps/backend`)
Expected: PASS — status is `stopped` and every descendant pid is dead.

- [ ] **Step 8: Run the full backend suite**

Run: `bun test` (from `apps/backend`)
Expected: PASS — all tests from Task 1 and Task 2 green.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/process-manager.ts apps/backend/src/process-manager.test.ts
git commit -m "fix(backend): kill whole process tree on stop and report stopped state"
```

---

## Task 3: `shutdown.ts` — bound server shutdown with a global timeout

**Files:**
- Create: `apps/backend/src/shutdown.ts`
- Create: `apps/backend/src/shutdown.test.ts`
- Modify: `apps/backend/src/index.ts`

**Interfaces:**
- Consumes: `metricsCollector.stopAll()` and `processManager.stopAll()` (defaults, injectable for testing).
- Produces: `gracefulShutdown(opts?: { stopMetrics?: () => void; stopAll?: () => Promise<void>; timeoutMs?: number }): Promise<void>` and `SHUTDOWN_TIMEOUT_MS: number`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/shutdown.test.ts`:

```ts
import { test, expect } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { gracefulShutdown } from "./shutdown";

test("resolves after stopAll completes normally", async () => {
  let stoppedMetrics = false;
  let stoppedAll = false;
  await gracefulShutdown({
    stopMetrics: () => {
      stoppedMetrics = true;
    },
    stopAll: async () => {
      stoppedAll = true;
    },
    timeoutMs: 5000,
  });
  expect(stoppedMetrics).toBe(true);
  expect(stoppedAll).toBe(true);
});

test("does not hang when stopAll never resolves — bounded by timeout", async () => {
  const finished = await Promise.race([
    gracefulShutdown({
      stopMetrics: () => {},
      stopAll: () => new Promise<void>(() => {}), // never resolves
      timeoutMs: 150,
    }).then(() => "shutdown-returned"),
    delay(2000).then(() => "test-timeout"),
  ]);
  expect(finished).toBe("shutdown-returned");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/shutdown.test.ts` (from `apps/backend`)
Expected: FAIL — cannot resolve module `./shutdown`.

- [ ] **Step 3: Implement `shutdown.ts`**

Create `apps/backend/src/shutdown.ts`:

```ts
/**
 * Bounded server shutdown.
 *
 * Stops metrics and every managed process tree, but never blocks forever:
 * if child termination stalls, the global timeout wins so the process can exit.
 */

import { setTimeout as delay } from "node:timers/promises";
import { metricsCollector } from "./metrics-collector";
import { processManager } from "./process-manager";

export const SHUTDOWN_TIMEOUT_MS = 8000;

export async function gracefulShutdown(
  opts: {
    stopMetrics?: () => void;
    stopAll?: () => Promise<void>;
    timeoutMs?: number;
  } = {}
): Promise<void> {
  const stopMetrics = opts.stopMetrics ?? (() => metricsCollector.stopAll());
  const stopAll = opts.stopAll ?? (() => processManager.stopAll());
  const timeoutMs = opts.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;

  stopMetrics();
  await Promise.race([stopAll(), delay(timeoutMs)]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/shutdown.test.ts` (from `apps/backend`)
Expected: PASS — 2 pass.

- [ ] **Step 5: Wire `index.ts` to use `gracefulShutdown`**

In `apps/backend/src/index.ts`, add to the imports near the top (after the `processManager` import):

```ts
import { gracefulShutdown } from './shutdown';
```

Then replace the existing `shutdown` function:

```ts
async function shutdown(signal: string): Promise<void> {
  console.log(`\n[DevPagghiaro] Received ${signal} - shutting down...`);
  metricsCollector.stopAll();
  await processManager.stopAll();
  console.log('[DevPagghiaro] All child processes stopped. Bye.');
  process.exit(0);
}
```

with:

```ts
async function shutdown(signal: string): Promise<void> {
  console.log(`\n[DevPagghiaro] Received ${signal} - shutting down...`);
  await gracefulShutdown();
  console.log('[DevPagghiaro] All child processes stopped. Bye.');
  process.exit(0);
}
```

Note: the `metricsCollector` import in `index.ts` is still used elsewhere in the file — do not remove it.

- [ ] **Step 6: Run the full suite**

Run: `bun test` (from `apps/backend`)
Expected: PASS — process-tree, process-manager, and shutdown tests all green.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/shutdown.ts apps/backend/src/shutdown.test.ts apps/backend/src/index.ts
git commit -m "feat(backend): bound server shutdown with a global timeout"
```

---

## Task 4: End-to-end manual verification

**Files:** none (manual run).

- [ ] **Step 1: Start the backend against a real service that spawns children**

Create a throwaway `pagghiaro.json` (or use an existing project) with a service whose command spawns a child dev server holding a port, e.g. a service running `bun --watch` or `npm run dev`. Start the backend:

Run (from repo root, Git Bash / macOS / Linux): `bun run dev:backend`
On Windows PowerShell, set the env var separately first:
`$env:PAGGHIARO_CONFIG_PATH=".\pagghiaro.json"; bun run --cwd apps/backend dev`

- [ ] **Step 2: Verify stop frees the port and reports `stopped`**

Start the service from the UI (or `POST /api/projects/:id/services/:sid/start`), confirm it listens on its port, then stop it. Confirm:
- the UI shows `stopped` (NOT `error`),
- the port is free afterwards (`netstat -ano | findstr :<port>` on Windows, `lsof -iTCP:<port>` on Unix) — no lingering listener.

- [ ] **Step 3: Verify server shutdown leaves no orphans**

With one or more services running, stop the backend with Ctrl+C. Confirm the process exits promptly (within ~8 s worst case) and that no child dev-server processes remain (`ps` / Task Manager), and the ports are free.

- [ ] **Step 4: Commit any config/doc fixups discovered during verification**

```bash
git add -A
git commit -m "chore(backend): notes/fixups from tree-kill verification"
```

(If nothing changed, skip this commit.)

---

## Self-Review Notes

- **Spec coverage:** Orphan tree-kill on stop → Task 1 + Task 2. Clean shutdown without orphans → Task 3 (routes through the same `stopProcessTree` via `stopAll`). False `error` status fix → Task 2 (Steps 3–5). Port safety-net → Task 2 (Steps 5–6). Component 2 (`pty-adapter` detached) is intentionally superseded by descendant enumeration — documented under File Structure.
- **Types:** `stopProcessTree(pid, { graceMs, onLog })`, `snapshotProcessTree(pid)`, `isPidAlive(pid)`, `gracefulShutdown({ stopMetrics, stopAll, timeoutMs })`, `runCommand(string[])` are named identically across all tasks that reference them.
- **No placeholders:** every code step shows the full code to add or the exact before/after replacement.

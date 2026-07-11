# Service Diagnostics Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-service diagnostics to DevPagghiaro: static runtime introspection (cwd+exists, expanded command, env with provenance/shadowing, port-in-use, runtime) and a base HTTP health-check, surfaced via a diagnostics panel, a palette command, a service-row button, and an inline health dot.

**Architecture:** Reuse existing spawn/port/env logic by exporting it (single source of truth). A pure `describeServiceEnv` reports env provenance; a `healthMonitor` (modeled on `metricsCollector`) polls HTTP health while a service runs; `service-introspection` composes the read-only bundle behind a new REST route. Health rides the existing per-service `/state` poll — no WS change. Frontend adds an introspection service + panel + entry points + health dot.

**Tech Stack:** Backend Bun + Elysia, tests `bun:test` colocated. Frontend Angular 18 standalone + signals, native `fetch`, Jasmine/Karma via `ng test`.

## Global Constraints

- **Do NOT modify `apps/backend/src/log-bus.ts`** and do NOT change the WS protocol. Health is delivered on the existing `GET /api/projects/:projectId/services/:serviceId/state` poll (every 2s).
- Env introspection scope = only user-configured layers (`.env*` of project/service roots + `service.env`); NOT the inherited `process.env`.
- **Env values shown in plaintext** (deliberate user decision; no masking).
- Health `up` = ANY HTTP response; `down` = connection refused/timeout; `unknown` = disabled / no port / not-yet-probed / not running.
- Health-check runs only when `service.healthCheck.enabled === true` AND `service.port != null`. Defaults: `path` `'/'`, `intervalMs` `10000`, probe timeout ~3000ms.
- Reuse-by-extraction: export existing private helpers rather than duplicating (`resolveShellArgs`, `findListeningPids`, `resolveCwd`).
- `describeServiceEnv` MUST mirror `buildServiceProcessContext`'s precedence exactly: project layers → service layers (only if service root differs) → `service.env`; within a directory the file order is `.env`, `.env.local`, `.env.<mode>`, `.env.<mode>.local` (later overrides earlier).
- Frontend icon: use `activity` (already registered in `app.config.ts`).

---

### Task 1: Shared types

**Files:**
- Modify: `packages/shared/src/models.ts` (append + two field additions)

**Interfaces:**
- Produces: `HealthState`, `HealthCheckConfig`, `ServiceHealth`, `EnvVarProvenance`, `CommandExpansion`, `CwdInfo`, `PortInfo`, `ServiceRuntimeInfo`, `ServiceIntrospection`; adds `ServiceConfig.healthCheck?`, `ServiceState.health?`.

- [ ] **Step 1: Add the `healthCheck` field to `ServiceConfig`**

In the existing `ServiceConfig` interface, add after `color?`:
```ts
  healthCheck?: HealthCheckConfig;
```

- [ ] **Step 2: Add the `health` field to `ServiceState`**

In the existing `ServiceState` interface, add after `metrics?`:
```ts
  health?: ServiceHealth;
```

- [ ] **Step 3: Append the new types at the end of `models.ts`**

```ts
export type HealthState = 'unknown' | 'up' | 'down';

export interface HealthCheckConfig {
  enabled?: boolean;
  path?: string;
  intervalMs?: number;
}

export interface ServiceHealth {
  state: HealthState;
  checkedAt?: number;
  statusCode?: number;
  detail?: string;
}

export interface EnvVarProvenance {
  key: string;
  value: string;
  source: string;
  shadowed: Array<{ source: string; value: string }>;
}

export interface CommandExpansion {
  raw: string;
  shell: string;
  argv: string[];
}

export interface CwdInfo {
  raw: string;
  resolved: string;
  exists: boolean;
}

export interface PortInfo {
  configured: number;
  inUse: boolean;
  pids: number[];
}

export interface ServiceRuntimeInfo {
  status: ServiceStatus;
  pid?: number;
  startedAt?: string;
  uptimeMs?: number;
  lastExitCode?: number;
}

export interface ServiceIntrospection {
  serviceId: string;
  projectId: string;
  cwd: CwdInfo;
  command: CommandExpansion;
  env: EnvVarProvenance[];
  port: PortInfo | null;
  runtime: ServiceRuntimeInfo;
  health: ServiceHealth;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/backend && bun run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/models.ts
git commit -m "feat(shared): add diagnostics + health types"
```
(Append the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer to every commit in this plan.)

---

### Task 2: Export `resolveShellArgs` from the PTY adapter

**Files:**
- Modify: `apps/backend/src/pty-adapter.ts` (change `function resolveShellArgs` → `export function`)
- Test: `apps/backend/src/pty-adapter.test.ts`

**Interfaces:**
- Produces: `resolveShellArgs(command: string): [string, ...string[]]`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/pty-adapter.test.ts
import { test, expect } from 'bun:test';
import { resolveShellArgs } from './pty-adapter';

test('resolveShellArgs puts the raw command last and wraps it in a shell', () => {
  const argv = resolveShellArgs('echo hi');
  expect(argv[argv.length - 1]).toBe('echo hi');
  if (process.platform === 'win32') {
    expect(argv).toContain('/c');
    expect(argv[0].length).toBeGreaterThan(0);
  } else {
    expect(argv[0]).toBe('/bin/sh');
    expect(argv[1]).toBe('-c');
  }
});
```

- [ ] **Step 2: Run test — expect FAIL** (`resolveShellArgs` not exported)

Run: `cd apps/backend && bun test pty-adapter`
Expected: FAIL (import has no matching export).

- [ ] **Step 3: Export the function**

In `apps/backend/src/pty-adapter.ts`, change the declaration:
```ts
export function resolveShellArgs(command: string): [string, ...string[]] {
```
(Body unchanged. Its existing internal call site `const [exe, ...args] = resolveShellArgs(opts.command);` keeps working.)

- [ ] **Step 4: Run test — expect PASS**

Run: `cd apps/backend && bun test pty-adapter`

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/pty-adapter.ts apps/backend/src/pty-adapter.test.ts
git commit -m "refactor(backend): export resolveShellArgs for introspection reuse"
```

---

### Task 3: Export a read-only `findListeningPids` from port-processes

**Files:**
- Modify: `apps/backend/src/port-processes.ts` (change `async function findListeningPids` → `export async function`)
- Test: `apps/backend/src/port-processes.test.ts`

**Interfaces:**
- Produces: `findListeningPids(port: number): Promise<number[]>` (read-only; never kills).

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/port-processes.test.ts
import { test, expect } from 'bun:test';
import { findListeningPids } from './port-processes';

test('findListeningPids is read-only: a listener survives the query', async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response('ok') });
  const port = server.port;
  try {
    const pids = await findListeningPids(port);
    expect(Array.isArray(pids)).toBe(true);
    // The server must still be listening — the query must not kill it.
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
  } finally {
    server.stop(true);
  }
});

test('findListeningPids returns an array for a likely-free port', async () => {
  const pids = await findListeningPids(59677);
  expect(Array.isArray(pids)).toBe(true);
});
```

- [ ] **Step 2: Run test — expect FAIL** (`findListeningPids` not exported)

Run: `cd apps/backend && bun test port-processes`

- [ ] **Step 3: Export the function**

In `apps/backend/src/port-processes.ts`, change:
```ts
export async function findListeningPids(port: number): Promise<number[]> {
```
(Body unchanged. The existing internal caller `killProcessesListeningOnPort` keeps working.)

- [ ] **Step 4: Run test — expect PASS**

Run: `cd apps/backend && bun test port-processes`

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/port-processes.ts apps/backend/src/port-processes.test.ts
git commit -m "refactor(backend): export read-only findListeningPids"
```

---

### Task 4: `describeServiceEnv` — env with provenance & shadowing

**Files:**
- Modify: `apps/backend/src/process-context.ts` (add exported function + a private single-file loader)
- Test: `apps/backend/src/process-context.test.ts`

**Interfaces:**
- Consumes: `EnvVarProvenance` from `@dev-pagghiaro/shared`.
- Produces: `describeServiceEnv(projectRootPath: string, service: ServiceConfig): Promise<EnvVarProvenance[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/process-context.test.ts
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeServiceEnv } from './process-context';
import type { ServiceConfig } from '@dev-pagghiaro/shared';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pagghiaro-env-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function svc(env?: Record<string, string>): ServiceConfig {
  return { id: 's', name: 'S', command: 'true', cwd: '.', ...(env ? { env } : {}) };
}

test('reports winning source and shadowed layers in precedence order', async () => {
  await Bun.write(join(root, '.env'), 'FOO=from-env\nBAR=bar1\n');
  await Bun.write(join(root, '.env.local'), 'FOO=from-local\n');

  const result = await describeServiceEnv(root, svc({ FOO: 'from-service' }));
  const foo = result.find((v) => v.key === 'FOO');
  const bar = result.find((v) => v.key === 'BAR');

  expect(foo).toBeDefined();
  expect(foo!.value).toBe('from-service');
  expect(foo!.source).toBe('service.env');
  expect(foo!.shadowed).toEqual([
    { source: 'project/.env', value: 'from-env' },
    { source: 'project/.env.local', value: 'from-local' },
  ]);

  expect(bar!.value).toBe('bar1');
  expect(bar!.source).toBe('project/.env');
  expect(bar!.shadowed).toEqual([]);
});

test('returns empty array when no env sources exist', async () => {
  const result = await describeServiceEnv(root, svc());
  expect(result).toEqual([]);
});
```

- [ ] **Step 2: Run test — expect FAIL** (`describeServiceEnv` not exported)

Run: `cd apps/backend && bun test process-context`

- [ ] **Step 3: Implement**

Add to `apps/backend/src/process-context.ts` (reuse existing `resolveServiceRoot`, `resolveEnvMode`, `getEnvFileCandidates`, `parseDotEnv`):

```ts
import type { EnvVarProvenance } from '@dev-pagghiaro/shared';

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
```

Add `import { join } from 'node:path';` if not already imported (the file currently imports only `resolve`; add `join`).

- [ ] **Step 4: Run test — expect PASS**

Run: `cd apps/backend && bun test process-context`
Then full suite: `cd apps/backend && bun test`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/process-context.ts apps/backend/src/process-context.test.ts
git commit -m "feat(backend): add describeServiceEnv with provenance and shadowing"
```

---

### Task 5: Health monitor + pure `classifyProbe`

**Files:**
- Create: `apps/backend/src/health-monitor.ts`
- Test: `apps/backend/src/health-monitor.test.ts`

**Interfaces:**
- Consumes: `ServiceHealth` from `@dev-pagghiaro/shared`.
- Produces: `classifyProbe(result)` pure; `healthMonitor.track(serviceId, { port, path, intervalMs })`, `healthMonitor.untrack(serviceId)`, `healthMonitor.getHealth(serviceId): ServiceHealth`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/health-monitor.test.ts
import { test, expect } from 'bun:test';
import { classifyProbe, healthMonitor } from './health-monitor';

test('classifyProbe maps an HTTP response to up with the status code', () => {
  const h = classifyProbe({ ok: true, status: 404 });
  expect(h.state).toBe('up');
  expect(h.statusCode).toBe(404);
  expect(typeof h.checkedAt).toBe('number');
});

test('classifyProbe maps a failure to down with detail', () => {
  const h = classifyProbe({ ok: false, detail: 'ECONNREFUSED' });
  expect(h.state).toBe('down');
  expect(h.detail).toBe('ECONNREFUSED');
});

test('getHealth is unknown for an untracked service', () => {
  expect(healthMonitor.getHealth('never-tracked').state).toBe('unknown');
});

test('track is idempotent and untrack resets to unknown', () => {
  healthMonitor.track('svc-x', { port: 59677, path: '/', intervalMs: 600000 });
  healthMonitor.track('svc-x', { port: 59677, path: '/', intervalMs: 600000 }); // no duplicate timer, no throw
  healthMonitor.untrack('svc-x');
  expect(healthMonitor.getHealth('svc-x').state).toBe('unknown');
});
```

- [ ] **Step 2: Run test — expect FAIL** (module missing)

Run: `cd apps/backend && bun test health-monitor`

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/health-monitor.ts
import type { ServiceHealth } from '@dev-pagghiaro/shared';

const PROBE_TIMEOUT_MS = 3000;

export function classifyProbe(
  result: { ok: true; status: number } | { ok: false; detail: string }
): ServiceHealth {
  const checkedAt = Date.now();
  if (result.ok) {
    return { state: 'up', checkedAt, statusCode: result.status };
  }
  return { state: 'down', checkedAt, detail: result.detail };
}

interface Tracked {
  timer: ReturnType<typeof setInterval>;
  port: number;
  path: string;
}

const tracked = new Map<string, Tracked>();
const latest = new Map<string, ServiceHealth>();

async function probe(serviceId: string, port: number, path: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let health: ServiceHealth;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal });
    health = classifyProbe({ ok: true, status: res.status });
  } catch (err) {
    const detail =
      err instanceof Error && err.name === 'AbortError'
        ? 'timeout'
        : err instanceof Error
          ? err.message
          : String(err);
    health = classifyProbe({ ok: false, detail });
  } finally {
    clearTimeout(timeout);
  }
  // Guard against a probe resolving after untrack: don't repopulate a cleared service.
  if (tracked.has(serviceId)) {
    latest.set(serviceId, health);
  }
}

export const healthMonitor = {
  track(serviceId: string, opts: { port: number; path: string; intervalMs: number }): void {
    if (tracked.has(serviceId)) return;
    const timer = setInterval(() => { void probe(serviceId, opts.port, opts.path); }, opts.intervalMs);
    tracked.set(serviceId, { timer, port: opts.port, path: opts.path });
    void probe(serviceId, opts.port, opts.path); // immediate first probe
  },

  untrack(serviceId: string): void {
    const entry = tracked.get(serviceId);
    if (entry) {
      clearInterval(entry.timer);
      tracked.delete(serviceId);
    }
    latest.delete(serviceId);
  },

  getHealth(serviceId: string): ServiceHealth {
    return latest.get(serviceId) ?? { state: 'unknown' };
  },
};
```

- [ ] **Step 4: Run test — expect PASS** (the `untrack` guard makes the reset deterministic even though the first probe fires async)

Run: `cd apps/backend && bun test health-monitor`
Then full suite: `cd apps/backend && bun test`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/health-monitor.ts apps/backend/src/health-monitor.test.ts
git commit -m "feat(backend): add HTTP health monitor with pure classifyProbe"
```

---

### Task 6: `service-introspection` — compose the bundle (+ export `resolveCwd`)

**Files:**
- Modify: `apps/backend/src/process-manager.ts` (change `function resolveCwd` → `export function`)
- Create: `apps/backend/src/service-introspection.ts`
- Test: `apps/backend/src/service-introspection.test.ts`

**Interfaces:**
- Consumes: `resolveCwd` (process-manager), `resolveShellArgs` (pty-adapter, Task 2), `findListeningPids` (port-processes, Task 3), `describeServiceEnv` (process-context, Task 4), `processManager.getState`, `healthMonitor.getHealth` (Task 5).
- Produces: `buildServiceIntrospection(project: ProjectConfig, service: ServiceConfig): Promise<ServiceIntrospection>`.

- [ ] **Step 1: Export `resolveCwd`**

In `apps/backend/src/process-manager.ts` change:
```ts
export function resolveCwd(serviceCwd: string, projectRootPath: string): string {
```
(Body unchanged; existing internal call keeps working.)

- [ ] **Step 2: Write the failing test**

```ts
// apps/backend/src/service-introspection.test.ts
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServiceIntrospection } from './service-introspection';
import type { ProjectConfig, ServiceConfig } from '@dev-pagghiaro/shared';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pagghiaro-intro-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function project(service: ServiceConfig): ProjectConfig {
  return { id: 'p1', name: 'P', rootPath: root, services: [service], createdAt: '2026-01-01T00:00:00.000Z' };
}

test('composes cwd(existence), expanded command, env, null port, unknown health', async () => {
  await Bun.write(join(root, '.env'), 'FOO=bar\n');
  const service: ServiceConfig = { id: 's1', name: 'api', command: 'echo hi', cwd: '.' };

  const intro = await buildServiceIntrospection(project(service), service);

  expect(intro.serviceId).toBe('s1');
  expect(intro.cwd.exists).toBe(true);
  expect(intro.command.raw).toBe('echo hi');
  expect(intro.command.argv[intro.command.argv.length - 1]).toBe('echo hi');
  expect(intro.env.find((v) => v.key === 'FOO')?.value).toBe('bar');
  expect(intro.port).toBeNull();
  expect(intro.runtime.status).toBe('stopped'); // never started
  expect(intro.health.state).toBe('unknown');
});

test('flags a non-existent cwd', async () => {
  const service: ServiceConfig = { id: 's2', name: 'api', command: 'true', cwd: 'does-not-exist' };
  const intro = await buildServiceIntrospection(project(service), service);
  expect(intro.cwd.exists).toBe(false);
});
```

- [ ] **Step 3: Run test — expect FAIL** (module missing)

Run: `cd apps/backend && bun test service-introspection`

- [ ] **Step 4: Implement**

```ts
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
```

- [ ] **Step 5: Run test — expect PASS**; then full suite `cd apps/backend && bun test`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/process-manager.ts apps/backend/src/service-introspection.ts apps/backend/src/service-introspection.test.ts
git commit -m "feat(backend): compose service introspection bundle"
```

---

### Task 7: Introspection route + register on app

**Files:**
- Create: `apps/backend/src/routes/introspection.ts`
- Test: `apps/backend/src/routes/introspection.test.ts`
- Modify: `apps/backend/src/index.ts` (import + `.use(introspectionRouter)`)

**Interfaces:**
- Consumes: `getProject` (config-store), `buildServiceIntrospection` (Task 6).
- Produces: `introspectionRouter` handling `GET /api/projects/:projectId/services/:serviceId/introspect`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/routes/introspection.test.ts
import { test, expect } from 'bun:test';
import { introspectionRouter } from './introspection';

test('returns 404 for an unknown project', async () => {
  const res = await introspectionRouter.handle(
    new Request('http://localhost/api/projects/nope-xyz/services/s1/introspect'),
  );
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run test — expect FAIL** (module missing)

Run: `cd apps/backend && bun test routes/introspection`

- [ ] **Step 3: Implement the route**

```ts
// apps/backend/src/routes/introspection.ts
import { Elysia } from 'elysia';
import { getProject } from '../config-store';
import { buildServiceIntrospection } from '../service-introspection';

export const introspectionRouter = new Elysia().get(
  '/api/projects/:projectId/services/:serviceId/introspect',
  async ({ params, set }) => {
    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Project not found' };
    }
    const service = project.services.find((s) => s.id === params.serviceId);
    if (!service) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }
    return buildServiceIntrospection(project, service);
  },
);
```

- [ ] **Step 4: Register in `apps/backend/src/index.ts`**

Add the import beside the other routers:
```ts
import { introspectionRouter } from './routes/introspection';
```
Add to the Elysia chain after `.use(logsRouter)`:
```ts
  .use(introspectionRouter)
```

- [ ] **Step 5: Run test — expect PASS**; then full suite `cd apps/backend && bun test`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/introspection.ts apps/backend/src/routes/introspection.test.ts apps/backend/src/index.ts
git commit -m "feat(backend): add introspection route"
```

---

### Task 8: Accept & persist `healthCheck` in config

**Files:**
- Modify: `apps/backend/src/config-store.ts` (validate `healthCheck`; export `isServiceConfig` for tests)
- Modify: `apps/backend/src/routes/services.ts` (Create/Update schemas + create handler pass-through)
- Test: `apps/backend/src/config-store.test.ts`

**Interfaces:**
- Produces: `isServiceConfig(value: unknown): value is ServiceConfig` (exported).

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/config-store.test.ts
import { test, expect } from 'bun:test';
import { isServiceConfig } from './config-store';

const base = { id: 's', name: 'S', command: 'true', cwd: '.' };

test('accepts a service with a valid healthCheck', () => {
  expect(isServiceConfig({ ...base, healthCheck: { enabled: true, path: '/health', intervalMs: 5000 } })).toBe(true);
  expect(isServiceConfig({ ...base, healthCheck: {} })).toBe(true);
  expect(isServiceConfig(base)).toBe(true); // healthCheck optional
});

test('rejects a malformed healthCheck', () => {
  expect(isServiceConfig({ ...base, healthCheck: { enabled: 'yes' } })).toBe(false);
  expect(isServiceConfig({ ...base, healthCheck: { intervalMs: -1 } })).toBe(false);
  expect(isServiceConfig({ ...base, healthCheck: 'nope' })).toBe(false);
});
```

- [ ] **Step 2: Run test — expect FAIL** (`isServiceConfig` not exported)

Run: `cd apps/backend && bun test config-store`

- [ ] **Step 3: Add a `healthCheck` validator + export `isServiceConfig`**

In `apps/backend/src/config-store.ts`, add above `isServiceConfig`:
```ts
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
```
Change `function isServiceConfig` to `export function isServiceConfig`, and add this line to its returned `&&` chain (e.g. after the `color` check):
```ts
    && isHealthCheckConfig((candidate as { healthCheck?: unknown }).healthCheck)
```

- [ ] **Step 4: Accept `healthCheck` in the service route schemas**

In `apps/backend/src/routes/services.ts`, add to BOTH `CreateServiceSchema` and `UpdateServiceSchema` object shapes:
```ts
  healthCheck: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      path: t.Optional(t.String()),
      intervalMs: t.Optional(t.Number({ minimum: 0 })),
    })
  ),
```
And in the POST create handler's `service` object literal, add:
```ts
        ...(payload.healthCheck !== undefined ? { healthCheck: payload.healthCheck } : {}),
```
(`UpdateServiceBody` is `Partial<Omit<ServiceConfig,'id'>>`, so PATCH already carries `healthCheck` through `updateService`'s `{ ...existing, ...patch }`.)

- [ ] **Step 5: Run test — expect PASS**; then full suite `cd apps/backend && bun test`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/config-store.ts apps/backend/src/routes/services.ts apps/backend/src/config-store.test.ts
git commit -m "feat(backend): accept and validate service healthCheck config"
```

---

### Task 9: Wire health lifecycle + enrich `/state`

**Files:**
- Modify: `apps/backend/src/process-manager.ts` (track/untrack health in start/stop)
- Modify: `apps/backend/src/routes/services.ts` (enrich `GET .../:serviceId/state` with health)
- Test: `apps/backend/src/routes/services.test.ts`

**Interfaces:**
- Consumes: `healthMonitor` (Task 5).

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/routes/services.test.ts
import { test, expect } from 'bun:test';
import { servicesRouter } from './services';

test('GET .../state includes a health field', async () => {
  const res = await servicesRouter.handle(
    new Request('http://localhost/api/projects/p1/services/never-started/state'),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { status: string; health: { state: string } };
  expect(body.status).toBe('stopped');
  expect(body.health.state).toBe('unknown');
});
```

- [ ] **Step 2: Run test — expect FAIL** (no `health` in the response)

Run: `cd apps/backend && bun test routes/services`

- [ ] **Step 3: Enrich the `/state` handler**

In `apps/backend/src/routes/services.ts`, import the monitor:
```ts
import { healthMonitor } from '../health-monitor';
```
Replace the `${BASE}/:serviceId/state` handler body with:
```ts
  .get(`${BASE}/:serviceId/state`, ({ params }) => {
    const state =
      processManager.getState(params.serviceId) ?? {
        serviceId: params.serviceId,
        projectId: params.projectId,
        status: 'stopped' as const,
      };
    return { ...state, health: healthMonitor.getHealth(params.serviceId) };
  })
```

- [ ] **Step 4: Wire track/untrack in the process manager**

In `apps/backend/src/process-manager.ts`, import:
```ts
import { healthMonitor } from "./health-monitor";
```
In `start()`, immediately after the `metricsCollector.track(service.id, pty.pid);` line, add:
```ts
    if (service.healthCheck?.enabled === true && service.port != null) {
      healthMonitor.track(service.id, {
        port: service.port,
        path: service.healthCheck.path ?? '/',
        intervalMs: service.healthCheck.intervalMs ?? 10000,
      });
    }
```
In `stop()`, next to `metricsCollector.untrack(serviceId);`, add:
```ts
    healthMonitor.untrack(serviceId);
```

- [ ] **Step 5: Run test — expect PASS**; then full suite `cd apps/backend && bun test`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/process-manager.ts apps/backend/src/routes/services.ts apps/backend/src/routes/services.test.ts
git commit -m "feat(backend): track health on start/stop and surface it on /state"
```

---

### Task 10: Frontend introspection service + UiService open/close

**Files:**
- Create: `frontend/src/app/services/introspection.service.ts`
- Modify: `frontend/src/app/services/ui.service.ts`

**Interfaces:**
- Produces: `IntrospectionService.fetchIntrospection(projectId, serviceId): Promise<ServiceIntrospection | null>`; `UiService.introspectTarget()` signal, `openIntrospect(projectId, serviceId)`, `closeIntrospect()`.

- [ ] **Step 1: Create the service**

```ts
// frontend/src/app/services/introspection.service.ts
import { Injectable } from '@angular/core';
import type { ServiceIntrospection } from '@dev-pagghiaro/shared';

const API_BASE = '/api';

@Injectable({ providedIn: 'root' })
export class IntrospectionService {
  async fetchIntrospection(projectId: string, serviceId: string): Promise<ServiceIntrospection | null> {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/introspect`);
      if (!res.ok) return null;
      return (await res.json()) as ServiceIntrospection;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 2: Extend `UiService`** (mirror the `configOpen`/`openConfig` modal pattern)

Add private signal + readonly accessor (next to `logsOpen`):
```ts
  private readonly introspectTargetSignal = signal<{ projectId: string; serviceId: string } | null>(null);
  readonly introspectTarget = this.introspectTargetSignal.asReadonly();
```
Add methods (next to `openLogs`/`closeLogs`):
```ts
  openIntrospect(projectId: string, serviceId: string): void {
    this.introspectTargetSignal.set({ projectId, serviceId });
  }

  closeIntrospect(): void {
    this.introspectTargetSignal.set(null);
  }
```

- [ ] **Step 3: Build**

Run: `cd frontend && bun run build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/services/introspection.service.ts frontend/src/app/services/ui.service.ts
git commit -m "feat(frontend): add introspection service and UiService open/close"
```

---

### Task 11: Introspection panel component + shell render

**Files:**
- Create: `frontend/src/app/diagnostics/introspection-panel.component.ts`
- Modify: `frontend/src/app/layout/app-shell.component.ts` (import + render)

**Interfaces:**
- Consumes: `IntrospectionService` (Task 10), `UiService`.

- [ ] **Step 1: Create the panel** (functional, minimal; follows the logs-panel modal shape)

```ts
// frontend/src/app/diagnostics/introspection-panel.component.ts
import { Component, effect, inject, signal } from '@angular/core';
import type { ServiceIntrospection } from '@dev-pagghiaro/shared';
import { IntrospectionService } from '../services/introspection.service';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-introspection-panel',
  standalone: true,
  template: `
    <div class="fixed inset-0 z-50 flex bg-black/60" (click)="ui.closeIntrospect()">
      <div class="m-auto flex max-h-[85vh] w-[90vw] max-w-3xl flex-col overflow-auto rounded-lg bg-white p-4 shadow-xl dark:bg-neutral-900" (click)="$event.stopPropagation()">
        @if (data(); as d) {
          <div class="mb-3 flex items-center justify-between">
            <h2 class="font-bold">Diagnostics</h2>
            <button class="rounded border px-2 py-1 text-sm" (click)="ui.closeIntrospect()">Close</button>
          </div>
          <section class="mb-3 text-sm">
            <div><b>Status:</b> {{ d.runtime.status }} <b>Health:</b> {{ d.health.state }}
              @if (d.health.statusCode) { ({{ d.health.statusCode }}) } @if (d.health.detail) { ({{ d.health.detail }}) }</div>
            @if (d.runtime.pid) { <div><b>PID:</b> {{ d.runtime.pid }} <b>Uptime:</b> {{ d.runtime.uptimeMs }}ms</div> }
            @if (d.runtime.lastExitCode !== undefined) { <div><b>Last exit:</b> {{ d.runtime.lastExitCode }}</div> }
          </section>
          <section class="mb-3 font-mono text-xs">
            <div [class.text-red-600]="!d.cwd.exists"><b>cwd:</b> {{ d.cwd.resolved }} @if (!d.cwd.exists) { — MISSING }</div>
            <div><b>argv:</b> {{ d.command.argv.join(' ') }}</div>
            @if (d.port) { <div [class.text-red-600]="d.port.inUse"><b>port:</b> {{ d.port.configured }} @if (d.port.inUse) { — IN USE by {{ d.port.pids.join(', ') }} }</div> }
          </section>
          <section class="text-xs">
            <div class="mb-1 font-bold">Environment ({{ d.env.length }})</div>
            <table class="w-full">
              <tbody>
                @for (v of d.env; track v.key) {
                  <tr class="border-b border-neutral-200 dark:border-neutral-700">
                    <td class="pr-2 font-mono">{{ v.key }}</td>
                    <td class="pr-2 font-mono break-all">{{ v.value }}</td>
                    <td class="whitespace-nowrap text-neutral-500">{{ v.source }}@if (v.shadowed.length) { <span title="overrides {{ v.shadowed.length }} layer(s)"> ⧉{{ v.shadowed.length }}</span> }</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        } @else {
          <div class="p-6 text-center opacity-60">Loading…</div>
        }
      </div>
    </div>
  `,
})
export class IntrospectionPanelComponent {
  readonly ui = inject(UiService);
  private readonly service = inject(IntrospectionService);
  private readonly dataSignal = signal<ServiceIntrospection | null>(null);
  readonly data = this.dataSignal.asReadonly();

  constructor() {
    effect(() => {
      const target = this.ui.introspectTarget();
      if (!target) { this.dataSignal.set(null); return; }
      void this.load(target.projectId, target.serviceId);
    });
  }

  private async load(projectId: string, serviceId: string): Promise<void> {
    this.dataSignal.set(await this.service.fetchIntrospection(projectId, serviceId));
  }
}
```

- [ ] **Step 2: Render in `app-shell.component.ts`**

Add import:
```ts
import { IntrospectionPanelComponent } from '../diagnostics/introspection-panel.component';
```
Add `IntrospectionPanelComponent` to the `@Component` `imports` array, and in the template (next to the logs panel render) add:
```html
@if (ui.introspectTarget()) { <app-introspection-panel /> }
```

- [ ] **Step 3: Build**

Run: `cd frontend && bun run build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/diagnostics/introspection-panel.component.ts frontend/src/app/layout/app-shell.component.ts
git commit -m "feat(frontend): add introspection diagnostics panel"
```

---

### Task 12: Health dot + inspect button + health in the polled model

**Files:**
- Modify: `frontend/src/app/models/project.model.ts` (add `health?`)
- Modify: `frontend/src/app/services/project.service.ts` (store health from `/state`)
- Modify: `frontend/src/app/dashboard/service-row.component.ts` (health dot + inspect button)
- Modify: `frontend/src/app/dashboard/service-list.component.ts` (wire inspect)

**Interfaces:**
- Consumes: `UiService.openIntrospect` (Task 10), `ServiceState.health` from `/state` (Task 9).

- [ ] **Step 1: Add `health` to the UI model**

In `frontend/src/app/models/project.model.ts`:
```ts
import { ProjectConfig, ServiceConfig, ServiceStatus, ServiceMetrics as SharedServiceMetrics, ServiceHealth } from '@dev-pagghiaro/shared';
```
and in `UiService`:
```ts
export interface UiService extends ServiceConfig {
  status: ServiceStatus;
  metrics?: ServiceMetrics;
  health?: ServiceHealth;
}
```

- [ ] **Step 2: Store health from the polled state**

In `frontend/src/app/services/project.service.ts`, add an updater (mirror `updateServiceMetrics`):
```ts
  updateServiceHealth(projectId: string, serviceId: string, health: import('@dev-pagghiaro/shared').ServiceHealth): void {
    this.projectsSignal.update((projects) =>
      projects.map((project) =>
        project.id !== projectId
          ? project
          : {
              ...project,
              services: project.services.map((service) =>
                service.id === serviceId ? { ...service, health } : service
              ),
            }
      )
    );
  }
```
In `fetchServiceState`, after `this.updateServiceStatus(...)`:
```ts
      if (state.health) {
        this.updateServiceHealth(projectId, serviceId, state.health);
      }
```

- [ ] **Step 3: Health dot + inspect button in `service-row.component.ts`**

In the template's action-button `<div class="flex items-center gap-0.5">`, add before `plug-zap`:
```html
          <ui-icon-button icon="activity" label="Inspect" tone="info" (click)="inspect.emit()"></ui-icon-button>
```
Add an inline health dot right after the `<ui-status-dot>` line:
```html
        <span class="inline-block h-2 w-2 rounded-full" [class]="healthDotClass()" [title]="'health: ' + (service.health?.state ?? 'unknown')"></span>
```
Add the output and helper to the class:
```ts
  @Output() inspect = new EventEmitter<void>();

  healthDotClass(): string {
    switch (this.service.health?.state) {
      case 'up': return 'bg-green-500';
      case 'down': return 'bg-red-500';
      default: return 'bg-neutral-400';
    }
  }
```

- [ ] **Step 4: Wire inspect in `service-list.component.ts`**

Inject already-present `ui` is private; it is `private readonly ui = inject(UiService)`. Add to the `<app-service-row ...>` bindings:
```html
            (inspect)="ui.openIntrospect(project.id, service.id)"
```
Change `private readonly ui` to `readonly ui` so the template can reach it:
```ts
  readonly ui = inject(UiService);
```

- [ ] **Step 5: Build + existing tests**

Run: `cd frontend && bun run build` → PASS.
Run: `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless` → existing suite green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/models/project.model.ts frontend/src/app/services/project.service.ts frontend/src/app/dashboard/service-row.component.ts frontend/src/app/dashboard/service-list.component.ts
git commit -m "feat(frontend): health dot, inspect button, health in polled model"
```

---

### Task 13: "Inspect service" command in the palette

**Files:**
- Modify: `frontend/src/app/services/command-registry.ts`
- Modify: `frontend/src/app/services/command-registry.spec.ts`
- Modify: `frontend/src/app/layout/app-shell.component.ts` (wire dep)

**Interfaces:**
- Consumes: `UiService.openIntrospect` (Task 10).

- [ ] **Step 1: Update the spec (RED)**

In `command-registry.spec.ts`, add `inspectService: () => {},` to the `deps` object, and add inside the existing `it(...)`:
```ts
    expect(cmds.some((c) => c.id === 'inspect:s1')).toBeTrue();
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless`

- [ ] **Step 3: Implement**

In `command-registry.ts`, add to `CommandDeps`:
```ts
  inspectService: (projectId: string, serviceId: string) => void;
```
Inside the `for (const s of active.services)` loop, add a command:
```ts
        { id: `inspect:${s.id}`, title: `Inspect ${s.name}`, icon: 'activity', action: () => d.inspectService(active.id, s.id) },
```
In `app-shell.component.ts`'s `buildCommands({...})`, add:
```ts
        inspectService: (p, s) => this.ui.openIntrospect(p, s),
```

- [ ] **Step 4: Run tests — expect PASS**; then `cd frontend && bun run build`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/services/command-registry.ts frontend/src/app/services/command-registry.spec.ts frontend/src/app/layout/app-shell.component.ts
git commit -m "feat(frontend): add Inspect service palette command"
```

---

### Task 14: Edit `healthCheck` in the config form (minimal)

**Files:**
- Modify: `frontend/src/app/models/config-form.model.ts` (extend the draft)
- Modify: `frontend/src/app/components/config-form/config-form.component.ts` (3 controls + load into draft)
- Modify: `frontend/src/app/services/project.service.ts` (`saveProjectDraft` maps healthCheck)

**Interfaces:**
- Consumes: `ServiceConfig.healthCheck` (Task 1) and the accept-schema (Task 8).

- [ ] **Step 1: Extend the draft model**

In `frontend/src/app/models/config-form.model.ts`, add to `EditableServiceDraft`:
```ts
  healthCheckEnabled: boolean;
  healthCheckPath: string;
  healthCheckIntervalMs: number;
```

- [ ] **Step 2: Load + edit + persist**

Read `config-form.component.ts` first. Wherever an `EditableServiceDraft` is created — both when building a blank service row AND when loading existing services into the form — populate the three new fields:
```ts
      healthCheckEnabled: service.healthCheck?.enabled ?? false,
      healthCheckPath: service.healthCheck?.path ?? '/',
      healthCheckIntervalMs: service.healthCheck?.intervalMs ?? 10000,
```
(for a blank/new row use the defaults `false`, `'/'`, `10000`).

Add three controls per service row in the form template, following the existing per-field markup pattern (the block that renders name/command/cwd/port/autoStart). Minimal:
```html
        <label><input type="checkbox" [(ngModel)]="service.healthCheckEnabled" [name]="'hc-en-' + service.draftKey" /> Health check</label>
        @if (service.healthCheckEnabled) {
          <input [(ngModel)]="service.healthCheckPath" [name]="'hc-path-' + service.draftKey" placeholder="/health" />
          <input type="number" [(ngModel)]="service.healthCheckIntervalMs" [name]="'hc-int-' + service.draftKey" placeholder="10000" />
        }
```
(Match the surrounding form's actual component/markup conventions; the above is the required data binding, not necessarily the exact class list.)

- [ ] **Step 3: Persist in `saveProjectDraft`**

In `frontend/src/app/services/project.service.ts`, `saveProjectDraft`, in BOTH the `updateService` and `createService` payloads, add a `healthCheck` field built from the draft:
```ts
          healthCheck: {
            enabled: service.healthCheckEnabled,
            path: service.healthCheckPath,
            intervalMs: Math.max(0, Math.floor(service.healthCheckIntervalMs || 10000)),
          },
```

- [ ] **Step 4: Build + existing tests**

Run: `cd frontend && bun run build` → PASS.
Run: `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless` → green.

If loading/creating drafts turns out to be more entangled than the pattern above (e.g. the draft is built in several places with different shapes), STOP and report DONE_WITH_CONCERNS describing what was found rather than guessing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/models/config-form.model.ts frontend/src/app/components/config-form/config-form.component.ts frontend/src/app/services/project.service.ts
git commit -m "feat(frontend): edit service healthCheck in the config form"
```

---

## Self-Review

**Spec coverage:**
- Shared types + `ServiceConfig.healthCheck` + `ServiceState.health` → Task 1 ✓
- Reuse-by-extraction: `resolveShellArgs` → Task 2; `findListeningPids` → Task 3; `resolveCwd` → Task 6 ✓
- `describeServiceEnv` provenance + shadowing, precedence mirrors `buildServiceProcessContext` → Task 4 ✓
- Health monitor + `classifyProbe` (up=any HTTP, down=refused/timeout, unknown default) → Task 5 ✓
- `service-introspection` bundle (cwd+exists, argv, env, port-in-use read-only, runtime, health) → Task 6 ✓
- Introspection route + register → Task 7 ✓
- Config accept/validate healthCheck → Task 8 ✓
- Health lifecycle track/untrack + `/state` enrichment (real poll path) → Task 9 ✓
- Frontend service + UiService open/close → Task 10; panel + shell render → Task 11; health dot + inspect button + model/mapping → Task 12; palette command → Task 13; config-form editing → Task 14 ✓
- Env values plaintext (no masking) → honored (no redaction task) ✓
- `log-bus.ts` untouched, no WS change → honored (health rides `/state`) ✓

**Placeholder scan:** backend tasks carry full test + impl code. Frontend component/form tasks carry complete data-layer code; template class-lists are explicitly "match existing conventions" (the load-bearing bindings are given). Task 14 has an explicit STOP-and-report escape if the draft plumbing diverges from the assumed pattern.

**Type consistency:** `ServiceIntrospection`/`ServiceHealth`/`HealthCheckConfig`/`EnvVarProvenance` defined in Task 1 and consumed unchanged in Tasks 4–13; `buildServiceIntrospection`, `describeServiceEnv`, `classifyProbe`, `healthMonitor.{track,untrack,getHealth}`, `resolveShellArgs`, `findListeningPids`, `resolveCwd`, `IntrospectionService.fetchIntrospection`, `UiService.openIntrospect/closeIntrospect`, `updateServiceHealth`, `inspectService` names are consistent between defining and consuming tasks.

**Ordering note:** Tasks 2–6 are backend leaves feeding Task 6/7; Task 9 depends on Task 5; frontend Tasks 11–13 depend on Task 10; Task 12/14 depend on Task 1 + Task 9. Execute in numeric order.

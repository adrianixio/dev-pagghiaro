# Attach Debugger Implementation Plan (Phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let DevPagghiaro enable Node inspect mode per service and surface how/where to attach an external debugger (Chrome DevTools / VS Code), plus a Unix SIGUSR1 break-in for a running Node — no embedded debugger.

**Architecture:** A per-service `debug` config injects `NODE_OPTIONS=--inspect=127.0.0.1:<port>` at start (pure `buildDebugNodeOptions`). A `GET /debug` route reports state and probes the Node inspector's `/json/list` for the real `ws://` endpoint; a `POST /debug/break-in` sends SIGUSR1 (Unix). Frontend shows a debug panel (ws endpoint + attach instructions + break-in + debugpy snippet).

**Tech Stack:** Backend Bun + Elysia, tests `bun:test`. Frontend Angular 18 standalone + signals, native `fetch`, Jasmine/Karma.

## Global Constraints

- **Do NOT modify `apps/backend/src/log-bus.ts`**; no terminal-WS change; the debug panel polls `/debug` via REST.
- Node inspect enabled only when `service.debug?.enabled === true`; port = `debug.port ?? 9229` (DEBUG_DEFAULT_PORT). Injection appends to any existing `NODE_OPTIONS`, never clobbers.
- `fetchInspectorWsUrl` never throws → returns `null` on any failure/timeout/empty; `listening = wsUrl != null`.
- Break-in: Windows → 400 "not supported"; no running pid → 400; SIGUSR1 opens the inspector on the Node default 9229 (documented).
- The UI shows the `ws://` endpoint + attach instructions (chrome://inspect / VS Code); it does NOT (cannot) open `devtools://`/`chrome://` links.
- Frontend icon: `bug` (register `Bug` in `app.config.ts`).

---

### Task 1: Shared types

**Files:** Modify `packages/shared/src/models.ts`.
**Produces:** `DebugConfig`, `DebugInfo`; adds `ServiceConfig.debug?`.

- [ ] **Step 1:** Add `debug?: DebugConfig;` to `ServiceConfig` (after `httpInspect?`).
- [ ] **Step 2:** Append:
```ts
export interface DebugConfig {
  enabled?: boolean;
  port?: number;
}

export interface DebugInfo {
  enabled: boolean;
  port: number;
  platform: string;
  breakInSupported: boolean;
  listening: boolean;
  wsUrl?: string;
}
```
- [ ] **Step 3:** `cd apps/backend && bun run build` → OK.
- [ ] **Step 4:** Commit `feat(shared): add debug attach types` (append `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` to every commit in this plan).

---

### Task 2: `buildDebugNodeOptions` (pure)

**Files:** Create `apps/backend/src/debug-options.ts`; Test `apps/backend/src/debug-options.test.ts`.
**Produces:** `DEBUG_DEFAULT_PORT`; `buildDebugNodeOptions(existing, port)`.

- [ ] **Step 1: Failing test:**
```ts
// apps/backend/src/debug-options.test.ts
import { test, expect } from 'bun:test';
import { buildDebugNodeOptions, DEBUG_DEFAULT_PORT } from './debug-options';

test('DEBUG_DEFAULT_PORT is 9229', () => {
  expect(DEBUG_DEFAULT_PORT).toBe(9229);
});

test('produces the inspect flag when no existing options', () => {
  expect(buildDebugNodeOptions(undefined, 9229)).toBe('--inspect=127.0.0.1:9229');
  expect(buildDebugNodeOptions('   ', 9229)).toBe('--inspect=127.0.0.1:9229');
});

test('appends to existing NODE_OPTIONS without clobbering', () => {
  expect(buildDebugNodeOptions('--max-old-space-size=256', 9230)).toBe('--max-old-space-size=256 --inspect=127.0.0.1:9230');
});
```
- [ ] **Step 2:** `cd apps/backend && bun test debug-options` → RED.
- [ ] **Step 3: Implement:**
```ts
// apps/backend/src/debug-options.ts
export const DEBUG_DEFAULT_PORT = 9229;

export function buildDebugNodeOptions(existing: string | undefined, port: number): string {
  const flag = `--inspect=127.0.0.1:${port}`;
  const trimmed = (existing ?? '').trim();
  return trimmed ? `${trimmed} ${flag}` : flag;
}
```
- [ ] **Step 4:** `cd apps/backend && bun test debug-options` → GREEN; then `bun test`.
- [ ] **Step 5:** Commit `feat(backend): add buildDebugNodeOptions`.

---

### Task 3: `fetchInspectorWsUrl`

**Files:** Create `apps/backend/src/debug-inspector.ts`; Test `apps/backend/src/debug-inspector.test.ts`.
**Produces:** `fetchInspectorWsUrl(port): Promise<string | null>`.

- [ ] **Step 1: Failing test** (fake inspector server):
```ts
// apps/backend/src/debug-inspector.test.ts
import { test, expect } from 'bun:test';
import { fetchInspectorWsUrl } from './debug-inspector';

test('returns the first target webSocketDebuggerUrl', async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === '/json/list') {
        return Response.json([{ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/abc' }]);
      }
      return new Response('nope', { status: 404 });
    },
  });
  try {
    expect(await fetchInspectorWsUrl(server.port)).toBe('ws://127.0.0.1:9229/abc');
  } finally {
    server.stop(true);
  }
});

test('returns null on empty list', async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json([]) });
  try {
    expect(await fetchInspectorWsUrl(server.port)).toBeNull();
  } finally {
    server.stop(true);
  }
});

test('returns null when unreachable', async () => {
  expect(await fetchInspectorWsUrl(1)).toBeNull();
});
```
- [ ] **Step 2:** `cd apps/backend && bun test debug-inspector` → RED.
- [ ] **Step 3: Implement:**
```ts
// apps/backend/src/debug-inspector.ts
export async function fetchInspectorWsUrl(port: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
    if (!res.ok) return null;
    const targets = (await res.json()) as Array<{ webSocketDebuggerUrl?: string }>;
    return targets[0]?.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
```
- [ ] **Step 4:** `cd apps/backend && bun test debug-inspector` → GREEN; then `bun test`.
- [ ] **Step 5:** Commit `feat(backend): add inspector /json/list probe`.

---

### Task 4: Inject NODE_OPTIONS on start

**Files:** Modify `apps/backend/src/process-manager.ts`.

- [ ] **Step 1:** Add import:
```ts
import { buildDebugNodeOptions, DEBUG_DEFAULT_PORT } from "./debug-options";
```
- [ ] **Step 2:** In `start()`, locate where `processContext` is built (`const processContext = await buildServiceProcessContext(projectRootPath, service);`) and immediately AFTER it, before `spawnPty`, add:
```ts
      if (service.debug?.enabled === true) {
        processContext['NODE_OPTIONS'] = buildDebugNodeOptions(
          processContext['NODE_OPTIONS'],
          service.debug.port ?? DEBUG_DEFAULT_PORT,
        );
      }
```
(If `spawnPty` is called with the context inline rather than a named `processContext` var, introduce the `const processContext = ...` binding first, then pass it — mirror the existing call.)
- [ ] **Step 3: Verify** — `cd apps/backend && bun test` → full suite green (wiring only; the pure logic is covered by Task 2). Then a quick runtime smoke: start the backend briefly and confirm it boots (`PAGGHIARO_PORT=3996 PAGGHIARO_CONFIG_PATH=./.superpowers/sdd/smoke-dbg.json bun run apps/backend/src/index.ts &`, `curl -s http://localhost:3996/health` → ok, kill, remove temp). If you cannot run a server here, report DONE_WITH_CONCERNS.
- [ ] **Step 4:** Commit `feat(backend): inject --inspect NODE_OPTIONS when debug enabled`.

---

### Task 5: Debug routes + register

**Files:** Create `apps/backend/src/routes/debug.ts`; Test `apps/backend/src/routes/debug.test.ts`; Modify `apps/backend/src/index.ts`.
**Produces:** `debugRouter`.
**Consumes:** `getProject` (config-store), `processManager` (process-manager), `fetchInspectorWsUrl` (Task 3), `DEBUG_DEFAULT_PORT` (Task 2), `DebugInfo` (Task 1).

- [ ] **Step 1: Failing test:**
```ts
// apps/backend/src/routes/debug.test.ts
import { test, expect } from 'bun:test';
import { debugRouter } from './debug';

test('GET /debug returns 404 for unknown project', async () => {
  const res = await debugRouter.handle(
    new Request('http://localhost/api/projects/nope-xyz/services/s1/debug'),
  );
  expect(res.status).toBe(404);
});

test('break-in returns 404 for unknown project', async () => {
  const res = await debugRouter.handle(
    new Request('http://localhost/api/projects/nope-xyz/services/s1/debug/break-in', { method: 'POST' }),
  );
  expect(res.status).toBe(404);
});
```
- [ ] **Step 2:** `cd apps/backend && bun test routes/debug` → RED.
- [ ] **Step 3: Implement:**
```ts
// apps/backend/src/routes/debug.ts
import { Elysia } from 'elysia';
import type { DebugInfo } from '@dev-pagghiaro/shared';
import { getProject } from '../config-store';
import { processManager } from '../process-manager';
import { fetchInspectorWsUrl } from '../debug-inspector';
import { DEBUG_DEFAULT_PORT } from '../debug-options';

const BASE = '/api/projects/:projectId/services/:serviceId/debug';

async function findService(projectId: string, serviceId: string) {
  const project = await getProject(projectId);
  if (!project) return { error: 'Project' as const };
  const service = project.services.find((s) => s.id === serviceId);
  if (!service) return { error: 'Service' as const };
  return { service };
}

export const debugRouter = new Elysia()
  .get(BASE, async ({ params, set }) => {
    const found = await findService(params.projectId, params.serviceId);
    if ('error' in found) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: `${found.error} not found` };
    }
    const { service } = found;
    const port = service.debug?.port ?? DEBUG_DEFAULT_PORT;
    const enabled = service.debug?.enabled === true;
    const running = processManager.getState(params.serviceId)?.status === 'running';

    let listening = false;
    let wsUrl: string | undefined;
    if (enabled && running) {
      wsUrl = (await fetchInspectorWsUrl(port)) ?? undefined;
      listening = wsUrl != null;
    }

    const info: DebugInfo = {
      enabled,
      port,
      platform: process.platform,
      breakInSupported: process.platform !== 'win32',
      listening,
      ...(wsUrl ? { wsUrl } : {}),
    };
    return info;
  })
  .post(`${BASE}/break-in`, async ({ params, set }) => {
    const found = await findService(params.projectId, params.serviceId);
    if ('error' in found) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: `${found.error} not found` };
    }
    if (process.platform === 'win32') {
      set.status = 400;
      return { error: 'BAD_REQUEST', message: 'Break-in not supported on Windows' };
    }
    const pid = processManager.getState(params.serviceId)?.pid;
    if (pid == null) {
      set.status = 400;
      return { error: 'BAD_REQUEST', message: 'Service is not running' };
    }
    try {
      process.kill(pid, 'SIGUSR1');
      return { ok: true, port: DEBUG_DEFAULT_PORT };
    } catch (err) {
      set.status = 400;
      return { error: 'BAD_REQUEST', message: err instanceof Error ? err.message : String(err) };
    }
  });
```
- [ ] **Step 4: Register in `index.ts`** — import `debugRouter` and add `.use(debugRouter)` after `.use(httpInspectRouter)`.
- [ ] **Step 5:** `cd apps/backend && bun test routes/debug` → GREEN; then `bun test`.
- [ ] **Step 6:** Commit `feat(backend): add debug info + break-in routes`.

---

### Task 6: Accept `debug` config

**Files:** Modify `apps/backend/src/config-store.ts`, `apps/backend/src/routes/services.ts`; Test extend `apps/backend/src/config-store.test.ts`.

- [ ] **Step 1: Failing test** (add to config-store.test.ts):
```ts
test('accepts a valid debug config and rejects a malformed one', () => {
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', debug: { enabled: true, port: 9229 } })).toBe(true);
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', debug: {} })).toBe(true);
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', debug: { enabled: 1 } })).toBe(false);
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', debug: { port: -1 } })).toBe(false);
});
```
- [ ] **Step 2:** `cd apps/backend && bun test config-store` → RED.
- [ ] **Step 3: Implement.** In `config-store.ts` add above `isServiceConfig`:
```ts
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
```
Add to the `isServiceConfig` `&&` chain: `&& isDebugConfig((candidate as { debug?: unknown }).debug)`.
In `routes/services.ts`, add to BOTH `CreateServiceSchema` and `UpdateServiceSchema`:
```ts
  debug: t.Optional(t.Object({ enabled: t.Optional(t.Boolean()), port: t.Optional(t.Number({ minimum: 0 })) })),
```
And in the POST create handler service literal:
```ts
        ...(payload.debug !== undefined ? { debug: payload.debug } : {}),
```
- [ ] **Step 4:** `cd apps/backend && bun test config-store` → GREEN; then `bun test`.
- [ ] **Step 5:** Commit `feat(backend): accept and validate debug config`.

---

### Task 7: Frontend debug service + UiService open/close

**Files:** Create `frontend/src/app/services/debug.service.ts`; Modify `frontend/src/app/services/ui.service.ts`.

- [ ] **Step 1: Create the service:**
```ts
// frontend/src/app/services/debug.service.ts
import { Injectable } from '@angular/core';
import type { DebugInfo } from '@dev-pagghiaro/shared';

const API_BASE = '/api';

export interface BreakInResult { ok: boolean; port?: number; message?: string; }

@Injectable({ providedIn: 'root' })
export class DebugService {
  async fetchDebugInfo(projectId: string, serviceId: string): Promise<DebugInfo | null> {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/debug`);
      if (!res.ok) return null;
      return (await res.json()) as DebugInfo;
    } catch { return null; }
  }

  async breakIn(projectId: string, serviceId: string): Promise<BreakInResult> {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/debug/break-in`, { method: 'POST' });
      const body = (await res.json()) as BreakInResult;
      return res.ok ? body : { ok: false, message: (body as { message?: string }).message ?? 'Break-in failed' };
    } catch { return { ok: false, message: 'Break-in request failed' }; }
  }
}
```
- [ ] **Step 2: Extend `UiService`** (mirror `httpInspectTarget`):
```ts
  private readonly debugTargetSignal = signal<{ projectId: string; serviceId: string } | null>(null);
  readonly debugTarget = this.debugTargetSignal.asReadonly();
```
```ts
  openDebug(projectId: string, serviceId: string): void { this.debugTargetSignal.set({ projectId, serviceId }); }
  closeDebug(): void { this.debugTargetSignal.set(null); }
```
- [ ] **Step 3:** `cd frontend && bun run build` → PASS.
- [ ] **Step 4:** Commit `feat(frontend): add debug service and UiService open/close`.

---

### Task 8: Debug panel + shell render + Bug icon

**Files:** Create `frontend/src/app/debug/debug-panel.component.ts`; Modify `frontend/src/app/layout/app-shell.component.ts`, `frontend/src/app/app.config.ts`.

- [ ] **Step 1:** Register `Bug` in `app.config.ts` (import + `.pick({...})`).
- [ ] **Step 2: Create the panel:**
```ts
// frontend/src/app/debug/debug-panel.component.ts
import { Component, OnDestroy, effect, inject, signal } from '@angular/core';
import type { DebugInfo } from '@dev-pagghiaro/shared';
import { DebugService } from '../services/debug.service';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-debug-panel',
  standalone: true,
  template: `
    <div class="fixed inset-0 z-50 flex bg-black/60" (click)="ui.closeDebug()">
      <div class="m-auto flex max-h-[85vh] w-[90vw] max-w-2xl flex-col gap-3 overflow-auto rounded-lg bg-white p-4 text-sm shadow-xl dark:bg-neutral-900" (click)="$event.stopPropagation()">
        <div class="flex items-center justify-between">
          <h2 class="font-bold">Debugger</h2>
          <button class="rounded border px-2 py-1" (click)="ui.closeDebug()">Close</button>
        </div>
        @if (info(); as d) {
          <div><b>Inspect enabled:</b> {{ d.enabled ? 'yes' : 'no (set debug.enabled + restart)' }} · <b>port:</b> {{ d.port }} · <b>listening:</b> {{ d.listening ? 'yes' : 'no' }}</div>
          @if (d.wsUrl) {
            <div class="font-mono text-xs break-all"><b>ws:</b> {{ d.wsUrl }}
              <button class="ml-2 rounded border px-1" (click)="copy(d.wsUrl!)">copy</button></div>
          }
          <div class="rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-800">
            <div class="font-bold">Attach with Chrome</div>
            <div>Open <span class="font-mono">chrome://inspect</span> → Configure → add <span class="font-mono">127.0.0.1:{{ d.port }}</span>.</div>
            <div class="mt-1 font-bold">Attach with VS Code (launch.json)</div>
            <pre class="whitespace-pre-wrap">{{ vscodeSnippet(d.port) }}</pre>
            <div class="mt-1 font-bold">Python (debugpy)</div>
            <pre class="whitespace-pre-wrap">python -m debugpy --listen 127.0.0.1:{{ d.port }} --wait-for-client your_script.py</pre>
          </div>
          @if (d.breakInSupported) {
            <div>
              <button class="rounded border px-3 py-1" (click)="breakIn()" [disabled]="breaking()">Break in (SIGUSR1 → :9229)</button>
              @if (breakMsg()) { <span class="ml-2 text-xs opacity-70">{{ breakMsg() }}</span> }
            </div>
          } @else {
            <div class="text-xs opacity-70">Break-in (SIGUSR1) is not supported on this platform.</div>
          }
        } @else {
          <div class="p-4 text-center opacity-60">Loading…</div>
        }
      </div>
    </div>
  `,
})
export class DebugPanelComponent implements OnDestroy {
  readonly ui = inject(UiService);
  private readonly service = inject(DebugService);
  private readonly infoSignal = signal<DebugInfo | null>(null);
  readonly info = this.infoSignal.asReadonly();
  readonly breaking = signal(false);
  readonly breakMsg = signal('');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      if (this.ui.debugTarget()) {
        void this.refresh();
        this.timer ??= setInterval(() => void this.refresh(), 2000);
      } else if (this.timer) {
        clearInterval(this.timer); this.timer = null;
      }
    });
  }

  ngOnDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private target() { return this.ui.debugTarget(); }

  async refresh(): Promise<void> {
    const t = this.target();
    if (!t) return;
    this.infoSignal.set(await this.service.fetchDebugInfo(t.projectId, t.serviceId));
  }

  async breakIn(): Promise<void> {
    const t = this.target();
    if (!t) return;
    this.breaking.set(true);
    try {
      const r = await this.service.breakIn(t.projectId, t.serviceId);
      this.breakMsg.set(r.ok ? `inspector opened on :${r.port}` : (r.message ?? 'failed'));
      await this.refresh();
    } finally { this.breaking.set(false); }
  }

  vscodeSnippet(port: number): string {
    return `{ "type": "node", "request": "attach", "name": "pagghiaro", "address": "127.0.0.1", "port": ${port} }`;
  }

  copy(text: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(text);
  }
}
```
> **Implementer note:** if any Angular 18 template/type detail fails to build, fix minimally to compile and note it; load-bearing parts are the info fetch/poll (stopped in `ngOnDestroy`), the break-in button gated on `breakInSupported`, and the ws/instructions display.

- [ ] **Step 3: Render in `app-shell.component.ts`** — import `DebugPanelComponent`, add to `imports`, and add `@if (ui.debugTarget()) { <app-debug-panel /> }` near the other panels.
- [ ] **Step 4:** `cd frontend && bun run build` → PASS; `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless` → green.
- [ ] **Step 5:** Commit `feat(frontend): add debug panel`.

---

### Task 9: Service-row button + list wiring

**Files:** Modify `frontend/src/app/dashboard/service-row.component.ts`, `frontend/src/app/dashboard/service-list.component.ts`.

- [ ] **Step 1:** In `service-row.component.ts` action group, add after the http-inspect button:
```html
          <ui-icon-button icon="bug" label="Debugger" tone="warning" (click)="debug.emit()"></ui-icon-button>
```
Add output: `@Output() debug = new EventEmitter<void>();`
- [ ] **Step 2:** In `service-list.component.ts`, add to `<app-service-row>` bindings:
```html
            (debug)="ui.openDebug(project.id, service.id)"
```
- [ ] **Step 3:** `cd frontend && bun run build` → PASS; existing tests green (if `service-row.component.spec.ts` renders `bug`, add `Bug` to that spec's local `LucideAngularModule.pick(...)`).
- [ ] **Step 4:** Commit `feat(frontend): add debugger button to service row`.

---

### Task 10: Palette "Debug" command

**Files:** Modify `frontend/src/app/services/command-registry.ts` (+ `.spec.ts`), `frontend/src/app/layout/app-shell.component.ts`.

- [ ] **Step 1: Update spec (RED)** — add `debug: () => {},` to test `deps` + assert `expect(cmds.some((c) => c.id === 'debug:s1')).toBeTrue();`.
- [ ] **Step 2:** `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless` → RED.
- [ ] **Step 3:** In `command-registry.ts` add to `CommandDeps`:
```ts
  debug: (projectId: string, serviceId: string) => void;
```
In the per-service loop add:
```ts
        { id: `debug:${s.id}`, title: `Debug: ${s.name}`, icon: 'bug', action: () => d.debug(active.id, s.id) },
```
In `app-shell.component.ts`'s `buildCommands({...})`:
```ts
        debug: (p, s) => this.ui.openDebug(p, s),
```
- [ ] **Step 4:** tests GREEN; `cd frontend && bun run build` PASS.
- [ ] **Step 5:** Commit `feat(frontend): add Debug palette command`.

---

### Task 11: Edit `debug` in the config form

**Files:** Modify `frontend/src/app/models/config-form.model.ts`, `frontend/src/app/components/config-form/config-form.component.ts`, `frontend/src/app/services/project.service.ts`.

- [ ] **Step 1:** Add to `EditableServiceDraft`:
```ts
  debugEnabled: boolean;
  debugPort: number | null;
```
- [ ] **Step 2:** At EVERY `EditableServiceDraft` construction site (constructor load-path + `addService()` — same as the Phase-2/3 `healthCheck`/`httpInspect` fields) populate: existing → `service.debug?.enabled ?? false`, `service.debug?.port ?? null`; blank → `false`, `null`.
- [ ] **Step 3:** Add 2 minimal controls per service row (mirror the httpInspect controls): an enable checkbox and, when enabled, a debug-port number input, with `[(ngModel)]` + unique names (`'dbg-en-'+draftKey`, `'dbg-port-'+draftKey`).
- [ ] **Step 4:** In `saveProjectDraft` add to BOTH update and create payloads:
```ts
          debug: {
            enabled: service.debugEnabled,
            ...(service.debugPort != null ? { port: Math.max(0, Math.floor(service.debugPort)) } : {}),
          },
```
- [ ] **Step 5:** `cd frontend && bun run build` → PASS; `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless` → green. If draft construction diverges from the healthCheck/httpInspect pattern, STOP and report DONE_WITH_CONCERNS.
- [ ] **Step 6:** Commit `feat(frontend): edit debug config in the config form`.

---

## Self-Review

**Spec coverage:** shared types (T1); pure NODE_OPTIONS builder (T2); inspector probe (T3); start-time injection (T4); routes GET+break-in (T5); config accept (T6); FE service + UiService (T7); panel + icon (T8); row button (T9); palette command (T10); config-form editing (T11). Node-first via NODE_OPTIONS, Python best-effort snippet, SIGUSR1 break-in Unix-only, default 9229, ws/instructions surfaced (no devtools:// link) — all constrained.

**Placeholder scan:** backend tasks carry full test + impl; frontend panel/service carry complete code; config-form (T11) mirrors the proven Phase-2/3 pattern with a STOP-and-report escape. One implementer-note (T8 template) grants minimal-fix latitude.

**Type consistency:** `DebugConfig`/`DebugInfo` (T1) consumed unchanged in T3-T11; `buildDebugNodeOptions`/`DEBUG_DEFAULT_PORT` (T2) used by T4/T5; `fetchInspectorWsUrl` (T3) by T5; `DebugService.fetchDebugInfo/breakIn`, `openDebug`, `debug` dep consistent across T7-T11.

**Ordering:** backend T2/T3 → T4/T5 → T6; frontend T7 → T8 → T9/T10/T11. Execute in numeric order.

**Known limits (by design):** SIGUSR1 opens on 9229 regardless of a custom debug.port; Python not auto-injected; UI can't launch DevTools. The Node inspector is an RCE channel bound to 127.0.0.1, opt-in — same accepted localhost posture.

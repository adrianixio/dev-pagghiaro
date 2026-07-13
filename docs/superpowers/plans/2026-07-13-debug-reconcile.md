# Debug Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Integrate the user's complete parallel debug rewrite (branch `3e08ce1`: watch stack, CDP/DAP adapters, recording, WS route, rich panel) onto the green `main` (phases 1-3 + a simple Phase-4 debug), replacing the simple Phase-4 debug, reconciling the ~7 overlapping files, finishing the known-red unit tests, adding characterization tests for the untested adapters, and adding CI — ending green.

**Architecture:** This is a **merge-repair**, not a rewrite. `main` (24e12bd, green) and the user's `3e08ce1` are two independent lines off the original root `1e05cef`; the earlier `15b680f` merge botched file resolution and lost the user's shared types + frontend service. We re-do the union deliberately: port the user's REAL files from `3e08ce1` (never re-invent), hand-merge the overlaps, finish the stubs the aspirational tests demand.

**Tech Stack:** Backend Bun + Elysia (`bun test`), frontend Angular 18 (`ng`/Karma), shared TS package resolved from source.

## Global Constraints

- **Base branch:** create `feat/debug-reconcile` fresh from `main` (24e12bd). `main` stays green and untouched until the final merge.
- **Never reinvent the user's code:** bring debug files in with `git checkout 3e08ce1 -- <path>`. Only hand-write: the overlap merges, the stub completions the tests demand, characterization tests, CI.
- **The user's debug REPLACES the simple Phase-4 debug** (`debug-options.ts`, `debug-inspector.ts`, `routes/debug.ts`, `frontend/src/app/debug/debug-panel.component.ts`, and the Phase-4 `debug.service.ts`).
- **Do NOT bring in local/IDE cruft** from `3e08ce1`: `.idea/*`, `.claude/settings.local.json`, and do NOT re-introduce the phantom `apps/frontend/` workspace member (package.json/README).
- Keep `log-bus.ts` untouched; keep all phase 1-3 behavior intact.
- Green bar to hit at the end: `cd apps/backend && bun test` all pass; `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless` all pass; `cd apps/backend && bun run build` and `cd frontend && bun run build` succeed; `cd packages/shared && bunx tsc --noEmit` clean.

## Reference: file sets (computed)

- **OVERLAP — both lines touched, hand-merge (union):** `packages/shared/src/models.ts`, `apps/backend/src/config-store.ts`, `apps/backend/src/process-context.ts`, `apps/backend/src/routes/services.ts`, `apps/backend/src/routes/debug.ts` (mine → delete; theirs, if any, superseded by ws-debug), `frontend/src/app/services/debug.service.ts` (adopt THEIRS wholesale), `frontend/src/app/services/project.service.ts`.
- **THEIRS-ONLY — port via checkout `3e08ce1`:** `apps/backend/src/debug/{cdp-adapter,dap-adapter,debug-manager,debugpy-installer,port-allocator,recording-store,runtime-detector,watch-registry}.ts`, `apps/backend/src/routes/ws-debug.ts`, `frontend/src/app/components/debug-panel/debug-panel.component.ts`, `frontend/src/app/services/terminal.service.ts`, `packages/shared/src/debug-presets.ts`, `packages/shared/src/index.ts`, plus docs `AGENTS.md`, `apps/backend/AGENTS.md`, `frontend/AGENTS.md`, `packages/shared/AGENTS.md`, `features/debug-watch.md`, `features/auto-record-all-vars.md`.
- **MINE (Phase-4 debug) — delete:** `apps/backend/src/debug-options.ts`(+test), `apps/backend/src/debug-inspector.ts`(+test), `apps/backend/src/routes/debug.ts`(+test), `frontend/src/app/debug/debug-panel.component.ts`.
- **Aspirational test spec (from `15b680f`):** `apps/backend/src/debug/runtime-detector.test.ts`, `apps/backend/src/debug/debug-manager.test.ts` — bring these in; they define `planNodeSpawn`/`detectLanguage`/`shouldSkipDirectTsNodeRewriteForPlatform` behavior to finish.
- **Excluded cruft:** `.idea/*`, `.claude/settings.local.json`, `apps/frontend/*`.

---

### Task 1: Branch + remove Phase-4 debug + port docs

**Goal:** Clean base: `feat/debug-reconcile` off `main`, Phase-4 debug removed, its wiring unhooked, tests still green (minus the removed ones).

- [ ] **Step 1:** `git checkout main && git checkout -b feat/debug-reconcile` (main == 24e12bd).
- [ ] **Step 2: Delete Phase-4 debug files:**
```
git rm apps/backend/src/debug-options.ts apps/backend/src/debug-options.test.ts \
       apps/backend/src/debug-inspector.ts apps/backend/src/debug-inspector.test.ts \
       apps/backend/src/routes/debug.ts apps/backend/src/routes/debug.test.ts \
       frontend/src/app/debug/debug-panel.component.ts
```
- [ ] **Step 3: Unhook Phase-4 wiring:**
  - `apps/backend/src/index.ts`: remove `import { debugRouter } from './routes/debug'` and the `.use(debugRouter)`.
  - `apps/backend/src/process-manager.ts`: remove `import { buildDebugNodeOptions, DEBUG_DEFAULT_PORT } from './debug-options'` and the NODE_OPTIONS injection block (`if (service.debug?.enabled === true) { ... }`). Leave a clean gap — the new debug-manager injection lands here in Task 6.
  - `frontend/src/app/layout/app-shell.component.ts`: remove the `import { DebugPanelComponent } from '../debug/debug-panel.component'` and its entry in `imports` (the `@if (ui.debugTarget())` render is rewired in Task 7, not removed).
- [ ] **Step 4:** Backend build to confirm no dangling Phase-4 refs: `cd apps/backend && bun run build`. (Frontend will not build yet — expected; the panel import is dangling until Task 7.)
- [ ] **Step 5:** Commit `chore(debug): remove simple Phase-4 debug ahead of watch-stack integration` (+ `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` on every commit).

---

### Task 2: Port shared debug types + reconcile models.ts

**Goal:** `packages/shared` type-checks with BOTH my phase 1-3 types AND the user's full debug type layer.

- [ ] **Step 1: Port the additive shared files** (theirs-only): `git checkout 3e08ce1 -- packages/shared/src/debug-presets.ts`.
- [ ] **Step 2: Reconcile `packages/shared/src/index.ts`.** It is theirs-only, but confirm the ported version re-exports BOTH `./models` and `./debug-presets` (and nothing my code needs is dropped). If `main`'s index.ts differs, hand-merge so it has `export * from './models'; export * from './debug-presets';`.
- [ ] **Step 3: Reconcile `packages/shared/src/models.ts` (union).** `main`'s models.ts has my log/health/http types + the Phase-4 `DebugConfig`/`DebugInfo`. `3e08ce1`'s models.ts has the debug watch/recording type layer. Produce the union:
  - Extract the full debug type block from theirs: `git show 3e08ce1:packages/shared/src/models.ts` — copy every debug type it defines (`DebugLanguage`, `DebugWatch`, `CreateDebugWatchBody`, `DebugSample`, `DebugSession*`/session-state, `DebugWatchPreset`, `DebugRecording`, `DebugRecordingSummary`, `DebugRecordingTrack`, `DebugScopeSnapshot`, `DebugScopeVariable`, `DebugWsServerMessage` + payloads, and any `ServiceConfig` debug fields).
  - Merge into `main`'s models.ts: keep all my types (log/health/http/introspection). For `ServiceConfig`: adopt the user's debug shape — they treat `debug` as the config object AND add **`debugWatches?: DebugWatch[]`** and (for the frontend) **`persistDebugWatches?: boolean`**. Reconcile the `debug?` field: keep `debug?: DebugConfig` (backend + config-form use the object) and ADD `debugWatches?` and `persistDebugWatches?` as separate fields (per the frontend-map finding — the frontend `setServiceDebug` bug is fixed in Task 7, not by making `debug` a boolean).
  - Remove my Phase-4-only `DebugInfo` (consumed only by the deleted `routes/debug.ts`). Keep `DebugConfig` (still used by config-form + config-store validator + debug-manager's `service.debug`).
- [ ] **Step 4:** `cd packages/shared && bunx tsc --noEmit` → must be clean (no missing debug members). Also `cd apps/backend && bun run build`.
- [ ] **Step 5:** Commit `feat(shared): integrate debug watch/recording type layer`.

---

### Task 3: Port the backend debug subsystem (as-is)

**Goal:** The user's real backend debug modules present and importing cleanly against the Task-2 shared types.

- [ ] **Step 1: Port theirs-only backend debug files:**
```
git checkout 3e08ce1 -- \
  apps/backend/src/debug/cdp-adapter.ts apps/backend/src/debug/dap-adapter.ts \
  apps/backend/src/debug/debug-manager.ts apps/backend/src/debug/debugpy-installer.ts \
  apps/backend/src/debug/port-allocator.ts apps/backend/src/debug/recording-store.ts \
  apps/backend/src/debug/runtime-detector.ts apps/backend/src/debug/watch-registry.ts \
  apps/backend/src/routes/ws-debug.ts
```
- [ ] **Step 2:** `cd apps/backend && bun run build` → resolve any import errors that are purely type-name mismatches against Task 2 (add a missing type to shared if the adapters reference one not yet ported — grep the ported files for `@dev-pagghiaro/shared` imports and confirm each exists). Do NOT change the adapters' logic.
- [ ] **Step 3:** `cd apps/backend && bun test` → the suite runs; the two ported-later debug tests aren't here yet, so expect green except nothing new. Confirm no regression in phases 1-3 tests.
- [ ] **Step 4:** Commit `feat(backend): port debug watch-stack subsystem from debug branch`.

---

### Task 4: Reconcile backend config + service routes (overlap)

**Goal:** `config-store` and `routes/services` validate/accept the user's debug config (incl. `debugWatches`) alongside my health/http config.

- [ ] **Step 1: `apps/backend/src/config-store.ts`.** Diff mine vs `git show 3e08ce1:apps/backend/src/config-store.ts`. Keep my `isHealthCheckConfig`/`isHttpInspectConfig` validators. Adopt the user's debug validation: their `isServiceConfig` accepts `debug` (their shape) + `debugWatches`. Union the `&&` chain so it validates: my health/http fields + their debug/debugWatches. If their `debug` validator shape differs from my Phase-4 `isDebugConfig`, use theirs (it's the canonical shape now).
- [ ] **Step 2: `apps/backend/src/routes/services.ts`.** Union the Elysia Create/Update schemas: keep my `healthCheck`/`httpInspect`, adopt the user's `debug`/`debugWatches`/`persistDebugWatches` schema fields (copy from `git show 3e08ce1:apps/backend/src/routes/services.ts`). Ensure the POST create handler passes them through.
- [ ] **Step 3: `apps/backend/src/process-context.ts`.** Diff both. Keep my `describeServiceEnv`. Bring in any debug-related change theirs made (if none debug-specific, keep mine). Reconcile so both my introspection and their debug needs are satisfied.
- [ ] **Step 4:** `cd apps/backend && bun test` → green; `bun run build` clean.
- [ ] **Step 5:** Commit `feat(backend): accept debug watch config in store + service routes`.

---

### Task 5: Finish the red debug unit tests (runtime-detector + debug-manager)

**Goal:** Complete the stubs the aspirational tests demand. TDD: the tests already exist (bring them in), make them pass.

- [ ] **Step 1: Bring in the spec tests** from the botched merge:
```
git checkout 15b680f -- apps/backend/src/debug/runtime-detector.test.ts apps/backend/src/debug/debug-manager.test.ts
```
- [ ] **Step 2:** `cd apps/backend && bun test debug/runtime-detector debug/debug-manager` → RED (stub `planNodeSpawn()`, missing export, `detectLanguage` gaps).
- [ ] **Step 3: Implement `planNodeSpawn(command, env?)`** in `apps/backend/src/debug/runtime-detector.ts` per the tests' exact expectations:
  - `node`/`tsx` (and any NODE_BINS that aren't ts-node/npm-like): splice `--inspect=127.0.0.1:0` right after the binary token → `{ command: '<bin> --inspect=127.0.0.1:0 <rest>', env: {} }`.
  - `ts-node <args>` (CJS): → `{ command: 'node -r ts-node/register --inspect=127.0.0.1:0 <rest>', env: {} }`.
  - `ts-node --esm <args>` (ESM): → `{ command: 'node --loader ts-node/esm --inspect=127.0.0.1:0 <rest-without---esm>', env: {} }`.
  - npm-like wrappers (`npm`/`pnpm`/`yarn`, incl. `.cmd`) / `run` scripts where argv can't be rewritten: → `{ env: { NODE_OPTIONS: '--inspect=127.0.0.1:0' + (existing ? ' ' + existing : '') } }`, no `command`.
  - Dedup: if the command already contains `--inspect` → return `{ command: <unchanged>, env: {} }`; if `env.NODE_OPTIONS` already contains `--inspect` → return `{ command: <unchanged>, env: {} }` (no double). Signature becomes `planNodeSpawn(command: string, env?: Record<string,string>): SpawnMutation`.
- [ ] **Step 4: Fix `detectLanguage`** in the same file: add `ts-node-esm` to NODE_BINS (or match `ts-node*`); make `bareName` also strip `.cmd`/`.ps1`/`.bat` (not just `.exe`) so `npm.cmd`/`pnpm.cmd`/`yarn.cmd` resolve to their base and hit NPM_LIKE → `'node'`.
- [ ] **Step 5: Add `shouldSkipDirectTsNodeRewriteForPlatform(platform: string): boolean`** export to `apps/backend/src/debug/debug-manager.ts` → `return platform === 'win32'`. Wire debug-manager's node path to use it: on `win32`, skip the direct `ts-node → node -r/​--loader` rewrite and fall back to the NODE_OPTIONS route (the `-r ts-node/register` shim is unreliable under Windows shells). (`planNodeSpawn` itself stays platform-agnostic per its tests; the gating lives in debug-manager where it calls the planner.)
- [ ] **Step 6:** `cd apps/backend && bun test debug/runtime-detector debug/debug-manager` → GREEN; then full `bun test`.
- [ ] **Step 7:** Commit `feat(backend): complete runtime-detector spawn planning + platform gating`.

---

### Task 6: Wire debug-manager into the process lifecycle + register ws-debug

**Goal:** The debugger actually engages: spawn mutation on start, attach after start, teardown on exit; WS route live.

- [ ] **Step 1: `apps/backend/src/index.ts`:** import `wsDebugRouter` from `./routes/ws-debug` and add `.use(wsDebugRouter)` (near the other routers).
- [ ] **Step 2: `apps/backend/src/process-manager.ts` `start()`:** where the Phase-4 injection was removed (Task 1), integrate debug-manager. After `processContext` is built and before `spawnPty`:
```ts
      const debugOverrides = await debugManager.prepareSpawn(service, { cwd, env: processContext });
      const spawnCommand = debugOverrides?.command ?? service.command;
      if (debugOverrides?.env) Object.assign(processContext, debugOverrides.env);
```
  Pass `spawnCommand` to `spawnPty` (replace the `command: service.command` argument with `command: spawnCommand`). Import `debugManager` from `./debug/debug-manager`.
- [ ] **Step 3:** After a successful spawn (where the running state is set), call `debugManager.onProcessStarted(service)`. In the `pty.exited` handler, call `debugManager.onProcessExited(service.id)` (next to the existing metrics/health/proxy untrack calls).
- [ ] **Step 4: Verify** `cd apps/backend && bun test` green. Runtime smoke: start the backend on a temp port and confirm boot + that `/ws/debug/:id` upgrades (or at least the server starts without error). If a server can't run here, report DONE_WITH_CONCERNS.
- [ ] **Step 5:** Commit `feat(backend): engage debug-manager across the process lifecycle`.

---

### Task 7: Frontend reconciliation — adopt the real debug service + panel

**Goal:** Frontend compiles with the user's debugger as canonical; my Phase-4 frontend debug gone.

- [ ] **Step 1: Adopt the real frontend debug service** (overwrite my Phase-4 stub): `git checkout 3e08ce1 -- frontend/src/app/services/debug.service.ts frontend/src/app/components/debug-panel/debug-panel.component.ts frontend/src/app/services/terminal.service.ts`.
- [ ] **Step 2: Reconcile `frontend/src/app/services/project.service.ts` (overlap, union).** Keep all my phase 1-3 wiring (log/health/http/introspect polling + updaters). Bring in the user's debug methods from `git show 3e08ce1:frontend/src/app/services/project.service.ts` (`setServiceDebug`, `setServicePersistDebugWatches`, watch/recording plumbing). **Fix the `setServiceDebug` bug** flagged in review: it must send/store `debug` as the `DebugConfig` OBJECT (`{ debug: { ...service.debug, enabled } }` and `{ ...service, debug: { ...service.debug, enabled } }`), NOT a bare boolean. `setServicePersistDebugWatches` sends `{ persistDebugWatches: enabled }` (now valid via the Task-2 shared field).
- [ ] **Step 3: `frontend/src/app/layout/app-shell.component.ts`:** import the WIP panel `../components/debug-panel/debug-panel.component`, add to `imports`, and render it with the required inputs:
```html
@if (ui.debugTarget(); as t) { <app-debug-panel [projectId]="t.projectId" [serviceId]="t.serviceId" /> }
```
(The palette `debug:` command, service-row `bug` button, `UiService.openDebug/closeDebug/debugTarget`, and the `Bug` icon all stay — panel-agnostic.)
- [ ] **Step 4:** `cd frontend && bun run build` → MUST pass (this is where the TS2322/TS2353 errors must be gone). Then `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless` → existing suite green (update any spec that referenced my removed Phase-4 panel).
- [ ] **Step 5:** Commit `feat(frontend): adopt debug watch panel + service, drop Phase-4 debug`.

---

### Task 8: Characterization tests — watch-registry + recording-store (pure state)

**Goal:** Pin the pure in-memory logic. (Both are module singletons — `resetService(serviceId)` in `beforeEach`.)

- [ ] **Step 1: `apps/backend/src/debug/watch-registry.test.ts`** — assert (per the mapped behavior): `addWatch` throws on empty expr, trims, clamps `intervalMs`→[50,60000] default 500 and `bufferSize`→[1,5000] default 500, returns a clone; `pushSample` ring caps at `bufferSize` dropping oldest and sets `valueChanged` correctly (equal value → false, changed → true); `getHistory` from/to filtering; `reorderWatches` returns `null` on mismatch/dup/unknown-id and reorders otherwise; `removeWatch` false when absent; `setAdapterState` patch semantics (`message:null` deletes); `resetService` clears + resets status to 'detached'.
- [ ] **Step 2:** RED (write asserts against current behavior; they should mostly pass since the code exists — these are characterization tests pinning current behavior). Where an assert fails, it means I mis-stated behavior → fix the TEST to match the code (characterization pins actual behavior), not the code.
- [ ] **Step 3: `apps/backend/src/debug/recording-store.test.ts`** — `startRecording` throws when already active; default name format; manual sample draining creates buckets; logs/metrics/status caps (5000/1000/200) drop oldest; auto mode throws without `snapshotScope`, clamps interval[250,10000]/maxSnapshots[1,500]/frameDepth[1,10], auto-stops at max, pushes error snapshot on rejection; `stopRecording` returns null on no-active/id-mismatch, unshifts newest-first, caps `finished` at 25; `removeRecording` false when absent; `resetService` clears. Use the injectable `options.snapshotScope` seam for the auto path.
- [ ] **Step 4:** `cd apps/backend && bun test debug/watch-registry debug/recording-store` → GREEN; full `bun test`.
- [ ] **Step 5:** Commit `test(backend): characterization tests for watch-registry + recording-store`.

---

### Task 9: Characterization tests — cdp-adapter + dap-adapter (parsers/pure)

**Goal:** Pin the protocol parsing + pure helpers without live sockets.

- [ ] **Step 1: Export the pure free functions** for testability (add `export` in the adapter files, no logic change): cdp — `isSimpleIdentifierPath`, `stringifyRuntime`, `normalizeType`, `toScopeVariable`; dap — `toDapScopeVariable`, `isPythonTruthyRepr`, `stringifyForCompare`.
- [ ] **Step 2: `apps/backend/src/debug/cdp-adapter.test.ts`** — table-drive `normalizeType` (string/number/boolean/function/null/array/object/unknown), `toScopeVariable` fallback chain, `isSimpleIdentifierPath` (accept `globalThis.counter`/`obj.prop.deep`/`_$x`; reject `a()`/`a[0]`/`a.b.`/leading-digit), `stringifyRuntime` (string verbatim/object JSON/circular fallback). Then `handleMessage`/`handleEvent` on a bare instance (construct, seed private `pending`/`onChangeWatches` via casts, feed fake `MessageEvent`): routing by method vs id, resolve on result, reject on error, "Malformed CDP response" branch, `Runtime.bindingCalled` gating on `bindingName` + watch membership.
- [ ] **Step 3: `apps/backend/src/debug/dap-adapter.test.ts`** — `PortInUseError` message; pure `toDapScopeVariable`/`isPythonTruthyRepr` (all falsy reprs: `None`/`False`/`0`/`[]`/`{}`/`()`/`set()`/empty)/`stringifyForCompare`; then the **framing parser `handleData`** (highest value): split frames across chunks, multiple frames per chunk, header-without-Content-Length recovery — feed Buffers and assert `dispatchMessage` calls; `dispatchMessage` response/`initialized`/`stopped`/`thread` routing by pre-seeding `pending`/`waitStoppedByThread`/`threads`; `resolveThreadId` prefer-main / substring / rehydrate-retry / throw.
- [ ] **Step 4:** `cd apps/backend && bun test debug/cdp-adapter debug/dap-adapter` → GREEN; full `bun test`. Use fake timers where intervals/timeouts fire; never open a real socket.
- [ ] **Step 5:** Commit `test(backend): characterization tests for cdp + dap adapters`.

---

### Task 10: CI + housekeeping

**Goal:** A green gate so a red merge can't reach main again; drop cruft.

- [ ] **Step 1: Create `.github/workflows/ci.yml`:**
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install
      - name: Shared typecheck
        run: cd packages/shared && bunx tsc --noEmit
      - name: Backend tests
        run: cd apps/backend && bun test
      - name: Backend build
        run: cd apps/backend && bun run build
      - name: Frontend build
        run: cd frontend && bun run build
      # Frontend Karma needs a browser; run headless Chrome.
      - name: Frontend tests
        run: cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless
```
> **Implementer note:** if ChromeHeadless isn't available on the runner without setup, add a step to install Chrome (e.g. `browser-actions/setup-chrome@v1`) or switch the frontend test step to `ChromeHeadlessNoSandbox` via a `customLaunchers` entry in `karma.conf.js`. Get the workflow syntactically valid; a maintainer can tune the runner.
- [ ] **Step 2: Housekeeping:** add `.idea/` and `.claude/settings.local.json` to `.gitignore` (do NOT commit IDE/local cruft that `3e08ce1` carried). Confirm the phantom `apps/frontend/` (package.json/README) was NOT re-introduced by any port; if present, remove it from the workspace and `package.json` `workspaces`.
- [ ] **Step 3: Reconcile root `package.json`:** diff `git show 3e08ce1:package.json` vs current — bring in any real dependency the debug subsystem needs (check the ported adapters' imports for a runtime dep; Bun's `WebSocket`/`node:net` are built-in so likely none). Bump `version` per the user's convention if appropriate; keep `workspaces` free of the phantom `apps/frontend`.
- [ ] **Step 4:** `bun install` clean; commit `ci: add test+build workflow; ignore IDE/local cruft`.

---

### Task 11: Final verification + docs port

**Goal:** Whole thing green end-to-end; project docs the user wrote are present.

- [ ] **Step 1: Port the user's docs** (harmless, theirs-only): `git checkout 3e08ce1 -- AGENTS.md apps/backend/AGENTS.md frontend/AGENTS.md packages/shared/AGENTS.md features/debug-watch.md features/auto-record-all-vars.md`.
- [ ] **Step 2: Full green sweep:**
  - `cd packages/shared && bunx tsc --noEmit` → clean.
  - `cd apps/backend && bun test` → all pass; `bun run build` → ok.
  - `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless` → all pass; `bun run build` → ok.
- [ ] **Step 3: Manual smoke (Node debug path):** with a service whose command is `node <script>` and `debug` enabled, start it via the app and confirm: process spawns with `--inspect`, `debug-manager` sniffs the inspector URL from the log stream, the CDP adapter attaches, and `/ws/debug/:id` streams a `session`. If a live run isn't possible here, report DONE_WITH_CONCERNS listing what to smoke manually.
- [ ] **Step 4:** Commit `docs: port debug feature notes + AGENTS guides`.

---

## Self-Review

**Coverage vs goal:** remove Phase-4 debug (T1) ✓; shared type union (T2) ✓; port backend debug (T3) ✓; reconcile config/routes/process-context overlaps (T4) ✓; finish red tests planNodeSpawn/detectLanguage/shouldSkip (T5) ✓; wire lifecycle + ws-debug (T6) ✓; frontend adopt real service+panel, fix setServiceDebug bug, drop Phase-4 (T7) ✓; adapter/store characterization tests per the mapped behaviors (T8, T9) ✓; CI (T10) ✓; housekeeping/cruft exclusion (T10) ✓; final green + smoke + docs (T11) ✓.

**Non-reinvention:** every substantial piece of the user's debugger is brought in via `git checkout 3e08ce1 -- …` (T2 debug-presets, T3 adapters, T7 service+panel+terminal). Hand-written work is limited to: overlap merges (T2 models, T4 config/routes, T7 project.service), the test-driven stub completions (T5), lifecycle wiring (T6), characterization tests (T8/T9), CI (T10). No debug feature code is reverse-engineered.

**Placeholder scan:** CI yaml and the T5 planNodeSpawn spec are concrete; the port/merge tasks are git operations + described unions (the authoritative content lives in `3e08ce1`, referenced by `git show`, not invented). T8/T9 name the exact functions + behaviors to assert (from the subsystem map). Two implementer-notes (CI browser, T2 type extraction) grant bounded latitude.

**Ordering:** shared (T2) before backend port (T3) before overlaps (T4) before tests (T5) before wiring (T6); frontend (T7) after shared; tests (T8/T9) after the code compiles; CI + verify (T10/T11) last.

**Risk to flag at execution:** the adapters (cdp/dap) carry ~1300 lines the characterization tests pin at the parser/pure level but do NOT exercise over a live socket — end-to-end debugger correctness still needs the T11 manual smoke (or a future integration test). This matches the user's chosen "+ adapter tests" tier (verify the logic, smoke the wire).

# Auto-record all variables — Plan

Black-box recording where every snapshot dumps the **full live scope** (locals
+ closure + user-defined globals) of the target's top stack frame, grouped by
source file. No watch setup needed.

Builds on existing recording infrastructure (Phase 10) and the pause/eval
machinery from CDP/DAP adapters (Phases 2/3). Lives next to the manual watch
flow — does not replace it.

---

## Goal

User clicks **Auto-record everything** → service runs N seconds → snapshot
sealed → player shows, per timestamp, a tree:
```
src/server.ts:42        locals: { req, res, gameId, payload }
src/socket/handler.ts:18 locals: { socket, room, msg }
globals (user-defined):  { app, io, gameState }
```
Scrubber moves through snapshots like the existing recording player.

---

## Architecture sketch

```
recording-store (extended)
  └── kind: 'manual' | 'auto'
      auto recordings carry  snapshots[]  instead of  tracks[]

cdp-adapter / dap-adapter
  └── snapshotScope(threadName?)  →  ScopeSnapshot
        - pause
        - stackTrace (depth N)
        - per frame: scopes → variables → filter
        - continue

new orchestrator
  recording-store starts a setInterval(intervalMs) calling adapter.snapshotScope
  pushes results into auto recording's snapshots[]
```

Same pause-cycle serialisation already used by `sampleChain` keeps multiple
auto-snapshots from racing.

---

## Shared model changes

```ts
export type DebugRecordingKind = 'manual' | 'auto';

export interface DebugScopeVariable {
  name: string;
  /** repr() / String(value) — debugpy/CDP both return strings */
  value: string;
  /** detected primitive type when known */
  type?: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'function' | 'array' | 'unknown';
}

export interface DebugScopeFrame {
  /** Resolved file path or `<eval>` / `<anonymous>`. */
  file: string;
  line: number;
  function: string;
  /** Local block scope. */
  locals: DebugScopeVariable[];
  /** Closures, flattened with depth cap. */
  closures: DebugScopeVariable[];
}

export interface DebugScopeSnapshot {
  t: number;
  /** Frames captured for this snapshot (top first, capped). */
  frames: DebugScopeFrame[];
  /** User-defined globals snapshot (excluding builtins detected at attach time). */
  userGlobals: DebugScopeVariable[];
  /** Optional capture error (e.g. pause timed out) — frames empty in that case. */
  error?: string;
}

export interface DebugRecording {
  // existing fields…
  kind?: DebugRecordingKind;             // default 'manual'
  /** Populated for `kind === 'auto'`. */
  snapshots?: DebugScopeSnapshot[];
}

export interface CreateDebugRecordingBody {
  // existing fields…
  kind?: DebugRecordingKind;
  /** Auto-only — sample interval. Default 1000 ms, min 250 ms, max 10 000 ms. */
  autoIntervalMs?: number;
  /** Auto-only — max snapshots before auto-stop. Default 100, max 500. */
  autoMaxSnapshots?: number;
  /** Auto-only — max stack frames per snapshot. Default 3, max 10. */
  autoFrameDepth?: number;
  /** Auto-only — include user-defined globals. Default true. */
  includeUserGlobals?: boolean;
  /** Auto-only — include closure variables. Default true. */
  includeClosures?: boolean;
  /** Auto-only — drop frames whose `file` matches this regex (default
   *  excludes node_modules + internal/ + node:internal/). */
  excludeFrameRegex?: string;
}
```

`DebugRecordingSummary` adds `kind?: DebugRecordingKind` and
`snapshotCount?: number`.

---

## Backend

### `cdp-adapter.ts` — new method

```ts
async snapshotScope(opts: SnapshotOpts): Promise<DebugScopeSnapshot>
```

Steps:
1. `Debugger.enable` once on connect (cache).
2. `Debugger.pause` then await `Debugger.paused` event in handleMessage (new
   waitPromise pattern, mirrors DAP `waitStoppedByThread`).
3. From `paused.callFrames` take first `autoFrameDepth` entries.
4. Per frame:
   - `frame.url`, `frame.location.lineNumber`, `frame.functionName`
   - For each `scope` of `scope.type in ['local','closure']`:
     - `Runtime.getProperties(scope.object.objectId, ownProperties:true, accessorPropertiesOnly:false, generatePreview:true)`
     - Map to `DebugScopeVariable` (name, `value` from preview/description, type detected)
5. If `includeUserGlobals`: `Runtime.evaluate('Object.keys(globalThis).filter(k => !__pagghiaroBuiltinGlobals.has(k))')` then `getProperties` of those keys.
   - At `connect()`, also evaluate `globalThis.__pagghiaroBuiltinGlobals = new Set(Object.keys(globalThis))` to baseline. Subtract → user-defined.
6. `Debugger.resume`.
7. Return assembled snapshot.

Apply `excludeFrameRegex` filter.

### `dap-adapter.ts` — new method

Similar shape, DAP-native:
1. Pause target thread (existing `resolveThreadId` + `waitForStoppedEvent`).
2. `stackTrace { threadId, levels: autoFrameDepth }` → frames.
3. Per frame: `scopes { frameId }` → list of `{name, variablesReference, expensive}`. Filter to `Locals` and (if `includeClosures`) anything not `Globals`.
4. Per scope: `variables { variablesReference }` → `[{name, value, type, variablesReference}]`. Cap nested expansion to depth 1.
5. If `includeUserGlobals`: find `Globals` scope → `variables` → filter user-defined via baseline (capture once at attach time via `evaluate('list(globals().keys())')`).
6. `continue { threadId, singleThread: true }`.

Frame `file` from `frame.source.path`.

### `recording-store.ts` — auto kind

- `startAutoRecording(serviceId, name, opts)` parallel to manual:
  - Validates: only one active recording per service (existing rule).
  - Resolves the language adapter (lookup CDP or DAP instance — needs new
    accessor in `debug-manager` returning the live adapter).
  - Sets `setInterval(opts.autoIntervalMs)` calling
    `adapter.snapshotScope(opts)`; each result pushed into
    `capture.snapshots`. Auto-stops at `autoMaxSnapshots`.
  - Same `subscribeStarted` / `subscribeStopped` / `subscribeRemoved` events
    as manual — UI already listens.
- `stopRecording` works as today; finalises snapshot list.
- Reuse existing per-service cap (25 finished total, mixed manual + auto).

### `routes/debug.ts`

- Existing `POST /recordings` accepts `kind: 'auto'` plus the new options
  (or new sibling `POST /recordings/auto` if signature gets too wide — leans
  toward sibling for clarity).
- Schema validation enforces ranges + regex parsability.

### `debug-manager.ts`

- Expose `getActiveAdapter(serviceId): CdpAdapter | DapAdapter | null` so the
  recording store can hand the snapshot job to the right adapter without
  importing both.

---

## Frontend

### `debug.service.ts`

- New methods `startAutoRecording(serviceId, opts)` mirroring the manual one.
- `recordings` state already carries summaries; player will fetch the full
  recording (existing `getRecording`) and switch view based on `kind`.

### `debug-panel.component.ts`

- New disclosure section in the recordings card: **"Auto-record everything
  (experimental)"** with form:
  - Interval (range 250–10000 ms, default 1000)
  - Max snapshots (range 1–500, default 100)
  - Frame depth (range 1–10, default 3)
  - Toggles: include closures, include user globals
  - Exclude regex (textarea, default
    `(?:node_modules|^internal/|^node:internal/)`)
  - Big button **Start auto-recording** (disabled if another recording is
    active or status ≠ attached).
- Recording row shows `auto · N snapshots` chip when `kind === 'auto'`.
- Player branches on `kind`:
  - **manual** → existing per-track sparkline + value-at-playhead view.
  - **auto** → new tree view:
    - Scrubber + time label (existing).
    - Snapshot picker = nearest snapshot at or before playhead.
    - Render: `<details>` per file path with line+function header, table of
      `name | type | value` for locals + (collapsed) closures.
    - Separate `<details>` for user globals.
    - Diff highlight: variables whose value changed vs the prior snapshot
      get a `bg-country-yellow/10` row tint.
- Reuse JSON/CSV export buttons. CSV for auto layout:
  `t,frame_file,frame_line,scope,name,type,value`.

### Files

- `apps/backend/src/debug/cdp-adapter.ts`
- `apps/backend/src/debug/dap-adapter.ts`
- `apps/backend/src/debug/debug-manager.ts` (`getActiveAdapter`)
- `apps/backend/src/debug/recording-store.ts` (auto branch)
- `apps/backend/src/routes/debug.ts` (route + schema)
- `packages/shared/src/models.ts` (types)
- `frontend/src/app/services/debug.service.ts`
- `frontend/src/app/components/debug-panel/debug-panel.component.ts`

---

## Phase split

1. **Shared types + backend skeleton** — DebugScopeSnapshot model, route
   accepting auto kind, recording-store branch with stub snapshotScope (returns
   empty frames). Frontend stub: button + recording row chip + raw JSON dump
   in player. Smoke: round-trip works, snapshots empty.
2. **CDP scope dump** — implement `Debugger.enable` + `pause` + `paused`
   wait + `Runtime.getProperties` walk. Baseline user-globals at attach.
   Smoke on Node `tick.js` with closures and user globals.
3. **DAP scope dump** — debugpy `scopes` + `variables` walk, baseline at
   attach via `list(globals())`. Smoke on Python multi-thread script.
4. **Player tree view** — `<details>` per file, value diff highlight,
   CSV export shape.
5. **Polish** — exclude-regex defaulting, depth caps, error surfacing
   (snapshot with `error` field renders muted row), README note.

Each phase ships behind the same UI button — graceful degradation if
adapter doesn't implement snapshotScope yet.

---

## Risks / known limits up front

- **Pause overhead is real.** ~50–200 ms per snapshot per thread. At 1 Hz
  this jitters timing-sensitive code. Document on the form and default
  interval generously.
- **Closure traversal cost.** `Runtime.getProperties` is O(scope size) per
  frame; closures with ~hundreds of bindings get big. Depth cap 1 inside
  closures (don't recurse into nested objects).
- **Bun parity.** `Debugger.*` domain partially implemented. Implementation
  may degrade to "globals only" on Bun — surface as `error: "Bun inspector
  does not expose Debugger.scopeChain"` per snapshot, recording still works.
- **Globals baseline must run before user code modifies globals.** Captured
  in `connect()` right after `Runtime.enable`. If service mutates globals
  in a top-level await before debugpy attaches in `--wait-for-client`, we
  miss the true baseline. Document.
- **Variable value strings only.** No live tree-expand of nested objects in
  player; `value` is the runtime's repr (`{ a: 1, b: 2 }` truncated by
  default preview). Deep-tree view = follow-up.
- **Storage budget.** Snapshots are heavier than samples. Cap default 100
  + per-snapshot frame cap 3 keeps a recording under ~500 KB JSON in
  practice. CSV grows linearly.
- **Subprocess / Node cluster.** Out of scope (covered by future Phase 10
  multi-process item).

---

## Suggested defaults

| Option | Default |
|--------|---------|
| `autoIntervalMs` | `1000` |
| `autoMaxSnapshots` | `100` |
| `autoFrameDepth` | `3` |
| `includeUserGlobals` | `true` |
| `includeClosures` | `true` |
| `excludeFrameRegex` | `(?:node_modules\|^internal/\|^node:internal/)` |

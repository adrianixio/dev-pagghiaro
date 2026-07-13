# Debug Watch — Roadmap

Live variable watching with volatile history for orchestrated services.
Phases 1–9 are fully shipped. Phase 10 partially shipped: recordings +
time-travel scrubbing live; logpoints, multi-process, remote hosts, and
other languages still planned.

---

## Architecture (current)

```
Backend (Bun/Elysia)
└── debug/
    ├── watch-registry.ts     in-mem registry, ring buffer per watch, pub/sub bus
    ├── runtime-detector.ts   detect language, plan spawn mutation
    ├── port-allocator.ts     pre-allocate free TCP port (Python only)
    ├── debug-manager.ts      orchestrator, branches CDP vs DAP
    ├── cdp-adapter.ts        node/bun via Chrome DevTools Protocol over WS
    └── dap-adapter.ts        python via Debug Adapter Protocol over TCP
                              (pause / stackTrace / evaluate(frameId) / continue)

REST  /api/services/:id/debug/(session|watches|watches/:wid|watches/:wid/history)
WS    /ws/debug/:id                live session + sample stream

Frontend (Angular standalone)
├── services/debug.service.ts       signal store, WS client, REST CRUD
└── components/debug-panel/          inline panel inside service-card
```

Shared contracts in `packages/shared/src/models.ts`:
`DebugLanguage`, `DebugWatch`, `DebugSample`, `DebugSessionState`,
`DebugWsServerMessage`, plus `debug?: boolean` on `ServiceConfig`.

---

## Phase 1 — Foundation ✅

Goal: contracts wired end-to-end with a UI shell, no live samples.

- Shared types and WS message union.
- In-memory `WatchRegistry` (ring buffer per watch, pub/sub bus mirroring `log-bus`).
- REST CRUD `/api/services/:id/debug/watches`.
- WS bridge `/ws/debug/:serviceId` with snapshot-on-open + live updates.
- Frontend `DebugService` (signal store) + `DebugPanelComponent` skeleton.
- Bug button on service card toggles the panel.

## Phase 2 — JS / TS / Bun adapter ✅

Goal: real samples for Node and Bun via the Chrome DevTools Protocol.

- Spawn mutation: `NODE_OPTIONS=--inspect=127.0.0.1:0` for node-likes (also covers
  `npm`, `tsx`, `nodemon`); `bun --inspect=127.0.0.1:0 …` for Bun.
- Inspector URL parsed from stdout via the existing `logBus`.
- `CdpAdapter`: `Runtime.enable` then `Runtime.evaluate({returnByValue, timeout})`
  per watch on its own `setInterval`. Re-entrance guard so a slow eval doesn't
  queue up.
- UI toggle `Enable inspector on next start` PATCHes `service.debug` and prompts
  for restart.
- Smoke test passed: `node tick.js` with `globalThis.counter`, samples flow,
  bad expressions surface as `error` samples.

Bug fixed during testing: Node rejects WS connections to `ws://0.0.0.0:…` with
"Expected 101 status code". Sanitised URLs to `127.0.0.1` in `cdp-adapter.ts`.

## Phase 3 — Python adapter ✅

Goal: parity for Python services via debugpy + DAP.

- Spawn rewrite: `python -m debugpy --listen 127.0.0.1:PORT --wait-for-client …`
  with port pre-allocated by the backend (covers `python script.py`,
  `python -m mod`, `uvicorn|gunicorn|flask|pytest|…`).
- `DapAdapter`: TCP socket with `Content-Length: N\r\n\r\n{json}` framing.
  Handshake: initialize → attach → wait for `initialized` event →
  configurationDone → await attach response.
- Evaluate cycle: `pause(threadId)` → `stopped` event → `stackTrace` →
  `evaluate(expression, frameId, context:repl)` → `continue(threadId)`.
  Required because debugpy returns an empty result without a `frameId` and a
  `frameId` only exists for paused threads.
- Cycles serialised by a `sampleChain` promise so concurrent watches don't race.

Bugs fixed: unhandled rejection on attach (added eager `.catch`), empty
evaluate without frameId (pause/eval/continue cycle), connect retry too short
for debugpy's ~5–7 s cold start on Windows (now 80 × 250 ms).

---

## Phase 4 — UI polish ✅

Goal: make the panel useful for actual debugging sessions, not just a list.

- **Sparkline / chart per watch.** ✅ Inline SVG sparkline (numeric path or
  categorical dot-per-sample) lives in `sparklineFor(watchId)`; hover label
  shows current numeric range.
- **History table view.** ✅ Per-watch `historyExpanded` toggle reveals a
  scrollable table of timestamp · value · diff-from-previous; sample errors
  render in `country-red`.
- **Copy / export.** ✅ Panel-wide `Export session JSON` button plus per-watch
  JSON / CSV download via `exportWatch`.
- **Time-range export per watch.** ✅ `from`/`to` pickers per watch; backend
  `GET /api/services/:id/debug/watches/:wid/history?from=&to=&format=`
  enforces ordering and rejects empty ranges with `400 EMPTY_RANGE`.
- **Pause / resume per watch.** ✅ `toggleWatchPaused` snapshots the live
  history and freezes the displayed view; samples keep streaming server-side
  until the user resumes.
- **Better empty / unsupported states.** ✅ `unsupported` flips a "What is
  this?" hint; `isDetachedWhileRunning` exposes a `Restart now` shortcut
  next to the panel header.
- **Drag-reorder + group by source.** ✅ Angular CDK drop list + handle on
  each row, persisted via `reorderWatches` REST + `setWatchOrder` UI state.
  `groupBySource` toggle clusters by the auto-derived first-identifier (and
  Phase 8's `groupName` overrides it).
- **Persist watches across sessions.** ✅ Shipped under Phase 9 — see
  `persistDebugWatches` flag.

Touch points: [debug-panel.component.ts](frontend/src/app/components/debug-panel/debug-panel.component.ts),
[debug.service.ts](frontend/src/app/services/debug.service.ts),
[watch-registry.ts](apps/backend/src/debug/watch-registry.ts).

## Phase 5 — `onChange` watch mode ✅

Goal: capture every write to a variable, not just samples at an interval.

- **JS / TS / Bun.** `Object.defineProperty` / Proxy injection via
  `Runtime.evaluate`. For `globalThis.foo` watches, swap with an accessor pair
  that calls back into the inspector via `console.log` of a sentinel payload
  (parsed in adapter) or via a custom `Runtime.bindingCalled` binding (CDP
  `Runtime.addBinding`). Latter is cleaner — no stdout pollution.
- **Python.** `sys.settrace` / `sys.monitoring` (3.12+) hook installed during
  attach. Filter to module globals matching the watch path. On every line event
  that touches the target, push a sample.
- **Watch model change.** Extend `DebugWatch.mode` union to `'interval' |
  'onChange'`. Adapter chooses between interval timer and the change-hook
  install. Storage in registry unchanged.
- **Caveat.** Both approaches are limited to top-level rebinds; mutations to
  nested fields (`obj.x.y = 1`) won't trigger a binding-set. Document this and
  consider deep-watch via JSON snapshot diff as a follow-up.

Touch points: `cdp-adapter.ts`, `dap-adapter.ts`, shared
`DebugWatchMode`, `debug-panel` mode selector.

## Phase 6 — Multi-thread & async Python ✅

Goal: cover real Python web servers, not just single-threaded scripts.

- Cache **all** thread IDs from the `threads` request, not just the first one
  matching `/main/i`.
- Per-watch `threadName` filter (default: main thread).
- Pause-all vs pause-one strategy: `allThreadsContinued` semantics, ensure
  `continue` resumes only what we paused.
- Async / asyncio coroutine watches: evaluate against the running loop's
  current task by walking frames. Document that watching a coroutine's local is
  inherently sample-time only.
- Decide on behaviour for `pytest` / multi-process runners (debugpy's
  `subProcess: true`) — likely out of scope for v1, document as known limit.

Touch points: `dap-adapter.ts`, watch model (`threadName?: string`).

## Phase 7 — Adapter robustness ✅

Goal: stop failing silently when something in the user's environment is off.

- **Auto-install debugpy.** ✅ See
  [debugpy-installer.ts](apps/backend/src/debug/debugpy-installer.ts).
- **Suppressed debugpy startup warnings.** ✅ `python -X frozen_modules=off`
  + `PYDEVD_DISABLE_FILE_VALIDATION=1`.
- **Reattach on service restart.** ✅ panel shows `Restart now` when status
  flips to `detached` while the service is still running.
- **Port collision handling.** ✅ `allocateFreePort` now does a probe → close
  → re-bind validation cycle (3 retries) to narrow the TOCTOU window. When
  the race still bites, `DapAdapter` detects the all-`ECONNREFUSED` retry
  pattern and throws a typed `PortInUseError` with a user-actionable message
  ("Port :PORT may be in use by another process. Restart the service to
  retry with a fresh port."), instead of the generic socket error.
- **Health probe.** ✅ Both adapters now run a periodic ping after attach —
  `Runtime.evaluate("1")` every 10s for CDP, `threads` request every 15s for
  DAP. Three consecutive failures (or a 1.5s/3s timeout) close the adapter
  so the UI flips to `error` instead of looking attached against a dead
  inspector. Probes are `unref()`ed and skipped while the adapter is closed
  to avoid resurrecting it.

Touch points: `debug-manager.ts`, `cdp-adapter.ts`, `dap-adapter.ts`,
`debug-panel.component.ts`, new `health-probe.ts`.

## Phase 8 — Conditional & expression-rich watches ✅

Goal: move from "show me X" to "alert me when X".

- **Condition expressions.** ✅ `condition?: string` on `DebugWatch`. Sample
  is pushed only when the condition evaluates truthy. CDP combines value +
  condition into a single `Runtime.evaluate` for the `interval` mode; for
  `onChange` mode the condition is injected into the property setter so the
  binding only fires when the new value passes (`nv` is in scope). DAP issues
  two `evaluate` calls inside the same pause cycle and tests the Python repr
  against canonical falsy values (`False`, `None`, `0`, `''`, `[]`, `{}`,
  `set()`, …). Honoured in both modes for both languages.
- **Computed labels.** ✅ Optional `label?: string` shown in the watch row;
  the raw expression is shown smaller underneath when a label is set.
- **Watch groups.** ✅ Optional `groupName?: string` overrides the
  auto-derived first-identifier source so unrelated expressions cluster
  together (e.g. "Request lifecycle"). Whenever any watch carries a group
  name the panel automatically renders the group headers regardless of the
  `groupBySource` toggle, and ungrouped watches fall into a tail bucket so
  they don't get clustered by their auto-derived source.
- **Diff highlight.** ✅ `DebugSample.valueChanged?: boolean` set by the
  registry by stringifying the previous and next sample. Latest-value card
  flips border + adds a `changed` chip when the flag is true. The
  per-sample flag is also useful for future "only push on change" behaviour
  without forcing the adapter to re-implement the comparison.

Touch points: shared model, `watch-registry.ts`, adapters, panel.

## Phase 9 — Persistence & sharing ✅

Goal: stop losing useful watch sets when the backend restarts.

- **Persisted watches in `pagghiaro.json`.** ✅ Opt-in
  `service.persistDebugWatches` flag + `debugWatches[]` array; rehydrated by
  `restoreWatches` on first touch. Sample history stays volatile.
- **Import / export watch sets.** ✅ New backend endpoint
  `POST /api/services/:id/debug/watches/bulk` accepts up to 50 entries and
  returns `{added, failed[]}` (partial success). UI exposes:
  - **Export preset** — downloads the current watch list (without server
    metadata like `id`/`createdAt`) as `<service>-watches.json`.
  - **Import file…** — file picker accepts a JSON file (either the export
    shape `{watches:[…]}` or a bare array) and POSTs the parsed entries
    through the bulk endpoint. Schema-failed and dedupe-failed entries are
    surfaced inline.
  - **Drag-drop** the same JSON file onto the controls strip — visual
    `border-country-blue` cue while a drag is over the drop target.
- **Watch templates by language.** ✅ Built-in presets defined in shared
  [debug-presets.ts](packages/shared/src/debug-presets.ts) — Node process
  basics, Node Express lifecycle, Bun runtime basics, Python process basics,
  Python FastAPI/Uvicorn. The panel filters them against the current
  adapter language and exposes them in an `Apply template` dropdown that
  fans out into a single bulk-create call.

Touch points: `config-store.ts`, shared model, panel.

## Phase 10 — Future / nice-to-have ✅ (partial)

- **Recordings.** ✅ Named, time-bounded captures of every sample emitted by
  every watch. Subscribes to the live sample stream the moment
  `startRecording` is called and drains into per-watch buckets until
  `stopRecording` finalises the snapshot — uncapped by `bufferSize`. One
  recording active per service at a time (409 on conflict). Volatile,
  bounded to 25 recordings per service. Lives in
  [recording-store.ts](apps/backend/src/debug/recording-store.ts); REST under
  `/api/services/:id/debug/recordings`; WS pushes
  `recording-started/stopped/removed`. UI exposes name input, start/stop,
  live `MM:SS` duration chip, list with JSON/CSV export and delete.
- **Time-travel scrubbing.** ✅ Click *▶ Play* on any finished recording to
  open the inline player: per-track sparkline (numeric or categorical) with
  a dashed red playhead overlay, range slider scrubber, play/pause, speed
  selector (`0.5x`, `1x`, `2x`, `4x`, `8x`), and a "value at playhead" cell
  that resolves to the latest sample with `t ≤ startedAt + playhead` for
  each track. Frontend-only; the backend just serves the existing full-
  recording GET.
- **Browser DevTools-style logpoints** (a watch that pushes to a log instead
  of a buffer; integrate with the existing terminal pane). ⏳
- **Multi-process support** (Python subprocess, Node cluster workers): list
  attached children, scope watches per worker. ⏳
- **Remote services**: today everything assumes the inspector is on
  `127.0.0.1`. Allow `host` override per service for orchestrating in a
  container or remote VM. ⏳
- **Other languages**: Go (Delve via DAP), Ruby (`debug.gem` / DAP), Java
  (JDWP — different protocol, larger lift). ⏳

---

## Known limits (carry-overs)

- **Pause overhead (Python)**: each sample pauses the main thread for
  ~10–50 ms. Not usable for ms-precision timing-sensitive code.
- **debugpy cold start**: 5–7 s on Windows before accepting connections; the
  panel sits in `attaching` for that window.
- **Bun inspector parity**: `Runtime.evaluate` works, other CDP domains may
  not. Failures surface as per-sample errors rather than silent.
- **Eval is arbitrary code execution** in the target process. Acceptable
  because the user owns their services; documented in panel hint.
- **Volatile history**: ring buffer cleared on backend restart. Persistence
  arrives in Phase 9.

---

## Suggested order

1. **Phase 4 first** — biggest UX uplift for what's already shipped.
2. **Phase 7 (robustness)** — every later phase benefits from stable attach.
3. **Phase 9 (persistence)** — small, makes the feature feel non-throwaway.
4. **Phase 5 (onChange)** — the headline-grabbing feature, but only worth it
   on top of a solid base.
5. **Phase 6, 8, 10** — opportunistic, scope as needed per real usage.

/**
 * Chrome DevTools Protocol client used by the Node and Bun debug adapters.
 *
 * Each instance owns one WebSocket connection to a service's inspector and
 * runs the per-watch evaluation loops. The orchestrator (debug-manager) is
 * responsible for creating, attaching, and tearing the instance down in sync
 * with the underlying child process lifecycle.
 *
 * Two watch modes are supported:
 *   - `interval`: poll `Runtime.evaluate(expr)` every `intervalMs`.
 *   - `onChange`: register a `Runtime.addBinding` callback in the target
 *     context, then inject an accessor pair on the watched property so every
 *     write fires the binding. The adapter receives `Runtime.bindingCalled`
 *     events and converts them into samples.
 */

import type { DebugLanguage, DebugScopeSnapshot, DebugScopeVariable, DebugWatch } from '@dev-pagghiaro/shared';
import { watchRegistry } from './watch-registry';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface CdpSuccess {
  id: number;
  result: unknown;
}

interface CdpError {
  id: number;
  error: { code?: number; message: string };
}

const EVAL_TIMEOUT_MS = 2_000;
const HEALTH_PROBE_INTERVAL_MS = 10_000;
const HEALTH_PROBE_TIMEOUT_MS = 1_500;

export class CdpAdapter {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly intervals = new Map<string, ReturnType<typeof setInterval>>();
  private readonly inFlight = new Set<string>();
  private readonly onChangeWatches = new Set<string>();
  private bindingName = '';
  private bindingInstalled = false;
  private closed = false;
  private unsubscribeSession: (() => void) | null = null;
  private healthProbeHandle: ReturnType<typeof setInterval> | null = null;
  private debuggerEnabled = false;
  private waitPausedResolve: ((payload: Record<string, unknown>) => void) | null = null;

  constructor(
    readonly serviceId: string,
    readonly language: DebugLanguage,
    readonly inspectorUrl: string
  ) {}

  async connect(): Promise<void> {
    // Node's inspector validates the Host header — connecting via 0.0.0.0 is
    // rejected with "Expected 101". Always rewrite to a loopback host.
    const sanitizedUrl = this.inspectorUrl.replace(/(ws:\/\/)(0\.0\.0\.0|\[::\])/, '$1127.0.0.1');
    const ws = new WebSocket(sanitizedUrl);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.removeEventListener('error', onError);
        resolve();
      };
      const onError = (event: Event) => {
        ws.removeEventListener('open', onOpen);
        reject(new Error(`Inspector WS failed: ${(event as ErrorEvent).message ?? 'unknown'}`));
      };
      ws.addEventListener('open', onOpen, { once: true });
      ws.addEventListener('error', onError, { once: true });
    });

    ws.addEventListener('message', (event) => this.handleMessage(event));
    ws.addEventListener('close', () => this.close('inspector closed'));
    ws.addEventListener('error', () => this.close('inspector errored'));

    // Best-effort domain enable. Bun's inspector may reject some commands —
    // ignore failures here and let evaluate() surface real problems.
    try {
      await this.send('Runtime.enable');
    } catch {
      // ignore
    }

    watchRegistry.setAdapterState(this.serviceId, {
      language: this.language,
      status: 'attached',
      message: null,
    });

    // Sync intervals with the current watch list, then keep them in sync.
    this.syncWatches(watchRegistry.listWatches(this.serviceId));
    this.unsubscribeSession = watchRegistry.subscribeSession(this.serviceId, (state) => {
      this.syncWatches(state.watches);
    });

    this.startHealthProbe();
  }

  /**
   * Periodic `Runtime.evaluate("1")` — cheap and proves both the WS and the
   * inspector's evaluate path are still alive. Three consecutive failures
   * close the adapter so the UI flips to `error` instead of pretending to be
   * attached to a half-dead inspector.
   */
  private startHealthProbe(): void {
    if (this.healthProbeHandle) return;
    let consecutiveFailures = 0;
    this.healthProbeHandle = setInterval(() => {
      if (this.closed) return;
      const probe = Promise.race<unknown>([
        this.send('Runtime.evaluate', {
          expression: '1',
          returnByValue: true,
          timeout: HEALTH_PROBE_TIMEOUT_MS,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('health probe timed out')), HEALTH_PROBE_TIMEOUT_MS + 250)
        ),
      ]);
      probe
        .then(() => {
          consecutiveFailures = 0;
        })
        .catch(() => {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 3) {
            this.close('health probe failed');
          }
        });
    }, HEALTH_PROBE_INTERVAL_MS);
    this.healthProbeHandle.unref?.();
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;

    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    if (this.healthProbeHandle) {
      clearInterval(this.healthProbeHandle);
      this.healthProbeHandle = null;
    }

    for (const timer of this.intervals.values()) {
      clearInterval(timer);
    }
    this.intervals.clear();
    this.inFlight.clear();
    this.onChangeWatches.clear();

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('CDP adapter closed'));
    }
    this.pending.clear();

    try {
      this.ws?.close();
    } catch {
      // already gone
    }
    this.ws = null;

    watchRegistry.setAdapterState(this.serviceId, {
      status: 'detached',
      message: reason,
    });
  }

  private syncWatches(watches: DebugWatch[]): void {
    const nextIntervalIds = new Set<string>();
    const nextOnChangeIds = new Set<string>();
    for (const watch of watches) {
      if (watch.mode === 'onChange') nextOnChangeIds.add(watch.id);
      else nextIntervalIds.add(watch.id);
    }

    // Tear down interval watches that no longer exist (or switched mode).
    for (const id of [...this.intervals.keys()]) {
      if (!nextIntervalIds.has(id)) {
        const timer = this.intervals.get(id);
        if (timer) clearInterval(timer);
        this.intervals.delete(id);
        this.inFlight.delete(id);
      }
    }

    // Tear down onChange watches that disappeared (or switched mode).
    for (const id of [...this.onChangeWatches]) {
      if (!nextOnChangeIds.has(id)) {
        this.onChangeWatches.delete(id);
        void this.uninstallChangeHook(id);
      }
    }

    for (const watch of watches) {
      if (watch.mode === 'interval' && !this.intervals.has(watch.id)) {
        const timer = setInterval(() => {
          void this.sampleWatch(watch);
        }, watch.intervalMs);
        this.intervals.set(watch.id, timer);
        // Fire one immediate sample so the UI shows a value without waiting.
        void this.sampleWatch(watch);
      }
      if (watch.mode === 'onChange' && !this.onChangeWatches.has(watch.id)) {
        this.onChangeWatches.add(watch.id);
        void this.installChangeHook(watch);
      }
    }
  }

  private async sampleWatch(watch: DebugWatch): Promise<void> {
    if (this.closed) return;
    if (this.inFlight.has(watch.id)) return;
    this.inFlight.add(watch.id);
    const t = Date.now();

    // When a condition is set, wrap both expressions in a single eval and let
    // the target return `{v, c}` so we save a round-trip per sample. The
    // outer IIFE captures the user's expression literally — same trust model
    // as the bare `Runtime.evaluate(watch.expr)` we always do.
    const expression = watch.condition
      ? `((function(){const _v=(${watch.expr});const _c=(${watch.condition});return {v:_v,c:!!_c};}))()`
      : watch.expr;

    try {
      const result = await this.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        throwOnSideEffect: false,
        timeout: EVAL_TIMEOUT_MS,
      });
      const evalResult = result as {
        result?: { value?: unknown; description?: string };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };

      if (evalResult.exceptionDetails) {
        const text =
          evalResult.exceptionDetails.exception?.description ??
          evalResult.exceptionDetails.text ??
          'evaluation threw';
        watchRegistry.pushSample(this.serviceId, watch.id, { t, error: text });
        return;
      }

      const raw = evalResult.result?.value ?? evalResult.result?.description ?? null;

      if (watch.condition) {
        const wrapped = raw as { v?: unknown; c?: boolean } | null;
        if (!wrapped || wrapped.c !== true) {
          // Condition not met — drop the sample silently.
          return;
        }
        watchRegistry.pushSample(this.serviceId, watch.id, { t, value: wrapped.v ?? null });
      } else {
        watchRegistry.pushSample(this.serviceId, watch.id, { t, value: raw });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      watchRegistry.pushSample(this.serviceId, watch.id, { t, error: message });
    } finally {
      this.inFlight.delete(watch.id);
    }
  }

  /**
   * Register the global binding once (idempotent). The target calls
   * `globalThis[bindingName](payload)` from the injected setter and the
   * adapter receives a `Runtime.bindingCalled` event with that payload.
   */
  private async ensureBinding(): Promise<void> {
    if (this.bindingInstalled) return;
    // Underscore-prefixed name avoids clashing with anything user-visible.
    // The serviceId is sanitised to a valid JS identifier.
    const safeId = this.serviceId.replace(/[^A-Za-z0-9_]/g, '_');
    this.bindingName = `__pagghiaroOnChange_${safeId}`;
    try {
      await this.send('Runtime.addBinding', { name: this.bindingName });
      this.bindingInstalled = true;
    } catch (err) {
      // Bun's inspector does not implement addBinding; surface the failure
      // on every onChange watch installed against this session.
      throw new Error(
        `Runtime.addBinding not supported by this runtime: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Install an accessor pair on the watched property so every write fires
   * the global binding. Only dotted-identifier paths are supported (e.g.
   * `globalThis.counter`, `obj.prop.deep`); anything more elaborate falls
   * back to an error sample.
   */
  private async installChangeHook(watch: DebugWatch): Promise<void> {
    const t = Date.now();
    try {
      await this.ensureBinding();

      if (!isSimpleIdentifierPath(watch.expr)) {
        throw new Error('onChange supports only dotted identifier paths (e.g. globalThis.counter)');
      }

      const watchIdLiteral = JSON.stringify(watch.id);
      const exprLiteral = JSON.stringify(watch.expr);
      const bindingName = this.bindingName;
      // condition is injected as raw JS source — we wrap it in a function
      // body so a `return` is implicit and `nv` is in scope. Empty/undefined
      // condition collapses to a no-op gate (`true`).
      const conditionFnSrc = watch.condition
        ? `function(nv){ return (${watch.condition}); }`
        : 'function(){ return true; }';

      const installCode = `
(function() {
  const path = ${exprLiteral};
  const watchId = ${watchIdLiteral};
  const binding = globalThis[${JSON.stringify(bindingName)}];
  if (typeof binding !== 'function') {
    throw new Error('Binding ' + ${JSON.stringify(bindingName)} + ' not installed');
  }
  const conditionFn = ${conditionFnSrc};
  const parts = path.split('.');
  let obj = globalThis;
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === 'globalThis') continue;
    obj = obj == null ? obj : obj[parts[i]];
    if (obj == null) throw new Error('Path resolves to null/undefined: ' + parts.slice(0, i + 1).join('.'));
  }
  const key = parts[parts.length - 1];
  globalThis.__pagghiaroOnChange = globalThis.__pagghiaroOnChange || {};
  if (globalThis.__pagghiaroOnChange[watchId]) {
    // already installed (resync) — leave existing accessor in place
    return JSON.stringify({ alreadyInstalled: true });
  }
  const cell = { current: obj[key] };
  globalThis.__pagghiaroOnChange[watchId] = { obj, key, cell };
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: true,
    get() { return cell.current; },
    set(nv) {
      cell.current = nv;
      try {
        if (!conditionFn(nv)) return;
        binding(JSON.stringify({ watchId, t: Date.now(), v: nv }));
      } catch (e) {
        // Swallow binding/condition errors so user code still runs.
      }
    },
  });
  // Fire one initial sample so the UI gets the current value immediately.
  try {
    if (conditionFn(cell.current)) {
      binding(JSON.stringify({ watchId, t: Date.now(), v: cell.current }));
    }
  } catch (e) { /* swallow */ }
  return JSON.stringify({ installed: true });
})()
      `;

      const result = await this.send('Runtime.evaluate', {
        expression: installCode,
        returnByValue: true,
        timeout: EVAL_TIMEOUT_MS,
      });
      const evalResult = result as {
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };
      if (evalResult.exceptionDetails) {
        const text =
          evalResult.exceptionDetails.exception?.description ??
          evalResult.exceptionDetails.text ??
          'install failed';
        throw new Error(text);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      watchRegistry.pushSample(this.serviceId, watch.id, { t, error: message });
    }
  }

  private async uninstallChangeHook(watchId: string): Promise<void> {
    if (this.closed) return;
    const watchIdLiteral = JSON.stringify(watchId);
    const code = `
(function() {
  const map = globalThis.__pagghiaroOnChange;
  const entry = map && map[${watchIdLiteral}];
  if (!entry) return;
  try {
    Object.defineProperty(entry.obj, entry.key, {
      value: entry.cell.current,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch (_) {
    // Best-effort restore — leaving the accessor in place is harmless.
  }
  delete map[${watchIdLiteral}];
})()
    `;
    try {
      await this.send('Runtime.evaluate', { expression: code, returnByValue: true });
    } catch {
      // Target may already be gone — nothing to clean up.
    }
  }

  private send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.closed) {
      return Promise.reject(new Error('CDP adapter not connected'));
    }
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method };
    if (params !== undefined) payload['params'] = params;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, EVAL_TIMEOUT_MS + 500);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws!.send(JSON.stringify(payload));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private handleMessage(event: MessageEvent): void {
    const raw = typeof event.data === 'string' ? event.data : '';
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;

    const message = parsed as Partial<CdpSuccess & CdpError> & {
      method?: string;
      params?: Record<string, unknown>;
    };

    if (typeof message.method === 'string') {
      this.handleEvent(message.method, message.params ?? {});
      return;
    }

    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else if ('result' in message) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error('Malformed CDP response'));
    }
  }

  private handleEvent(method: string, params: Record<string, unknown>): void {
    if (method === 'Debugger.paused') {
      this.waitPausedResolve?.(params);
      this.waitPausedResolve = null;
      return;
    }
    if (method !== 'Runtime.bindingCalled') return;
    const name = params['name'];
    if (typeof name !== 'string' || name !== this.bindingName) return;

    const payload = params['payload'];
    if (typeof payload !== 'string') return;
    let parsed: { watchId?: string; t?: number; v?: unknown; error?: string };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const watchId = parsed.watchId;
    if (typeof watchId !== 'string' || !this.onChangeWatches.has(watchId)) return;

    const t = typeof parsed.t === 'number' ? parsed.t : Date.now();
    if (parsed.error) {
      watchRegistry.pushSample(this.serviceId, watchId, { t, error: parsed.error });
    } else {
      watchRegistry.pushSample(this.serviceId, watchId, { t, value: parsed.v ?? null });
    }
  }

  async snapshotScope(opts: {
    autoFrameDepth: number;
    includeUserGlobals: boolean;
    includeClosures: boolean;
    excludeFrameRegex?: string;
  }): Promise<DebugScopeSnapshot> {
    const t = Date.now();
    try {
      await this.send('Runtime.enable');
      if (!this.debuggerEnabled) {
        await this.send('Debugger.enable');
        this.debuggerEnabled = true;
      }
      const paused = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.waitPausedResolve = null;
          reject(new Error('Timed out waiting for Debugger.paused'));
        }, EVAL_TIMEOUT_MS + 1000);
        this.waitPausedResolve = (payload) => {
          clearTimeout(timeout);
          resolve(payload);
        };
      });
      await this.send('Debugger.pause');
      const pausedPayload = await paused;
      const callFrames = (pausedPayload['callFrames'] as Array<Record<string, unknown>> | undefined) ?? [];
      const excludeRe = opts.excludeFrameRegex ? new RegExp(opts.excludeFrameRegex) : null;
      const frames = [] as DebugScopeSnapshot['frames'];

      for (const frame of callFrames.slice(0, opts.autoFrameDepth)) {
        const url = String(frame['url'] ?? '<anonymous>');
        if (excludeRe && excludeRe.test(url)) continue;
        const location = (frame['location'] as Record<string, unknown> | undefined) ?? {};
        const line = Number(location['lineNumber'] ?? 0) + 1;
        const fn = String(frame['functionName'] ?? '<anonymous>');
        const scopes = (frame['scopeChain'] as Array<Record<string, unknown>> | undefined) ?? [];
        const locals: DebugScopeVariable[] = [];
        const closures: DebugScopeVariable[] = [];

        for (const scope of scopes) {
          const type = String(scope['type'] ?? '');
          if (type !== 'local' && !(opts.includeClosures && type === 'closure')) continue;
          const object = (scope['object'] as Record<string, unknown> | undefined) ?? {};
          const objectId = object['objectId'];
          if (typeof objectId !== 'string') continue;
          const propRes = await this.send('Runtime.getProperties', {
            objectId,
            ownProperties: true,
            accessorPropertiesOnly: false,
            generatePreview: true,
          }) as { result?: Array<Record<string, unknown>> };
          for (const prop of propRes.result ?? []) {
            if (!prop['enumerable']) continue;
            const variable = toScopeVariable(prop);
            if (type === 'local') locals.push(variable);
            else closures.push(variable);
          }
        }
        frames.push({ file: url, line, function: fn, locals, closures });
      }

      const userGlobals: DebugScopeVariable[] = [];
      if (opts.includeUserGlobals) {
        const globals = await this.send('Runtime.evaluate', {
          expression: 'Object.keys(globalThis)',
          returnByValue: true,
          timeout: EVAL_TIMEOUT_MS,
        }) as { result?: { value?: unknown } };
        const keys = Array.isArray(globals.result?.value) ? globals.result?.value as string[] : [];
        const filtered = keys.filter((key) => !key.startsWith('__'));
        for (const key of filtered.slice(0, 300)) {
          const v = await this.send('Runtime.evaluate', {
            expression: `globalThis[${JSON.stringify(key)}]`,
            returnByValue: true,
            timeout: EVAL_TIMEOUT_MS,
          }) as { result?: { type?: string; value?: unknown; description?: string } };
          userGlobals.push({
            name: key,
            value: stringifyRuntime(v.result?.value ?? v.result?.description ?? null),
            type: normalizeType(v.result?.type, v.result?.value),
          });
        }
      }

      await this.send('Debugger.resume');
      return { t, frames, userGlobals };
    } catch (err) {
      try { await this.send('Debugger.resume'); } catch { /* ignore */ }
      const message = err instanceof Error ? err.message : String(err);
      return { t, frames: [], userGlobals: [], error: message };
    }
  }
}

const SIMPLE_PATH_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

export function isSimpleIdentifierPath(expr: string): boolean {
  return SIMPLE_PATH_RE.test(expr.trim());
}

export function stringifyRuntime(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function normalizeType(type: unknown, value: unknown): DebugScopeVariable['type'] {
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'function') return type;
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

export function toScopeVariable(prop: Record<string, unknown>): DebugScopeVariable {
  const valueObj = (prop['value'] as Record<string, unknown> | undefined) ?? {};
  const raw = valueObj['value'] ?? valueObj['description'] ?? null;
  return {
    name: String(prop['name'] ?? 'unknown'),
    value: stringifyRuntime(raw),
    type: normalizeType(valueObj['type'], valueObj['value']),
  };
}

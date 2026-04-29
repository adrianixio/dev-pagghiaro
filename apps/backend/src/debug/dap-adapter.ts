/**
 * Debug Adapter Protocol client for the Python (debugpy) debug session.
 *
 * Talks to debugpy over a raw TCP socket using the standard DAP framing
 * (`Content-Length: N\r\n\r\n{json}`). The handshake is the canonical attach
 * sequence: initialize → attach → wait for initialized event → configurationDone.
 * Once attached, each watch is sampled by sending `evaluate` requests in a
 * REPL context. debugpy supports REPL-style evaluation while the program is
 * running without requiring a paused stack frame.
 */

import { Socket } from 'node:net';
import type { DebugScopeSnapshot, DebugScopeVariable, DebugWatch } from '@dev-pagghiaro/shared';
import { watchRegistry } from './watch-registry';

interface PendingRequest {
  resolve: (body: Record<string, unknown> | undefined) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const EVAL_TIMEOUT_MS = 2_000;
const HANDSHAKE_TIMEOUT_MS = 8_000;
const CONNECT_RETRY_DELAY_MS = 250;
const CONNECT_RETRY_MAX = 80;
const HEALTH_PROBE_INTERVAL_MS = 15_000;
const HEALTH_PROBE_TIMEOUT_MS = 3_000;

export class PortInUseError extends Error {
  constructor(public readonly port: number, public readonly host: string) {
    super(
      `debugpy never accepted a connection on ${host}:${port}. ` +
        `The port may have been claimed by another process. ` +
        `Restart the service to retry with a fresh port.`
    );
    this.name = 'PortInUseError';
  }
}

export class DapAdapter {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private nextSeq = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly intervals = new Map<string, ReturnType<typeof setInterval>>();
  private readonly inFlight = new Set<string>();
  private initializedReceived = false;
  private waitInitialized: (() => void) | null = null;
  private closed = false;
  private unsubscribeSession: (() => void) | null = null;
  /**
   * Cache of currently-known threads. Refreshed lazily and on every `thread`
   * event the adapter receives. Keyed by id; the name is normalised to lower
   * case for case-insensitive lookups.
   */
  private readonly threads = new Map<number, { name: string; nameLower: string }>();
  private threadsHydrated = false;
  /** Per-thread one-shot callbacks waiting for the matching `stopped` event. */
  private readonly waitStoppedByThread = new Map<number, (threadId: number) => void>();
  /** Serialises pause/eval/continue cycles so concurrent watches don't race. */
  private sampleChain: Promise<unknown> = Promise.resolve();
  /** Last serialized value per watch — used to dedupe `onChange` samples. */
  private readonly lastValueByWatch = new Map<string, string>();
  private healthProbeHandle: ReturnType<typeof setInterval> | null = null;
  private baselineGlobals: Set<string> | null = null;

  constructor(
    readonly serviceId: string,
    readonly host: string,
    readonly port: number
  ) {}

  async connect(): Promise<void> {
    await this.connectWithRetry();

    await this.request('initialize', {
      clientID: 'dev-pagghiaro',
      adapterID: 'debugpy',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
    });

    // Attach kicks debugpy out of waiting state. We register a no-op catch
    // immediately so the rejection isn't flagged as unhandled while we wait
    // for the `initialized` event, then re-await it after configurationDone.
    const attachPromise = this.request('attach', {
      name: 'dev-pagghiaro',
      __restart: false,
    });
    attachPromise.catch(() => {
      // handled below via `await attachPromise`
    });

    await this.waitForInitializedEvent();
    await this.request('configurationDone', {});
    await attachPromise;

    watchRegistry.setAdapterState(this.serviceId, {
      language: 'python',
      status: 'attached',
      message: null,
    });

    this.syncWatches(watchRegistry.listWatches(this.serviceId));
    this.unsubscribeSession = watchRegistry.subscribeSession(this.serviceId, (state) => {
      this.syncWatches(state.watches);
    });
    this.startHealthProbe();
  }

  /**
   * Periodic `threads` request — cheap, no pause needed, and exercises the
   * full DAP framing path. Three consecutive failures (or any timeout) close
   * the adapter so the UI flips to `error` instead of pretending to be
   * attached to a dead inspector.
   */
  private startHealthProbe(): void {
    if (this.healthProbeHandle) return;
    let consecutiveFailures = 0;
    this.healthProbeHandle = setInterval(() => {
      if (this.closed) return;
      const probe = this.requestWithTimeout('threads', {}, HEALTH_PROBE_TIMEOUT_MS);
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

  private requestWithTimeout(
    command: string,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<Record<string, unknown> | undefined> {
    return Promise.race<Record<string, unknown> | undefined>([
      this.request(command, args),
      new Promise<Record<string, unknown> | undefined>((_, reject) =>
        setTimeout(() => reject(new Error(`${command} probe timed out`)), timeoutMs)
      ),
    ]);
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

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('DAP adapter closed'));
    }
    this.pending.clear();
    this.waitStoppedByThread.clear();
    this.threads.clear();
    this.threadsHydrated = false;

    try {
      this.socket?.destroy();
    } catch {
      // already gone
    }
    this.socket = null;

    watchRegistry.setAdapterState(this.serviceId, {
      status: 'detached',
      message: reason,
    });
  }

  private connectWithRetry(): Promise<void> {
    let allEconnRefused = true;
    const tryOnce = (attempt: number): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const socket = new Socket();
        const cleanup = () => {
          socket.removeAllListeners();
        };
        socket.once('connect', () => {
          cleanup();
          this.socket = socket;
          socket.on('data', (chunk) => this.handleData(chunk));
          socket.on('error', () => this.close('socket errored'));
          socket.on('close', () => this.close('socket closed'));
          resolve();
        });
        socket.once('error', (err) => {
          cleanup();
          socket.destroy();
          reject(err);
        });
        socket.connect(this.port, this.host);
      }).catch((err) => {
        // Track whether every retry hit ECONNREFUSED — that pattern almost
        // always means debugpy never bound the port (typically because the
        // port was stolen between our probe and its `--listen`).
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'ECONNREFUSED') allEconnRefused = false;
        if (attempt + 1 >= CONNECT_RETRY_MAX) {
          if (allEconnRefused) {
            throw new PortInUseError(this.port, this.host);
          }
          throw err;
        }
        return new Promise<void>((resolve) =>
          setTimeout(resolve, CONNECT_RETRY_DELAY_MS)
        ).then(() => tryOnce(attempt + 1));
      });

    return tryOnce(0);
  }

  private waitForInitializedEvent(): Promise<void> {
    if (this.initializedReceived) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waitInitialized = null;
        reject(new Error('Timed out waiting for `initialized` event'));
      }, HANDSHAKE_TIMEOUT_MS);
      this.waitInitialized = () => {
        clearTimeout(timer);
        this.waitInitialized = null;
        resolve();
      };
    });
  }

  private syncWatches(watches: DebugWatch[]): void {
    const current = new Set(this.intervals.keys());
    const next = new Set(watches.map((w) => w.id));

    for (const id of current) {
      if (!next.has(id)) {
        const timer = this.intervals.get(id);
        if (timer) clearInterval(timer);
        this.intervals.delete(id);
        this.inFlight.delete(id);
        this.lastValueByWatch.delete(id);
      }
    }

    for (const watch of watches) {
      if (this.intervals.has(watch.id)) continue;
      const timer = setInterval(() => {
        void this.sampleWatch(watch);
      }, watch.intervalMs);
      this.intervals.set(watch.id, timer);
      void this.sampleWatch(watch);
    }
  }

  private async sampleWatch(watch: DebugWatch): Promise<void> {
    if (this.closed) return;
    if (this.inFlight.has(watch.id)) return;
    this.inFlight.add(watch.id);

    // Serialise the pause/eval/continue cycle: debugpy can only have one
    // paused thread state at a time, and overlapping watches would deadlock.
    this.sampleChain = this.sampleChain.then(async () => {
      if (this.closed) return;
      const t = Date.now();
      try {
        const exprs = watch.condition ? [watch.expr, watch.condition] : [watch.expr];
        const results = await this.evaluateMultipleWithPause(exprs, watch.threadName);
        const value = results[0];

        if (watch.condition) {
          const conditionRepr = results[1];
          if (!isPythonTruthyRepr(conditionRepr)) {
            // Condition not met — drop the sample silently.
            return;
          }
        }

        // True write-time hooks aren't available without injecting a tracer
        // into the target — for `onChange` we emulate by polling and dropping
        // identical consecutive samples. Errors always propagate so the user
        // sees a broken watch immediately.
        if (watch.mode === 'onChange') {
          const previous = this.lastValueByWatch.get(watch.id);
          const stringified = stringifyForCompare(value);
          if (previous !== undefined && previous === stringified) return;
          this.lastValueByWatch.set(watch.id, stringified);
        }
        watchRegistry.pushSample(this.serviceId, watch.id, { t, value });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        watchRegistry.pushSample(this.serviceId, watch.id, { t, error: message });
      } finally {
        this.inFlight.delete(watch.id);
      }
    });
    await this.sampleChain;
  }

  /**
   * debugpy can't evaluate against a running program — `evaluate` without a
   * frameId returns an empty string, and a frameId only exists for paused
   * threads. We therefore pause the main thread, grab its top frame, run the
   * expression, and resume immediately. The pause is sub-frame and rarely
   * perceptible, but it does mean watches cannot fire faster than one round
   * trip and that timing-sensitive Python code may be jittered.
   */
  private async evaluateMultipleWithPause(
    expressions: string[],
    threadName?: string
  ): Promise<unknown[]> {
    const threadId = await this.resolveThreadId(threadName);
    const stoppedPromise = this.waitForStoppedEvent(threadId);
    await this.request('pause', { threadId });
    const stoppedThread = await stoppedPromise;

    try {
      const stackBody = await this.request('stackTrace', {
        threadId: stoppedThread,
        startFrame: 0,
        levels: 1,
      });
      const frames = (stackBody?.['stackFrames'] as Array<{ id: number }> | undefined) ?? [];
      const frameId = frames[0]?.id;
      if (frameId === undefined) {
        throw new Error(`No stack frame available on thread ${stoppedThread}`);
      }

      const results: unknown[] = [];
      for (const expression of expressions) {
        const evalBody = await this.request('evaluate', {
          expression,
          frameId,
          context: 'repl',
        });
        results.push((evalBody?.['result'] as string | undefined) ?? null);
      }
      return results;
    } finally {
      try {
        // Resume only the thread we paused — other threads must remain in
        // whatever state debugpy left them.
        await this.request('continue', { threadId: stoppedThread, singleThread: true });
      } catch {
        // best effort — if continue fails the next pause will likely fail too
      }
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
      const threadId = await this.resolveThreadId();
      const stoppedPromise = this.waitForStoppedEvent(threadId);
      await this.request('pause', { threadId });
      const stoppedThread = await stoppedPromise;
      try {
        const stack = await this.request('stackTrace', { threadId: stoppedThread, startFrame: 0, levels: opts.autoFrameDepth });
        const stackFrames = (stack?.['stackFrames'] as Array<Record<string, unknown>> | undefined) ?? [];
        const excludeRe = opts.excludeFrameRegex ? new RegExp(opts.excludeFrameRegex) : null;
        const frames: DebugScopeSnapshot['frames'] = [];
        const userGlobals: DebugScopeVariable[] = [];

        for (const frame of stackFrames) {
          const source = (frame['source'] as Record<string, unknown> | undefined) ?? {};
          const file = String(source['path'] ?? source['name'] ?? '<anonymous>');
          if (excludeRe && excludeRe.test(file)) continue;
          const line = Number(frame['line'] ?? 0);
          const functionName = String(frame['name'] ?? '<anonymous>');
          const frameId = Number(frame['id']);
          if (!Number.isFinite(frameId)) continue;

          const scopesBody = await this.request('scopes', { frameId });
          const scopes = (scopesBody?.['scopes'] as Array<Record<string, unknown>> | undefined) ?? [];
          const locals: DebugScopeVariable[] = [];
          const closures: DebugScopeVariable[] = [];

          for (const scope of scopes) {
            const scopeName = String(scope['name'] ?? '');
            const ref = Number(scope['variablesReference'] ?? 0);
            if (!Number.isFinite(ref) || ref <= 0) continue;
            if (scopeName === 'Globals') {
              if (opts.includeUserGlobals) {
                const vars = await this.request('variables', { variablesReference: ref });
                for (const v of (vars?.['variables'] as Array<Record<string, unknown>> | undefined) ?? []) {
                  const name = String(v['name'] ?? '');
                  if (!name) continue;
                  if (this.baselineGlobals && this.baselineGlobals.has(name)) continue;
                  userGlobals.push(toDapScopeVariable(v));
                }
              }
              continue;
            }
            const isLocal = /local/i.test(scopeName);
            if (!isLocal && !opts.includeClosures) continue;
            const vars = await this.request('variables', { variablesReference: ref });
            for (const v of (vars?.['variables'] as Array<Record<string, unknown>> | undefined) ?? []) {
              if (isLocal) locals.push(toDapScopeVariable(v));
              else closures.push(toDapScopeVariable(v));
            }
          }

          frames.push({ file, line, function: functionName, locals, closures });
        }

        return { t, frames, userGlobals };
      } finally {
        try { await this.request('continue', { threadId: stoppedThread, singleThread: true }); } catch { /* ignore */ }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { t, frames: [], userGlobals: [], error: message };
    }
  }

  private async hydrateThreads(): Promise<void> {
    const body = await this.request('threads', {});
    const reported = (body?.['threads'] as Array<{ id: number; name: string }> | undefined) ?? [];
    this.threads.clear();
    for (const thread of reported) {
      this.threads.set(thread.id, { name: thread.name, nameLower: thread.name.toLowerCase() });
    }
    this.threadsHydrated = true;
  }

  /**
   * Resolve a thread id from an optional user-supplied name. The match is
   * case-insensitive against either the full name or a substring; if no name
   * is given we prefer the canonical Python `MainThread`. We refresh the
   * cache and retry once if the name isn't currently known — useful when the
   * user added a watch before the target thread spawned.
   */
  private async resolveThreadId(threadName?: string): Promise<number> {
    if (!this.threadsHydrated) {
      await this.hydrateThreads();
    }

    const lookup = (): number | null => {
      if (!threadName) {
        for (const [id, thread] of this.threads) {
          if (/main/i.test(thread.name)) return id;
        }
        const first = this.threads.keys().next();
        return first.done ? null : first.value;
      }
      const needle = threadName.toLowerCase();
      for (const [id, thread] of this.threads) {
        if (thread.nameLower === needle || thread.nameLower.includes(needle)) {
          return id;
        }
      }
      return null;
    };

    let id = lookup();
    if (id === null) {
      // Cache miss — refresh in case the thread spawned since last hydrate.
      await this.hydrateThreads();
      id = lookup();
    }
    if (id === null) {
      throw new Error(
        threadName
          ? `Thread "${threadName}" not found (known: ${[...this.threads.values()].map((t) => t.name).join(', ') || 'none'})`
          : 'No threads reported by debugpy'
      );
    }
    return id;
  }

  private waitForStoppedEvent(threadId: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waitStoppedByThread.delete(threadId);
        reject(new Error(`Timed out waiting for \`stopped\` event on thread ${threadId}`));
      }, EVAL_TIMEOUT_MS);
      this.waitStoppedByThread.set(threadId, (id: number) => {
        clearTimeout(timer);
        this.waitStoppedByThread.delete(threadId);
        resolve(id);
      });
    });
  }

  private request(command: string, args: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    if (!this.socket || this.closed) {
      return Promise.reject(new Error('DAP adapter not connected'));
    }
    const seq = this.nextSeq++;
    const payload = {
      seq,
      type: 'request',
      command,
      arguments: args,
    };
    const json = JSON.stringify(payload);
    const frame = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`DAP ${command} timed out`));
      }, command === 'evaluate' ? EVAL_TIMEOUT_MS : HANDSHAKE_TIMEOUT_MS);
      this.pending.set(seq, { resolve, reject, timer });
      try {
        this.socket!.write(frame);
      } catch (err) {
        this.pending.delete(seq);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headerText = this.buffer.subarray(0, headerEnd).toString('utf8');
      const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        // Malformed frame — drop everything up to the separator and try again.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const bodyLength = Number(lengthMatch[1]);
      const totalLength = headerEnd + 4 + bodyLength;
      if (this.buffer.length < totalLength) return;

      const body = this.buffer.subarray(headerEnd + 4, totalLength).toString('utf8');
      this.buffer = this.buffer.subarray(totalLength);

      this.dispatchMessage(body);
    }
  }

  private dispatchMessage(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;

    const message = parsed as {
      type?: string;
      request_seq?: number;
      success?: boolean;
      command?: string;
      message?: string;
      body?: Record<string, unknown>;
      event?: string;
    };

    if (message.type === 'response' && typeof message.request_seq === 'number') {
      const pending = this.pending.get(message.request_seq);
      if (!pending) return;
      this.pending.delete(message.request_seq);
      clearTimeout(pending.timer);
      if (message.success) {
        pending.resolve(message.body);
      } else {
        pending.reject(new Error(message.message ?? `${message.command} failed`));
      }
      return;
    }

    if (message.type === 'event' && message.event === 'initialized') {
      this.initializedReceived = true;
      this.waitInitialized?.();
      return;
    }

    if (message.type === 'event' && message.event === 'stopped') {
      const stoppedBody = (message.body ?? {}) as { threadId?: number; allThreadsStopped?: boolean };
      const reportedId = stoppedBody.threadId;
      if (typeof reportedId === 'number') {
        const callback = this.waitStoppedByThread.get(reportedId);
        if (callback) {
          callback(reportedId);
          return;
        }
        // Some debugpy paths emit allThreadsStopped without naming the thread
        // we're waiting on — fall through to fire any single waiter.
      }
      if (this.waitStoppedByThread.size === 1) {
        const [[onlyId, callback]] = this.waitStoppedByThread.entries();
        callback(reportedId ?? onlyId);
      }
      return;
    }

    if (message.type === 'event' && message.event === 'thread') {
      const threadBody = (message.body ?? {}) as {
        reason?: string;
        threadId?: number;
        threadName?: string;
      };
      if (typeof threadBody.threadId === 'number') {
        if (threadBody.reason === 'exited') {
          this.threads.delete(threadBody.threadId);
        } else if (threadBody.threadName) {
          this.threads.set(threadBody.threadId, {
            name: threadBody.threadName,
            nameLower: threadBody.threadName.toLowerCase(),
          });
        } else {
          // Name not provided — schedule a re-hydrate without blocking.
          void this.hydrateThreads().catch(() => {
            // best-effort
          });
        }
      }
      return;
    }

    // Other events (output, terminated, etc.) are ignored in MVP.
  }
}

function toDapScopeVariable(v: Record<string, unknown>): DebugScopeVariable {
  const value = String(v['value'] ?? '');
  const typeRaw = String(v['type'] ?? '').toLowerCase();
  const type: DebugScopeVariable['type'] =
    typeRaw === 'str' || typeRaw === 'string' ? 'string'
      : typeRaw === 'int' || typeRaw === 'float' || typeRaw === 'number' ? 'number'
        : typeRaw === 'bool' || typeRaw === 'boolean' ? 'boolean'
          : typeRaw === 'none' || typeRaw === 'null' ? 'null'
            : typeRaw.includes('list') || typeRaw.includes('tuple') || typeRaw.includes('array') ? 'array'
              : typeRaw.includes('function') ? 'function'
                : typeRaw ? 'object' : 'unknown';
  return {
    name: String(v['name'] ?? 'unknown'),
    value,
    type,
  };
}

/**
 * debugpy returns each `evaluate` result as a Python `repr()` string. To
 * decide whether a condition is met we test the canonical falsy reprs and
 * treat anything else as truthy. Errors caught upstream show as such.
 */
function isPythonTruthyRepr(repr: unknown): boolean {
  if (repr === null || repr === undefined) return false;
  const s = String(repr).trim();
  if (s === '' || s === 'False' || s === 'None' || s === '0' || s === '0.0') return false;
  if (s === '""' || s === "''" || s === '[]' || s === '{}' || s === '()' || s === 'set()') return false;
  return true;
}

function stringifyForCompare(value: unknown): string {
  if (typeof value === 'string') return `s:${value}`;
  try {
    return `j:${JSON.stringify(value ?? null)}`;
  } catch {
    return `o:${String(value)}`;
  }
}

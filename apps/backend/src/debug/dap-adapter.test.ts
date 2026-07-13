import { describe, expect, it } from 'bun:test';
import {
  DapAdapter,
  PortInUseError,
  isPythonTruthyRepr,
  stringifyForCompare,
  toDapScopeVariable,
} from './dap-adapter';

let counter = 0;
/** Fresh, never-touched serviceId per test — avoids cross-test bleed. */
function sid(): string {
  return `svc-dap-${counter++}`;
}

function makeAdapter(): DapAdapter {
  return new DapAdapter(sid(), '127.0.0.1', 5678);
}

function fakeTimer(): ReturnType<typeof setTimeout> {
  const t = setTimeout(() => {}, 10_000);
  (t as unknown as { unref?: () => void }).unref?.();
  return t;
}

describe('PortInUseError', () => {
  it('includes host and port in the message', () => {
    const err = new PortInUseError(5678, '127.0.0.1');
    expect(err.message).toContain('127.0.0.1:5678');
    expect(err.name).toBe('PortInUseError');
    expect(err.port).toBe(5678);
    expect(err.host).toBe('127.0.0.1');
  });
});

describe('toDapScopeVariable', () => {
  it.each([
    ['str', 'string'],
    ['string', 'string'],
    ['int', 'number'],
    ['float', 'number'],
    ['number', 'number'],
    ['bool', 'boolean'],
    ['boolean', 'boolean'],
    ['none', 'null'],
    ['null', 'null'],
    ['list', 'array'],
    ['tuple', 'array'],
    ['array', 'array'],
    ['ndarray', 'array'], // contains "array"
    ['function', 'function'],
    ['builtin_function_or_method', 'function'], // contains "function"
    ['dict', 'object'],
    ['MyClass', 'object'],
  ])('maps DAP type %s to %s', (typeRaw, expected) => {
    const v = toDapScopeVariable({ name: 'x', value: '1', type: typeRaw });
    expect(v.type).toBe(expected);
  });

  it('maps a missing/empty type to unknown', () => {
    const v = toDapScopeVariable({ name: 'x', value: '1' });
    expect(v.type).toBe('unknown');
  });

  it('is case-insensitive on the type string', () => {
    expect(toDapScopeVariable({ type: 'STR' }).type).toBe('string');
    expect(toDapScopeVariable({ type: 'Dict' }).type).toBe('object');
  });

  it('defaults name to "unknown" and value to "" when absent', () => {
    const v = toDapScopeVariable({});
    expect(v.name).toBe('unknown');
    expect(v.value).toBe('');
    expect(v.type).toBe('unknown');
  });

  it('stringifies a non-string value via String()', () => {
    const v = toDapScopeVariable({ name: 'n', value: 42, type: 'int' });
    expect(v.value).toBe('42');
  });
});

describe('isPythonTruthyRepr', () => {
  it.each([
    [null],
    [undefined],
    ['None'],
    ['False'],
    ['0'],
    ['0.0'],
    [''],
    ['""'],
    ["''"],
    ['[]'],
    ['{}'],
    ['()'],
    ['set()'],
    ['  None  '], // outer whitespace trimmed before comparison
  ])('treats %p as falsy', (repr) => {
    expect(isPythonTruthyRepr(repr)).toBe(false);
  });

  it.each([
    ['True'],
    ['1'],
    ['0.1'],
    ["'a'"],
    ['[1]'],
    ['{1: 2}'],
    ['(1,)'],
    ["{'a'}"],
    ['None ish'], // not an exact falsy literal
  ])('treats %p as truthy', (repr) => {
    expect(isPythonTruthyRepr(repr)).toBe(true);
  });
});

describe('stringifyForCompare', () => {
  it('prefixes plain strings with s:', () => {
    expect(stringifyForCompare('hi')).toBe('s:hi');
  });

  it('prefixes JSON-serializable values with j:', () => {
    expect(stringifyForCompare({ a: 1 })).toBe('j:{"a":1}');
    expect(stringifyForCompare(42)).toBe('j:42');
    expect(stringifyForCompare(null)).toBe('j:null');
    expect(stringifyForCompare(undefined)).toBe('j:null'); // value ?? null
  });

  it('falls back to o:String(value) when JSON.stringify throws (circular ref)', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(stringifyForCompare(circular)).toBe(`o:${String(circular)}`);
  });
});

describe('DapAdapter construction', () => {
  it('does not open a socket or perform any IO in the constructor', () => {
    const adapter = new DapAdapter('svc', '127.0.0.1', 5678);
    const internal = adapter as unknown as {
      socket: unknown;
      closed: boolean;
      buffer: Buffer;
      pending: Map<unknown, unknown>;
      nextSeq: number;
      threadsHydrated: boolean;
    };
    expect(internal.socket).toBeNull();
    expect(internal.closed).toBe(false);
    expect(internal.buffer.length).toBe(0);
    expect(internal.pending.size).toBe(0);
    expect(internal.nextSeq).toBe(1);
    expect(internal.threadsHydrated).toBe(false);
  });
});

function frame(body: Record<string, unknown>): Buffer {
  const json = JSON.stringify(body);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, 'utf8'), Buffer.from(json, 'utf8')]);
}

describe('DapAdapter.handleData — DAP frame parsing', () => {
  it('dispatches a single complete frame in one chunk', () => {
    const adapter = makeAdapter();
    const calls: string[] = [];
    (adapter as any).dispatchMessage = (text: string) => calls.push(text);

    const body = { seq: 1, type: 'response', request_seq: 1, success: true, command: 'initialize' };
    (adapter as any).handleData(frame(body));

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0])).toEqual(body);
  });

  it('buffers a frame split across two chunks until Content-Length is satisfied', () => {
    const adapter = makeAdapter();
    const calls: string[] = [];
    (adapter as any).dispatchMessage = (text: string) => calls.push(text);

    const body = { seq: 2, type: 'event', event: 'initialized' };
    const full = frame(body);
    const splitAt = Math.floor(full.length / 2);
    const part1 = full.subarray(0, splitAt);
    const part2 = full.subarray(splitAt);

    (adapter as any).handleData(part1);
    expect(calls).toHaveLength(0); // not enough bytes yet

    (adapter as any).handleData(part2);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0])).toEqual(body);
  });

  it('dispatches two frames delivered in a single chunk, in order', () => {
    const adapter = makeAdapter();
    const calls: string[] = [];
    (adapter as any).dispatchMessage = (text: string) => calls.push(text);

    const bodyA = { seq: 3, type: 'event', event: 'thread' };
    const bodyB = { seq: 4, type: 'event', event: 'output' };
    const combined = Buffer.concat([frame(bodyA), frame(bodyB)]);

    (adapter as any).handleData(combined);

    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0])).toEqual(bodyA);
    expect(JSON.parse(calls[1])).toEqual(bodyB);
  });

  it('drops a header with no Content-Length past the terminator and keeps parsing', () => {
    const adapter = makeAdapter();
    const calls: string[] = [];
    (adapter as any).dispatchMessage = (text: string) => calls.push(text);

    const goodBody = { seq: 5, type: 'event', event: 'stopped' };
    const malformedHeader = Buffer.from('X-Nonsense: yes\r\n\r\n', 'utf8');
    const combined = Buffer.concat([malformedHeader, frame(goodBody)]);

    (adapter as any).handleData(combined);

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0])).toEqual(goodBody);
  });

  it('waits for more data when only the header (no body bytes) has arrived', () => {
    const adapter = makeAdapter();
    const calls: string[] = [];
    (adapter as any).dispatchMessage = (text: string) => calls.push(text);

    const body = { seq: 6, type: 'response', request_seq: 6, success: true };
    const json = JSON.stringify(body);
    const header = Buffer.from(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`, 'utf8');

    (adapter as any).handleData(header);
    expect(calls).toHaveLength(0);

    (adapter as any).handleData(Buffer.from(json, 'utf8'));
    expect(calls).toHaveLength(1);
  });
});

describe('DapAdapter.dispatchMessage — response routing', () => {
  it('resolves a pending request by request_seq on success', () => {
    const adapter = makeAdapter();
    const pending = (adapter as any).pending as Map<
      number,
      { resolve: (b: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
    >;
    const resolved: unknown[] = [];
    pending.set(1, { resolve: (b) => resolved.push(b), reject: () => {}, timer: fakeTimer() });

    (adapter as any).dispatchMessage(
      JSON.stringify({ type: 'response', request_seq: 1, success: true, command: 'threads', body: { threads: [] } })
    );

    expect(resolved).toEqual([{ threads: [] }]);
    expect(pending.has(1)).toBe(false);
  });

  it('rejects a pending request by request_seq on failure, using the message field', () => {
    const adapter = makeAdapter();
    const pending = (adapter as any).pending as Map<
      number,
      { resolve: (b: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
    >;
    const rejected: Error[] = [];
    pending.set(2, { resolve: () => {}, reject: (e) => rejected.push(e), timer: fakeTimer() });

    (adapter as any).dispatchMessage(
      JSON.stringify({ type: 'response', request_seq: 2, success: false, command: 'pause', message: 'boom' })
    );

    expect(rejected).toHaveLength(1);
    expect(rejected[0].message).toBe('boom');
  });

  it('rejects with "<command> failed" when the failure response omits a message', () => {
    const adapter = makeAdapter();
    const pending = (adapter as any).pending as Map<
      number,
      { resolve: (b: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
    >;
    const rejected: Error[] = [];
    pending.set(3, { resolve: () => {}, reject: (e) => rejected.push(e), timer: fakeTimer() });

    (adapter as any).dispatchMessage(
      JSON.stringify({ type: 'response', request_seq: 3, success: false, command: 'pause' })
    );

    expect(rejected[0].message).toBe('pause failed');
  });

  it('ignores a response for an unknown request_seq', () => {
    const adapter = makeAdapter();
    expect(() =>
      (adapter as any).dispatchMessage(
        JSON.stringify({ type: 'response', request_seq: 999, success: true })
      )
    ).not.toThrow();
  });

  it('silently ignores non-JSON and non-object payloads', () => {
    const adapter = makeAdapter();
    expect(() => (adapter as any).dispatchMessage('not-json{')).not.toThrow();
    expect(() => (adapter as any).dispatchMessage('42')).not.toThrow();
    expect(() => (adapter as any).dispatchMessage('null')).not.toThrow();
  });
});

describe('DapAdapter.dispatchMessage — initialized event', () => {
  it('flips initializedReceived and fires the waiter', () => {
    const adapter = makeAdapter();
    (adapter as any).initializedReceived = false;
    let fired = false;
    (adapter as any).waitInitialized = () => {
      fired = true;
    };

    (adapter as any).dispatchMessage(JSON.stringify({ type: 'event', event: 'initialized' }));

    expect((adapter as any).initializedReceived).toBe(true);
    expect(fired).toBe(true);
  });

  it('does not throw when no waiter is registered', () => {
    const adapter = makeAdapter();
    expect(() =>
      (adapter as any).dispatchMessage(JSON.stringify({ type: 'event', event: 'initialized' }))
    ).not.toThrow();
    expect((adapter as any).initializedReceived).toBe(true);
  });
});

describe('DapAdapter.dispatchMessage — stopped event', () => {
  it('invokes the exact-match waiter for the reported threadId', () => {
    const adapter = makeAdapter();
    const waitStoppedByThread = (adapter as any).waitStoppedByThread as Map<number, (id: number) => void>;
    const calls: number[] = [];
    waitStoppedByThread.set(5, (id) => calls.push(id));

    (adapter as any).dispatchMessage(
      JSON.stringify({ type: 'event', event: 'stopped', body: { threadId: 5 } })
    );

    expect(calls).toEqual([5]);
  });

  it('falls back to the sole waiter when threadId is unnamed and exactly one waiter is registered, ' +
    'passing the reported id (not the waiter key) when a numeric threadId is present', () => {
    const adapter = makeAdapter();
    const waitStoppedByThread = (adapter as any).waitStoppedByThread as Map<number, (id: number) => void>;
    const calls: number[] = [];
    // Waiter is registered under key 5, but the event reports threadId 7 —
    // real behavior: the single-waiter fallback fires with the *reported* id.
    waitStoppedByThread.set(5, (id) => calls.push(id));

    (adapter as any).dispatchMessage(
      JSON.stringify({ type: 'event', event: 'stopped', body: { threadId: 7 } })
    );

    expect(calls).toEqual([7]);
  });

  it('falls back to the sole waiter using its own key when no threadId is reported at all', () => {
    const adapter = makeAdapter();
    const waitStoppedByThread = (adapter as any).waitStoppedByThread as Map<number, (id: number) => void>;
    const calls: number[] = [];
    waitStoppedByThread.set(9, (id) => calls.push(id));

    (adapter as any).dispatchMessage(
      JSON.stringify({ type: 'event', event: 'stopped', body: { allThreadsStopped: true } })
    );

    expect(calls).toEqual([9]);
  });

  it('does nothing when the threadId is unknown and there is not exactly one waiter', () => {
    const adapter = makeAdapter();
    const waitStoppedByThread = (adapter as any).waitStoppedByThread as Map<number, (id: number) => void>;
    // Zero waiters.
    expect(() =>
      (adapter as any).dispatchMessage(
        JSON.stringify({ type: 'event', event: 'stopped', body: { threadId: 1 } })
      )
    ).not.toThrow();

    // Two waiters, unmatched threadId — neither should fire.
    const calls: number[] = [];
    waitStoppedByThread.set(1, (id) => calls.push(id));
    waitStoppedByThread.set(2, (id) => calls.push(id));
    (adapter as any).dispatchMessage(
      JSON.stringify({ type: 'event', event: 'stopped', body: { threadId: 99 } })
    );
    expect(calls).toHaveLength(0);
  });
});

describe('DapAdapter.dispatchMessage — thread event', () => {
  it('deletes the thread cache entry when reason is "exited"', () => {
    const adapter = makeAdapter();
    const threads = (adapter as any).threads as Map<number, { name: string; nameLower: string }>;
    threads.set(3, { name: 'Worker-1', nameLower: 'worker-1' });

    (adapter as any).dispatchMessage(
      JSON.stringify({ type: 'event', event: 'thread', body: { reason: 'exited', threadId: 3 } })
    );

    expect(threads.has(3)).toBe(false);
  });

  it('adds/updates the cache entry when a threadName is provided', () => {
    const adapter = makeAdapter();
    const threads = (adapter as any).threads as Map<number, { name: string; nameLower: string }>;

    (adapter as any).dispatchMessage(
      JSON.stringify({ type: 'event', event: 'thread', body: { threadId: 4, threadName: 'MainThread' } })
    );

    expect(threads.get(4)).toEqual({ name: 'MainThread', nameLower: 'mainthread' });
  });

  it('schedules a best-effort rehydrate (does not throw) when neither exited nor a name is given', async () => {
    const adapter = makeAdapter();
    expect(() =>
      (adapter as any).dispatchMessage(JSON.stringify({ type: 'event', event: 'thread', body: { threadId: 4 } }))
    ).not.toThrow();
    // The triggered hydrateThreads() call rejects (no socket) and is swallowed
    // internally — let the microtask queue drain so we know it didn't produce
    // an unhandled rejection.
    await new Promise((r) => setTimeout(r, 0));
  });

  it('ignores a thread event with no threadId', () => {
    const adapter = makeAdapter();
    expect(() =>
      (adapter as any).dispatchMessage(JSON.stringify({ type: 'event', event: 'thread', body: {} }))
    ).not.toThrow();
  });
});

describe('DapAdapter.dispatchMessage — other events', () => {
  it('ignores unrecognized event names (e.g. output/terminated)', () => {
    const adapter = makeAdapter();
    expect(() =>
      (adapter as any).dispatchMessage(JSON.stringify({ type: 'event', event: 'output', body: { output: 'hi' } }))
    ).not.toThrow();
  });
});

describe('DapAdapter.resolveThreadId', () => {
  it('prefers the thread named /main/i when no threadName filter is given', async () => {
    const adapter = makeAdapter();
    (adapter as any).threadsHydrated = true;
    const threads = (adapter as any).threads as Map<number, { name: string; nameLower: string }>;
    threads.set(1, { name: 'Worker-1', nameLower: 'worker-1' });
    threads.set(2, { name: 'MainThread', nameLower: 'mainthread' });
    threads.set(3, { name: 'Worker-2', nameLower: 'worker-2' });

    const id = await (adapter as any).resolveThreadId();
    expect(id).toBe(2);
  });

  it('matches by case-insensitive substring when a threadName filter is given', async () => {
    const adapter = makeAdapter();
    (adapter as any).threadsHydrated = true;
    const threads = (adapter as any).threads as Map<number, { name: string; nameLower: string }>;
    threads.set(1, { name: 'Worker-1', nameLower: 'worker-1' });

    const id = await (adapter as any).resolveThreadId('ORKER');
    expect(id).toBe(1);
  });

  it('re-hydrates once and retries when the name is not found on the first lookup', async () => {
    const adapter = makeAdapter();
    (adapter as any).threadsHydrated = true;
    const threads = (adapter as any).threads as Map<number, { name: string; nameLower: string }>;
    threads.set(1, { name: 'Worker-1', nameLower: 'worker-1' });

    let requestCalls = 0;
    (adapter as any).request = async (command: string) => {
      requestCalls += 1;
      if (command === 'threads') {
        // Simulate the target thread spawning between the first miss and the retry.
        return { threads: [{ id: 1, name: 'Worker-1' }, { id: 2, name: 'LateThread' }] };
      }
      return undefined;
    };

    const id = await (adapter as any).resolveThreadId('late');
    expect(id).toBe(2);
    expect(requestCalls).toBe(1); // only the retry hydrate hits the wire; first lookup used the seeded cache
  });

  it('throws a descriptive error when the name is still not found after rehydrating', async () => {
    const adapter = makeAdapter();
    (adapter as any).threadsHydrated = true;
    const threads = (adapter as any).threads as Map<number, { name: string; nameLower: string }>;
    threads.set(1, { name: 'Worker-1', nameLower: 'worker-1' });
    (adapter as any).request = async () => ({ threads: [{ id: 1, name: 'Worker-1' }] });

    await expect((adapter as any).resolveThreadId('ghost')).rejects.toThrow(
      'Thread "ghost" not found (known: Worker-1)'
    );
  });

  it('throws "No threads reported by debugpy" when no name is given and no threads exist', async () => {
    const adapter = makeAdapter();
    (adapter as any).threadsHydrated = true;
    (adapter as any).request = async () => ({ threads: [] });

    await expect((adapter as any).resolveThreadId()).rejects.toThrow('No threads reported by debugpy');
  });
});

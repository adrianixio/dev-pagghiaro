import { describe, expect, it } from 'bun:test';
import {
  CdpAdapter,
  isSimpleIdentifierPath,
  normalizeType,
  stringifyRuntime,
  toScopeVariable,
} from './cdp-adapter';
import { watchRegistry } from './watch-registry';

let counter = 0;
/** Fresh, never-touched serviceId per test — avoids cross-test bleed. */
function sid(): string {
  return `svc-cdp-${counter++}`;
}

describe('normalizeType', () => {
  it('passes through the four literal CDP types verbatim, ignoring value', () => {
    expect(normalizeType('string', 123)).toBe('string');
    expect(normalizeType('number', 'nope')).toBe('number');
    expect(normalizeType('boolean', null)).toBe('boolean');
    expect(normalizeType('function', undefined)).toBe('function');
  });

  it('falls back to null when value is null and type is not a literal match', () => {
    expect(normalizeType('object', null)).toBe('null');
    expect(normalizeType(undefined, null)).toBe('null');
  });

  it('falls back to array when value is an array', () => {
    expect(normalizeType('object', [1, 2, 3])).toBe('array');
    expect(normalizeType(undefined, [])).toBe('array');
  });

  it('falls back to object when value is a non-null, non-array object', () => {
    expect(normalizeType('object', { a: 1 })).toBe('object');
    expect(normalizeType(undefined, {})).toBe('object');
  });

  it('falls back to unknown for anything else (e.g. undefined value)', () => {
    expect(normalizeType('undefined', undefined)).toBe('unknown');
    expect(normalizeType(undefined, undefined)).toBe('unknown');
    expect(normalizeType('symbol', Symbol('x'))).toBe('unknown');
  });
});

describe('toScopeVariable', () => {
  it('uses value.value when present', () => {
    const v = toScopeVariable({ name: 'x', value: { value: 42, type: 'number' } });
    expect(v).toEqual({ name: 'x', value: '42', type: 'number' });
  });

  it('falls back to value.description when value.value is absent', () => {
    const v = toScopeVariable({ name: 'obj', value: { description: 'Object', type: 'object' } });
    expect(v.value).toBe('Object');
  });

  it('falls back to null when both value.value and value.description are absent', () => {
    const v = toScopeVariable({ name: 'x', value: { type: 'undefined' } });
    expect(v.value).toBe('null');
  });

  it('defaults name to "unknown" when prop.name is missing', () => {
    const v = toScopeVariable({ value: { value: 1, type: 'number' } });
    expect(v.name).toBe('unknown');
  });

  it('defaults to an empty value object when prop.value is missing entirely', () => {
    const v = toScopeVariable({ name: 'z' });
    expect(v).toEqual({ name: 'z', value: 'null', type: 'unknown' });
  });

  it('computes type from value.value, not from the resolved display value — ' +
    'a description-only prop with no value.value types as unknown, not object', () => {
    // Real behavior surprise: normalizeType's second argument is value.value,
    // never the `raw` fallback used for display. So a prop that only carries
    // a `description` (no `value.value`) types as "unknown" even though its
    // displayed value looks like an object description.
    const v = toScopeVariable({ name: 'obj', value: { description: '{foo: 1}', type: 'object' } });
    expect(v.value).toBe('{foo: 1}');
    expect(v.type).toBe('unknown');
  });
});

describe('isSimpleIdentifierPath', () => {
  it.each([
    ['globalThis.counter'],
    ['obj.prop.deep'],
    ['_$x'],
    ['a'],
    ['  obj.prop  '], // outer whitespace is trimmed before testing
  ])('accepts %s', (expr) => {
    expect(isSimpleIdentifierPath(expr)).toBe(true);
  });

  it.each([
    ['a()'],
    ['a[0]'],
    ['a.b.'],
    ['1abc'],
    ['a b'],
    ['obj..prop'],
    [''],
  ])('rejects %s', (expr) => {
    expect(isSimpleIdentifierPath(expr)).toBe(false);
  });
});

describe('stringifyRuntime', () => {
  it('returns strings verbatim', () => {
    expect(stringifyRuntime('hello')).toBe('hello');
  });

  it('JSON-stringifies plain objects/arrays/numbers/booleans', () => {
    expect(stringifyRuntime({ a: 1 })).toBe('{"a":1}');
    expect(stringifyRuntime([1, 2])).toBe('[1,2]');
    expect(stringifyRuntime(42)).toBe('42');
    expect(stringifyRuntime(true)).toBe('true');
    expect(stringifyRuntime(null)).toBe('null');
  });

  it('falls back to String(value) when JSON.stringify throws (circular ref)', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(stringifyRuntime(circular)).toBe(String(circular));
    expect(stringifyRuntime(circular)).toBe('[object Object]');
  });
});

describe('CdpAdapter construction', () => {
  it('does not open a socket or perform any IO in the constructor', () => {
    const adapter = new CdpAdapter('svc', 'node', 'ws://127.0.0.1:9229/x');
    const internal = adapter as unknown as {
      ws: unknown;
      closed: boolean;
      pending: Map<unknown, unknown>;
      onChangeWatches: Set<unknown>;
      nextId: number;
    };
    expect(internal.ws).toBeNull();
    expect(internal.closed).toBe(false);
    expect(internal.pending.size).toBe(0);
    expect(internal.onChangeWatches.size).toBe(0);
    expect(internal.nextId).toBe(1);
  });
});

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function makeAdapter(): CdpAdapter {
  return new CdpAdapter(sid(), 'node', 'ws://127.0.0.1:9229/x');
}

function fakeTimer(): ReturnType<typeof setTimeout> {
  const t = setTimeout(() => {}, 10_000);
  (t as unknown as { unref?: () => void }).unref?.();
  return t;
}

describe('CdpAdapter.handleMessage — routing', () => {
  it('routes a message with a string `method` to handleEvent, ignoring `id`', () => {
    const adapter = makeAdapter();
    const calls: Array<[string, Record<string, unknown>]> = [];
    (adapter as any).handleEvent = (method: string, params: Record<string, unknown>) => {
      calls.push([method, params]);
    };
    (adapter as any).handleMessage({ data: JSON.stringify({ method: 'Foo.bar', params: { a: 1 } }) });
    expect(calls).toEqual([['Foo.bar', { a: 1 }]]);
  });

  it('defaults params to {} when the event message omits them', () => {
    const adapter = makeAdapter();
    const calls: Array<[string, Record<string, unknown>]> = [];
    (adapter as any).handleEvent = (method: string, params: Record<string, unknown>) => {
      calls.push([method, params]);
    };
    (adapter as any).handleMessage({ data: JSON.stringify({ method: 'Foo.bar' }) });
    expect(calls).toEqual([['Foo.bar', {}]]);
  });

  it('resolves the pending request on a numeric-id result message', () => {
    const adapter = makeAdapter();
    const pending = (adapter as any).pending as Map<number, Pending>;
    const resolved: unknown[] = [];
    pending.set(7, { resolve: (v) => resolved.push(v), reject: () => {}, timer: fakeTimer() });
    (adapter as any).handleMessage({ data: JSON.stringify({ id: 7, result: { ok: true } }) });
    expect(resolved).toEqual([{ ok: true }]);
    expect(pending.has(7)).toBe(false);
  });

  it('rejects the pending request on an error message', () => {
    const adapter = makeAdapter();
    const pending = (adapter as any).pending as Map<number, Pending>;
    const rejected: Error[] = [];
    pending.set(8, { resolve: () => {}, reject: (e) => rejected.push(e), timer: fakeTimer() });
    (adapter as any).handleMessage({ data: JSON.stringify({ id: 8, error: { message: 'boom' } }) });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].message).toBe('boom');
    expect(pending.has(8)).toBe(false);
  });

  it('rejects with "Malformed CDP response" when neither result nor error is present', () => {
    const adapter = makeAdapter();
    const pending = (adapter as any).pending as Map<number, Pending>;
    const rejected: Error[] = [];
    pending.set(9, { resolve: () => {}, reject: (e) => rejected.push(e), timer: fakeTimer() });
    (adapter as any).handleMessage({ data: JSON.stringify({ id: 9 }) });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].message).toBe('Malformed CDP response');
  });

  it('resolves with undefined when `result` key is present but its value is undefined', () => {
    // 'result' in message is true even though JSON can't actually encode an
    // `undefined` value — this path fires when the key exists with any value,
    // e.g. `{"id":10,"result":null}` resolves(null), not the malformed branch.
    const adapter = makeAdapter();
    const pending = (adapter as any).pending as Map<number, Pending>;
    const resolved: unknown[] = [];
    pending.set(10, { resolve: (v) => resolved.push(v), reject: () => {}, timer: fakeTimer() });
    (adapter as any).handleMessage({ data: JSON.stringify({ id: 10, result: null }) });
    expect(resolved).toEqual([null]);
  });

  it('silently ignores unknown ids', () => {
    const adapter = makeAdapter();
    expect(() =>
      (adapter as any).handleMessage({ data: JSON.stringify({ id: 999, result: {} }) })
    ).not.toThrow();
  });

  it('silently ignores non-JSON payloads', () => {
    const adapter = makeAdapter();
    expect(() => (adapter as any).handleMessage({ data: 'not-json{' })).not.toThrow();
  });

  it('silently ignores messages whose data is not a string', () => {
    const adapter = makeAdapter();
    const calls: unknown[] = [];
    (adapter as any).handleEvent = (...args: unknown[]) => calls.push(args);
    (adapter as any).handleMessage({ data: new ArrayBuffer(4) });
    expect(calls).toHaveLength(0);
  });

  it('silently ignores non-object JSON (e.g. a bare number or array)', () => {
    const adapter = makeAdapter();
    expect(() => (adapter as any).handleMessage({ data: '42' })).not.toThrow();
    expect(() => (adapter as any).handleMessage({ data: '[1,2,3]' })).not.toThrow();
    expect(() => (adapter as any).handleMessage({ data: 'null' })).not.toThrow();
  });
});

describe('CdpAdapter.handleEvent — Runtime.bindingCalled gating', () => {
  it('pushes a value sample when the binding name and watchId both match', () => {
    const serviceId = sid();
    const watch = watchRegistry.addWatch(serviceId, { expr: 'x', mode: 'onChange' });
    const adapter = new CdpAdapter(serviceId, 'node', 'ws://127.0.0.1:9229/x');
    (adapter as any).bindingName = '__pagghiaroOnChange_svc';
    (adapter as any).onChangeWatches = new Set([watch.id]);

    (adapter as any).handleEvent('Runtime.bindingCalled', {
      name: '__pagghiaroOnChange_svc',
      payload: JSON.stringify({ watchId: watch.id, t: 123, v: 42 }),
    });

    const history = watchRegistry.getHistory(serviceId, watch.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ t: 123, value: 42 });
  });

  it('pushes an error sample when the payload carries an `error` field', () => {
    const serviceId = sid();
    const watch = watchRegistry.addWatch(serviceId, { expr: 'x', mode: 'onChange' });
    const adapter = new CdpAdapter(serviceId, 'node', 'ws://127.0.0.1:9229/x');
    (adapter as any).bindingName = '__pagghiaroOnChange_svc';
    (adapter as any).onChangeWatches = new Set([watch.id]);

    (adapter as any).handleEvent('Runtime.bindingCalled', {
      name: '__pagghiaroOnChange_svc',
      payload: JSON.stringify({ watchId: watch.id, error: 'boom' }),
    });

    const history = watchRegistry.getHistory(serviceId, watch.id);
    expect(history).toHaveLength(1);
    expect(history[0].error).toBe('boom');
  });

  it('defaults t to Date.now() when the payload omits it', () => {
    const serviceId = sid();
    const watch = watchRegistry.addWatch(serviceId, { expr: 'x', mode: 'onChange' });
    const adapter = new CdpAdapter(serviceId, 'node', 'ws://127.0.0.1:9229/x');
    (adapter as any).bindingName = '__pagghiaroOnChange_svc';
    (adapter as any).onChangeWatches = new Set([watch.id]);

    const before = Date.now();
    (adapter as any).handleEvent('Runtime.bindingCalled', {
      name: '__pagghiaroOnChange_svc',
      payload: JSON.stringify({ watchId: watch.id, v: 1 }),
    });
    const after = Date.now();

    const history = watchRegistry.getHistory(serviceId, watch.id);
    expect(history[0].t).toBeGreaterThanOrEqual(before);
    expect(history[0].t).toBeLessThanOrEqual(after);
  });

  it('ignores the event when the binding name does not match', () => {
    const serviceId = sid();
    const watch = watchRegistry.addWatch(serviceId, { expr: 'x', mode: 'onChange' });
    const adapter = new CdpAdapter(serviceId, 'node', 'ws://127.0.0.1:9229/x');
    (adapter as any).bindingName = '__pagghiaroOnChange_svc';
    (adapter as any).onChangeWatches = new Set([watch.id]);

    (adapter as any).handleEvent('Runtime.bindingCalled', {
      name: '__someOtherBinding',
      payload: JSON.stringify({ watchId: watch.id, v: 1 }),
    });

    expect(watchRegistry.getHistory(serviceId, watch.id)).toHaveLength(0);
  });

  it('ignores the event when the watchId is not in onChangeWatches', () => {
    const serviceId = sid();
    const watch = watchRegistry.addWatch(serviceId, { expr: 'x', mode: 'onChange' });
    const adapter = new CdpAdapter(serviceId, 'node', 'ws://127.0.0.1:9229/x');
    (adapter as any).bindingName = '__pagghiaroOnChange_svc';
    (adapter as any).onChangeWatches = new Set(); // watch.id not registered

    (adapter as any).handleEvent('Runtime.bindingCalled', {
      name: '__pagghiaroOnChange_svc',
      payload: JSON.stringify({ watchId: watch.id, v: 1 }),
    });

    expect(watchRegistry.getHistory(serviceId, watch.id)).toHaveLength(0);
  });

  it('silently ignores a non-JSON payload string', () => {
    const serviceId = sid();
    const watch = watchRegistry.addWatch(serviceId, { expr: 'x', mode: 'onChange' });
    const adapter = new CdpAdapter(serviceId, 'node', 'ws://127.0.0.1:9229/x');
    (adapter as any).bindingName = '__pagghiaroOnChange_svc';
    (adapter as any).onChangeWatches = new Set([watch.id]);

    expect(() =>
      (adapter as any).handleEvent('Runtime.bindingCalled', {
        name: '__pagghiaroOnChange_svc',
        payload: 'not-json{',
      })
    ).not.toThrow();
    expect(watchRegistry.getHistory(serviceId, watch.id)).toHaveLength(0);
  });

  it('ignores non-bindingCalled, non-Debugger.paused methods', () => {
    const adapter = makeAdapter();
    expect(() => (adapter as any).handleEvent('Some.other', {})).not.toThrow();
  });

  it('routes Debugger.paused to the pending waitPausedResolve callback exactly once', () => {
    const adapter = makeAdapter();
    const calls: Record<string, unknown>[] = [];
    (adapter as any).waitPausedResolve = (payload: Record<string, unknown>) => calls.push(payload);

    (adapter as any).handleEvent('Debugger.paused', { callFrames: [] });
    expect(calls).toEqual([{ callFrames: [] }]);
    expect((adapter as any).waitPausedResolve).toBeNull();

    // A second paused event with no resolver registered must not throw.
    expect(() => (adapter as any).handleEvent('Debugger.paused', { callFrames: [] })).not.toThrow();
    expect(calls).toHaveLength(1);
  });
});

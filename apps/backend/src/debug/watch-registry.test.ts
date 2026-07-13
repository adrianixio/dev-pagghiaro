import { describe, expect, it } from 'bun:test';
import { watchRegistry } from './watch-registry';

let counter = 0;
/** Fresh, never-touched serviceId per test — avoids cross-test bleed without relying on resetService. */
function sid(): string {
  return `svc-wr-${counter++}`;
}

describe('watchRegistry.addWatch', () => {
  it('throws when expr is empty', () => {
    expect(() => watchRegistry.addWatch(sid(), { expr: '' })).toThrow('Watch expression is required');
  });

  it('throws when expr is whitespace only', () => {
    expect(() => watchRegistry.addWatch(sid(), { expr: '   ' })).toThrow('Watch expression is required');
  });

  it('trims expr and optional string fields', () => {
    const watch = watchRegistry.addWatch(sid(), {
      expr: '  foo.bar  ',
      threadName: '  main  ',
      label: '  Foo  ',
      condition: '  x > 1  ',
      groupName: '  Group  ',
    });
    expect(watch.expr).toBe('foo.bar');
    expect(watch.threadName).toBe('main');
    expect(watch.label).toBe('Foo');
    expect(watch.condition).toBe('x > 1');
    expect(watch.groupName).toBe('Group');
  });

  it('omits optional fields entirely when blank after trim', () => {
    const watch = watchRegistry.addWatch(sid(), { expr: 'x', threadName: '   ', label: '' });
    expect('threadName' in watch).toBe(false);
    expect('label' in watch).toBe(false);
  });

  it('defaults mode to interval', () => {
    const watch = watchRegistry.addWatch(sid(), { expr: 'x' });
    expect(watch.mode).toBe('interval');
  });

  it('defaults intervalMs to 500 when omitted', () => {
    const watch = watchRegistry.addWatch(sid(), { expr: 'x' });
    expect(watch.intervalMs).toBe(500);
  });

  it('clamps intervalMs below the 50 minimum', () => {
    const watch = watchRegistry.addWatch(sid(), { expr: 'x', intervalMs: 1 });
    expect(watch.intervalMs).toBe(50);
  });

  it('clamps intervalMs above the 60000 maximum', () => {
    const watch = watchRegistry.addWatch(sid(), { expr: 'x', intervalMs: 999_999 });
    expect(watch.intervalMs).toBe(60_000);
  });

  it('truncates a fractional intervalMs within range', () => {
    const watch = watchRegistry.addWatch(sid(), { expr: 'x', intervalMs: 123.9 });
    expect(watch.intervalMs).toBe(123);
  });

  it('falls back intervalMs to default when non-finite', () => {
    const watch = watchRegistry.addWatch(sid(), { expr: 'x', intervalMs: Number.NaN });
    expect(watch.intervalMs).toBe(500);
  });

  it('defaults bufferSize to 500 when omitted', () => {
    const watch = watchRegistry.addWatch(sid(), { expr: 'x' });
    expect(watch.bufferSize).toBe(500);
  });

  it('clamps bufferSize below the 1 minimum', () => {
    const watch = watchRegistry.addWatch(sid(), { expr: 'x', bufferSize: -5 });
    expect(watch.bufferSize).toBe(1);
  });

  it('clamps bufferSize above the 5000 maximum', () => {
    const watch = watchRegistry.addWatch(sid(), { expr: 'x', bufferSize: 999_999 });
    expect(watch.bufferSize).toBe(5_000);
  });

  it('returns a clone — mutating the result does not affect the store', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x' });
    watch.expr = 'MUTATED';
    watch.label = 'MUTATED';
    const [stored] = watchRegistry.listWatches(service);
    expect(stored!.expr).toBe('x');
    expect(stored!.label).toBeUndefined();
  });
});

describe('watchRegistry.pushSample', () => {
  it('marks the first sample for a watch as changed', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x', bufferSize: 10 });
    watchRegistry.pushSample(service, watch.id, { t: 1, value: 42 });
    const [sample] = watchRegistry.getHistory(service, watch.id);
    expect(sample!.valueChanged).toBe(true);
    expect(sample!.value).toBe(42);
  });

  it('sets valueChanged false when the value repeats', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x', bufferSize: 10 });
    watchRegistry.pushSample(service, watch.id, { t: 1, value: 42 });
    watchRegistry.pushSample(service, watch.id, { t: 2, value: 42 });
    const history = watchRegistry.getHistory(service, watch.id);
    expect(history[1]!.valueChanged).toBe(false);
  });

  it('sets valueChanged true when the value differs', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x', bufferSize: 10 });
    watchRegistry.pushSample(service, watch.id, { t: 1, value: 42 });
    watchRegistry.pushSample(service, watch.id, { t: 2, value: 43 });
    const history = watchRegistry.getHistory(service, watch.id);
    expect(history[1]!.valueChanged).toBe(true);
  });

  it('treats an error transitioning to a value as a change', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x', bufferSize: 10 });
    watchRegistry.pushSample(service, watch.id, { t: 1, error: 'boom' });
    watchRegistry.pushSample(service, watch.id, { t: 2, value: 'boom' });
    const history = watchRegistry.getHistory(service, watch.id);
    expect(history[1]!.valueChanged).toBe(true);
  });

  it('caps the ring at bufferSize, dropping the oldest samples', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x', bufferSize: 3 });
    for (let i = 1; i <= 5; i++) {
      watchRegistry.pushSample(service, watch.id, { t: i, value: i });
    }
    const history = watchRegistry.getHistory(service, watch.id);
    expect(history.map((s) => s.value)).toEqual([3, 4, 5]);
  });

  it('is a no-op when the watch does not exist', () => {
    const service = sid();
    expect(() => watchRegistry.pushSample(service, 'nope', { t: 1, value: 1 })).not.toThrow();
    expect(watchRegistry.getHistory(service, 'nope')).toEqual([]);
  });

  it('is a no-op when the service does not exist', () => {
    expect(() => watchRegistry.pushSample('never-touched', 'nope', { t: 1, value: 1 })).not.toThrow();
  });
});

describe('watchRegistry.getHistory', () => {
  it('returns all samples when no query is given', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x', bufferSize: 10 });
    watchRegistry.pushSample(service, watch.id, { t: 1, value: 1 });
    watchRegistry.pushSample(service, watch.id, { t: 2, value: 2 });
    expect(watchRegistry.getHistory(service, watch.id).length).toBe(2);
  });

  it('filters by from (inclusive)', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x', bufferSize: 10 });
    for (let i = 1; i <= 5; i++) watchRegistry.pushSample(service, watch.id, { t: i, value: i });
    const history = watchRegistry.getHistory(service, watch.id, { from: 3 });
    expect(history.map((s) => s.t)).toEqual([3, 4, 5]);
  });

  it('filters by to (inclusive)', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x', bufferSize: 10 });
    for (let i = 1; i <= 5; i++) watchRegistry.pushSample(service, watch.id, { t: i, value: i });
    const history = watchRegistry.getHistory(service, watch.id, { to: 3 });
    expect(history.map((s) => s.t)).toEqual([1, 2, 3]);
  });

  it('filters by from and to together', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x', bufferSize: 10 });
    for (let i = 1; i <= 5; i++) watchRegistry.pushSample(service, watch.id, { t: i, value: i });
    const history = watchRegistry.getHistory(service, watch.id, { from: 2, to: 4 });
    expect(history.map((s) => s.t)).toEqual([2, 3, 4]);
  });

  it('returns [] for a missing watch', () => {
    const service = sid();
    watchRegistry.addWatch(service, { expr: 'x' });
    expect(watchRegistry.getHistory(service, 'missing-watch-id')).toEqual([]);
  });

  it('returns [] for a missing service', () => {
    expect(watchRegistry.getHistory('never-touched', 'missing-watch-id')).toEqual([]);
  });
});

describe('watchRegistry.reorderWatches', () => {
  it('returns [] when the service has never been touched', () => {
    expect(watchRegistry.reorderWatches('never-touched', ['a', 'b'])).toEqual([]);
  });

  it('returns null on length mismatch', () => {
    const service = sid();
    const w1 = watchRegistry.addWatch(service, { expr: 'a' });
    watchRegistry.addWatch(service, { expr: 'b' });
    expect(watchRegistry.reorderWatches(service, [w1.id])).toBeNull();
  });

  it('returns null on an unknown watch id', () => {
    const service = sid();
    const w1 = watchRegistry.addWatch(service, { expr: 'a' });
    const w2 = watchRegistry.addWatch(service, { expr: 'b' });
    void w2;
    expect(watchRegistry.reorderWatches(service, [w1.id, 'unknown-id'])).toBeNull();
  });

  it('returns null on duplicate ids', () => {
    const service = sid();
    const w1 = watchRegistry.addWatch(service, { expr: 'a' });
    watchRegistry.addWatch(service, { expr: 'b' });
    expect(watchRegistry.reorderWatches(service, [w1.id, w1.id])).toBeNull();
  });

  it('reorders watches and returns them in the new order', () => {
    const service = sid();
    const w1 = watchRegistry.addWatch(service, { expr: 'a' });
    const w2 = watchRegistry.addWatch(service, { expr: 'b' });
    const reordered = watchRegistry.reorderWatches(service, [w2.id, w1.id]);
    expect(reordered!.map((w) => w.id)).toEqual([w2.id, w1.id]);
    expect(watchRegistry.listWatches(service).map((w) => w.id)).toEqual([w2.id, w1.id]);
  });
});

describe('watchRegistry.removeWatch', () => {
  it('returns false when the service has never been touched', () => {
    expect(watchRegistry.removeWatch('never-touched', 'nope')).toBe(false);
  });

  it('returns false when the watch id is absent from an existing service', () => {
    const service = sid();
    watchRegistry.addWatch(service, { expr: 'x' });
    expect(watchRegistry.removeWatch(service, 'nope')).toBe(false);
  });

  it('returns true and emits a session update on removal', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x' });
    let emitted: string[] | null = null;
    const unsubscribe = watchRegistry.subscribeSession(service, (state) => {
      emitted = state.watches.map((w) => w.id);
    });
    const result = watchRegistry.removeWatch(service, watch.id);
    unsubscribe();
    expect(result).toBe(true);
    expect(emitted).toEqual([]);
    expect(watchRegistry.listWatches(service)).toEqual([]);
  });
});

describe('watchRegistry.setAdapterState', () => {
  it('applies language and status patches', () => {
    const service = sid();
    const state = watchRegistry.setAdapterState(service, { language: 'node', status: 'attached' });
    expect(state.language).toBe('node');
    expect(state.status).toBe('attached');
  });

  it('sets message when provided as a string', () => {
    const service = sid();
    const state = watchRegistry.setAdapterState(service, { message: 'hello' });
    expect(state.message).toBe('hello');
  });

  it('deletes message when patched with null', () => {
    const service = sid();
    watchRegistry.setAdapterState(service, { message: 'hello' });
    const state = watchRegistry.setAdapterState(service, { message: null });
    expect(state.message).toBeUndefined();
    expect('message' in state).toBe(false);
  });

  it('leaves fields untouched when omitted from the patch', () => {
    const service = sid();
    watchRegistry.setAdapterState(service, { language: 'python', status: 'attached', message: 'keep me' });
    const state = watchRegistry.setAdapterState(service, { status: 'error' });
    expect(state.language).toBe('python');
    expect(state.message).toBe('keep me');
    expect(state.status).toBe('error');
  });
});

describe('watchRegistry.resetService', () => {
  it('clears watches and resets status to detached', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'x' });
    watchRegistry.pushSample(service, watch.id, { t: 1, value: 1 });
    watchRegistry.setAdapterState(service, { language: 'node', status: 'attached', message: 'hi' });

    watchRegistry.resetService(service);

    const session = watchRegistry.getSession(service);
    expect(session.watches).toEqual([]);
    expect(session.status).toBe('detached');
    expect(session.language).toBeNull();
    expect(session.message).toBeUndefined();
  });

  it('is a no-op when the service has never been touched', () => {
    expect(() => watchRegistry.resetService('never-touched-reset')).not.toThrow();
  });
});

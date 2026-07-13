import { describe, expect, it } from 'bun:test';
import { logBus } from '../log-bus';
import { recordingStore } from './recording-store';
import { watchRegistry } from './watch-registry';
import type { DebugScopeSnapshot } from '@dev-pagghiaro/shared';

let counter = 0;
/** Fresh, never-touched serviceId per test — both singletons key state by serviceId. */
function sid(): string {
  return `svc-rs-${counter++}`;
}

/** Waits for real time to pass — used only for the auto-recording timer path. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('recordingStore.startRecording', () => {
  it('throws when a recording is already active for the service', () => {
    const service = sid();
    recordingStore.startRecording(service);
    expect(() => recordingStore.startRecording(service)).toThrow(
      'A recording is already in progress for this service'
    );
    recordingStore.resetService(service);
  });

  it('defaults the name to "Recording <ISO timestamp>"', () => {
    const service = sid();
    const summary = recordingStore.startRecording(service);
    expect(summary.name).toMatch(/^Recording \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    recordingStore.resetService(service);
  });

  it('trims a provided name', () => {
    const service = sid();
    const summary = recordingStore.startRecording(service, '  My Recording  ');
    expect(summary.name).toBe('My Recording');
    recordingStore.resetService(service);
  });

  it('falls back to the default name when given a blank string', () => {
    const service = sid();
    const summary = recordingStore.startRecording(service, '   ');
    expect(summary.name).toMatch(/^Recording /);
    recordingStore.resetService(service);
  });

  it('defaults kind to manual', () => {
    const service = sid();
    const summary = recordingStore.startRecording(service);
    expect(summary.kind).toBe('manual');
    recordingStore.resetService(service);
  });

  it('pre-registers buckets from watchRegistry.listWatches', () => {
    const service = sid();
    watchRegistry.addWatch(service, { expr: 'a' });
    watchRegistry.addWatch(service, { expr: 'b' });
    const summary = recordingStore.startRecording(service);
    expect(summary.watchCount).toBe(2);
    expect(summary.sampleCount).toBe(0);
    recordingStore.resetService(service);
    watchRegistry.resetService(service);
  });

  it('drains samples pushed through watchRegistry into per-watch buckets (manual mode)', () => {
    const service = sid();
    const watch = watchRegistry.addWatch(service, { expr: 'a' });
    const started = recordingStore.startRecording(service);
    watchRegistry.pushSample(service, watch.id, { t: 1, value: 1 });
    watchRegistry.pushSample(service, watch.id, { t: 2, value: 2 });
    const stopped = recordingStore.stopRecording(service, started.id);
    expect(stopped!.sampleCount).toBe(2);
    const recording = recordingStore.getRecording(service, started.id);
    expect(recording!.tracks).toHaveLength(1);
    expect(recording!.tracks[0]!.watch.id).toBe(watch.id);
    expect(recording!.tracks[0]!.samples.map((s) => s.value)).toEqual([1, 2]);
    watchRegistry.resetService(service);
  });

  it('caps captured logs at MAX_CAPTURED_LOGS (5000), dropping the oldest', () => {
    const service = sid();
    const started = recordingStore.startRecording(service, undefined, { includeLogs: true });
    for (let i = 0; i < 5001; i++) {
      logBus.emit(service, String(i));
    }
    recordingStore.stopRecording(service, started.id);
    const recording = recordingStore.getRecording(service, started.id);
    expect(recording!.logs).toHaveLength(5000);
    expect(recording!.logs![0]!.data).toBe('1');
    expect(recording!.logs![recording!.logs!.length - 1]!.data).toBe('5000');
  });

  it('caps captured metrics at MAX_CAPTURED_METRICS (1000), dropping the oldest', () => {
    const service = sid();
    const started = recordingStore.startRecording(service, undefined, { includeMetrics: true });
    for (let i = 0; i < 1001; i++) {
      logBus.emitMetrics(service, { serviceId: service, cpu: i, memoryBytes: 0, measuredAt: i });
    }
    recordingStore.stopRecording(service, started.id);
    const recording = recordingStore.getRecording(service, started.id);
    expect(recording!.metrics).toHaveLength(1000);
    expect(recording!.metrics![0]!.cpu).toBe(1);
    expect(recording!.metrics![recording!.metrics!.length - 1]!.cpu).toBe(1000);
  });

  it('caps captured status changes at MAX_CAPTURED_STATUS (200), dropping the oldest', () => {
    const service = sid();
    const started = recordingStore.startRecording(service, undefined, { includeStatus: true });
    for (let i = 0; i < 201; i++) {
      logBus.emitStatus(service, i % 2 === 0 ? 'running' : 'error', i);
    }
    recordingStore.stopRecording(service, started.id);
    const recording = recordingStore.getRecording(service, started.id);
    expect(recording!.statusChanges).toHaveLength(200);
    expect(recording!.statusChanges![0]!.pid).toBe(1);
    expect(recording!.statusChanges![recording!.statusChanges!.length - 1]!.pid).toBe(200);
  });

  it('throws for auto mode without a snapshotScope', () => {
    const service = sid();
    expect(() => recordingStore.startRecording(service, undefined, { kind: 'auto' })).toThrow(
      'Auto recording requires an attached debug adapter'
    );
  });

  it('clamps autoFrameDepth into [1, 10] and passes options through to snapshotScope', async () => {
    const service = sid();
    const calls: Array<{ autoFrameDepth: number; includeUserGlobals: boolean; includeClosures: boolean }> = [];
    const snapshotScope = async (opts: {
      autoFrameDepth: number;
      includeUserGlobals: boolean;
      includeClosures: boolean;
    }): Promise<DebugScopeSnapshot> => {
      calls.push(opts);
      return { t: Date.now(), frames: [], userGlobals: [] };
    };

    recordingStore.startRecording(service, undefined, {
      kind: 'auto',
      autoIntervalMs: 250,
      autoMaxSnapshots: 1,
      autoFrameDepth: 999,
      snapshotScope,
    });
    await wait(400);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.autoFrameDepth).toBe(10);
    expect(calls[0]!.includeUserGlobals).toBe(true);
    expect(calls[0]!.includeClosures).toBe(true);
  });

  it('clamps autoFrameDepth up to the 1 minimum', async () => {
    const service = sid();
    const calls: number[] = [];
    const snapshotScope = async (opts: { autoFrameDepth: number }): Promise<DebugScopeSnapshot> => {
      calls.push(opts.autoFrameDepth);
      return { t: Date.now(), frames: [], userGlobals: [] };
    };

    recordingStore.startRecording(service, undefined, {
      kind: 'auto',
      autoIntervalMs: 250,
      autoMaxSnapshots: 1,
      autoFrameDepth: 0,
      snapshotScope,
    });
    await wait(400);

    expect(calls).toEqual([1]);
  });

  it('clamps autoMaxSnapshots up to the 1 minimum and auto-stops after the first snapshot', async () => {
    const service = sid();
    const snapshotScope = async (): Promise<DebugScopeSnapshot> => ({ t: Date.now(), frames: [], userGlobals: [] });

    recordingStore.startRecording(service, undefined, {
      kind: 'auto',
      autoIntervalMs: 250,
      autoMaxSnapshots: 0,
      snapshotScope,
    });
    await wait(400);

    expect(recordingStore.getActive(service)).toBeNull();
    const [summary] = recordingStore.listRecordings(service);
    expect(summary!.snapshotCount).toBe(1);
  });

  it('clamps autoIntervalMs up to the 250ms minimum', async () => {
    const service = sid();
    const snapshotScope = async (): Promise<DebugScopeSnapshot> => ({ t: Date.now(), frames: [], userGlobals: [] });

    recordingStore.startRecording(service, undefined, {
      kind: 'auto',
      autoIntervalMs: 1,
      autoMaxSnapshots: 1,
      snapshotScope,
    });

    await wait(100);
    expect(recordingStore.getActive(service)).not.toBeNull();

    await wait(300);
    expect(recordingStore.getActive(service)).toBeNull();
  });

  it('auto-stops once autoMaxSnapshots is reached', async () => {
    const service = sid();
    const snapshotScope = async (): Promise<DebugScopeSnapshot> => ({ t: Date.now(), frames: [], userGlobals: [] });

    recordingStore.startRecording(service, undefined, {
      kind: 'auto',
      autoIntervalMs: 250,
      autoMaxSnapshots: 2,
      snapshotScope,
    });
    await wait(650);

    expect(recordingStore.getActive(service)).toBeNull();
    const [summary] = recordingStore.listRecordings(service);
    expect(summary!.snapshotCount).toBe(2);
  });

  it('pushes an error snapshot when snapshotScope rejects', async () => {
    const service = sid();
    const snapshotScope = async (): Promise<DebugScopeSnapshot> => {
      throw new Error('boom');
    };

    const started = recordingStore.startRecording(service, undefined, {
      kind: 'auto',
      autoIntervalMs: 250,
      autoMaxSnapshots: 1,
      snapshotScope,
    });
    await wait(400);

    const recording = recordingStore.getRecording(service, started.id);
    expect(recording!.snapshots).toHaveLength(1);
    expect(recording!.snapshots![0]!.error).toBe('boom');
    expect(recording!.snapshots![0]!.frames).toEqual([]);
    expect(recording!.snapshots![0]!.userGlobals).toEqual([]);
  });
});

describe('recordingStore.stopRecording', () => {
  it('returns null when nothing is active for the service', () => {
    expect(recordingStore.stopRecording(sid())).toBeNull();
  });

  it('returns null on recordingId mismatch and leaves the capture active', () => {
    const service = sid();
    recordingStore.startRecording(service);
    expect(recordingStore.stopRecording(service, 'wrong-id')).toBeNull();
    expect(recordingStore.getActive(service)).not.toBeNull();
    recordingStore.resetService(service);
  });

  it('unshifts finished recordings newest-first', () => {
    const service = sid();
    const first = recordingStore.startRecording(service);
    recordingStore.stopRecording(service, first.id);
    const second = recordingStore.startRecording(service);
    recordingStore.stopRecording(service, second.id);

    const ids = recordingStore.listRecordings(service).map((r) => r.id);
    expect(ids).toEqual([second.id, first.id]);
  });

  it('caps finished recordings at 25, dropping the oldest', () => {
    const service = sid();
    const ids: string[] = [];
    for (let i = 0; i < 26; i++) {
      const started = recordingStore.startRecording(service);
      ids.push(started.id);
      recordingStore.stopRecording(service, started.id);
    }

    const finishedIds = recordingStore.listRecordings(service).map((r) => r.id);
    expect(finishedIds).toHaveLength(25);
    // Newest first; the very first recording created (ids[0]) was dropped.
    expect(finishedIds).toEqual([...ids].reverse().slice(0, 25));
    expect(finishedIds).not.toContain(ids[0]);
  });
});

describe('recordingStore.removeRecording', () => {
  it('returns false when the service has no finished recordings', () => {
    expect(recordingStore.removeRecording(sid(), 'nope')).toBe(false);
  });

  it('returns false when the recordingId is unknown', () => {
    const service = sid();
    const started = recordingStore.startRecording(service);
    recordingStore.stopRecording(service, started.id);
    expect(recordingStore.removeRecording(service, 'unknown')).toBe(false);
  });

  it('returns true and removes a known recording', () => {
    const service = sid();
    const started = recordingStore.startRecording(service);
    recordingStore.stopRecording(service, started.id);
    expect(recordingStore.removeRecording(service, started.id)).toBe(true);
    expect(recordingStore.listRecordings(service)).toEqual([]);
  });
});

describe('recordingStore.resetService', () => {
  it('stops an active capture and clears finished recordings', () => {
    const service = sid();
    const first = recordingStore.startRecording(service);
    recordingStore.stopRecording(service, first.id);
    recordingStore.startRecording(service); // leave one active

    recordingStore.resetService(service);

    expect(recordingStore.getActive(service)).toBeNull();
    expect(recordingStore.listRecordings(service)).toEqual([]);
  });

  it('is a no-op when the service has no state', () => {
    expect(() => recordingStore.resetService(sid())).not.toThrow();
  });
});

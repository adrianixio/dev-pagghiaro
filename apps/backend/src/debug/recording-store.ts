/**
 * In-memory store for debug recordings.
 *
 * A recording is a named, time-bounded capture of every sample emitted by a
 * service's watches. Unlike the per-watch ring buffer, recordings are
 * uncapped while active — we subscribe to the live sample stream the moment
 * `startRecording` is called and drain into per-watch buckets until
 * `stopRecording` finalises the snapshot. The captured tracks freeze at stop
 * time so subsequent watch mutations don't rewrite history.
 *
 * Storage is volatile (lost on backend restart). Persistence to disk would
 * mirror Phase 9's `persistDebugWatches` plumbing if/when needed.
 */

import { randomUUID } from 'node:crypto';
import type {
  DebugRecording,
  DebugRecordingKind,
  DebugRecordingLogEntry,
  DebugScopeSnapshot,
  DebugRecordingStatusChange,
  DebugRecordingSummary,
  DebugRecordingTrack,
  DebugSample,
  DebugWatch,
  ServiceMetrics,
} from '@dev-pagghiaro/shared';
import { logBus } from '../log-bus';
import { watchRegistry } from './watch-registry';

const MAX_CAPTURED_LOGS = 5_000;
const MAX_CAPTURED_METRICS = 1_000;
const MAX_CAPTURED_STATUS = 200;

interface ActiveCapture {
  id: string;
  serviceId: string;
  name: string;
  startedAt: number;
  /** Per-watch sample buckets. Watches that didn't exist at start get a slot lazily. */
  buckets: Map<string, DebugSample[]>;
  /** Latest watch metadata observed during the recording (used at freeze time). */
  watchSnapshots: Map<string, DebugWatch>;
  unsubscribe: () => void;
  includeLogs: boolean;
  includeMetrics: boolean;
  includeStatus: boolean;
  logs: DebugRecordingLogEntry[];
  metrics: ServiceMetrics[];
  statusChanges: DebugRecordingStatusChange[];
  kind: DebugRecordingKind;
  snapshots: DebugScopeSnapshot[];
  autoTimer: ReturnType<typeof setInterval> | null;
}

interface StartRecordingOptions {
  includeLogs?: boolean;
  includeMetrics?: boolean;
  includeStatus?: boolean;
  kind?: DebugRecordingKind;
  autoIntervalMs?: number;
  autoMaxSnapshots?: number;
  autoFrameDepth?: number;
  includeUserGlobals?: boolean;
  includeClosures?: boolean;
  excludeFrameRegex?: string;
  snapshotScope?: (opts: {
    autoFrameDepth: number;
    includeUserGlobals: boolean;
    includeClosures: boolean;
    excludeFrameRegex?: string;
  }) => Promise<DebugScopeSnapshot>;
}

const AUTO_INTERVAL_DEFAULT = 1000;
const AUTO_INTERVAL_MIN = 250;
const AUTO_INTERVAL_MAX = 10_000;
const AUTO_MAX_SNAPSHOTS_DEFAULT = 100;
const AUTO_MAX_SNAPSHOTS_MAX = 500;
const AUTO_FRAME_DEPTH_DEFAULT = 3;
const AUTO_FRAME_DEPTH_MAX = 10;

type SummaryListener = (summary: DebugRecordingSummary) => void;
type RemoveListener = (recordingId: string) => void;

const active = new Map<string, ActiveCapture>(); // serviceId → capture (one at a time per service)
const finished = new Map<string, DebugRecording[]>(); // serviceId → list
const startedListeners = new Map<string, Set<SummaryListener>>();
const stoppedListeners = new Map<string, Set<SummaryListener>>();
const removedListeners = new Map<string, Set<RemoveListener>>();

const MAX_RECORDINGS_PER_SERVICE = 25;

function summarise(recording: DebugRecording): DebugRecordingSummary {
  let sampleCount = 0;
  for (const track of recording.tracks) sampleCount += track.samples.length;
  const summary: DebugRecordingSummary = {
    id: recording.id,
    serviceId: recording.serviceId,
    name: recording.name,
    startedAt: recording.startedAt,
    watchCount: recording.tracks.length,
    sampleCount,
    kind: recording.kind ?? 'manual',
  };
  if ((recording.kind ?? 'manual') === 'auto') {
    summary.snapshotCount = recording.snapshots?.length ?? 0;
  }
  if (recording.endedAt !== undefined) summary.endedAt = recording.endedAt;
  if (recording.logs) {
    summary.includeLogs = true;
    summary.logCount = recording.logs.length;
  }
  if (recording.metrics) {
    summary.includeMetrics = true;
    summary.metricCount = recording.metrics.length;
  }
  if (recording.statusChanges) {
    summary.includeStatus = true;
    summary.statusCount = recording.statusChanges.length;
  }
  return summary;
}

function summariseActive(capture: ActiveCapture): DebugRecordingSummary {
  let sampleCount = 0;
  for (const samples of capture.buckets.values()) sampleCount += samples.length;
  const summary: DebugRecordingSummary = {
    id: capture.id,
    serviceId: capture.serviceId,
    name: capture.name,
    startedAt: capture.startedAt,
    watchCount: capture.buckets.size,
    sampleCount,
    kind: capture.kind,
  };
  if (capture.kind === 'auto') summary.snapshotCount = capture.snapshots.length;
  if (capture.includeLogs) {
    summary.includeLogs = true;
    summary.logCount = capture.logs.length;
  }
  if (capture.includeMetrics) {
    summary.includeMetrics = true;
    summary.metricCount = capture.metrics.length;
  }
  if (capture.includeStatus) {
    summary.includeStatus = true;
    summary.statusCount = capture.statusChanges.length;
  }
  return summary;
}

function emit(map: Map<string, Set<SummaryListener>>, serviceId: string, summary: DebugRecordingSummary): void {
  const set = map.get(serviceId);
  if (!set) return;
  for (const listener of set) listener(summary);
}

function subscribeFactory(map: Map<string, Set<SummaryListener>>) {
  return (serviceId: string, listener: SummaryListener): (() => void) => {
    let set = map.get(serviceId);
    if (!set) {
      set = new Set();
      map.set(serviceId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) map.delete(serviceId);
    };
  };
}

export const recordingStore = {
  startRecording(
    serviceId: string,
    name?: string,
    options?: StartRecordingOptions
  ): DebugRecordingSummary {
    if (active.has(serviceId)) {
      throw new Error('A recording is already in progress for this service');
    }

    const id = randomUUID();
    const startedAt = Date.now();
    const trimmedName = name?.trim();
    const finalName = trimmedName && trimmedName.length > 0
      ? trimmedName
      : `Recording ${new Date(startedAt).toISOString().replace(/\.\d+Z$/, 'Z')}`;

    const buckets = new Map<string, DebugSample[]>();
    const watchSnapshots = new Map<string, DebugWatch>();

    // Pre-register slots for currently-known watches so the UI can show track
    // metadata even before the first sample lands.
    for (const watch of watchRegistry.listWatches(serviceId)) {
      buckets.set(watch.id, []);
      watchSnapshots.set(watch.id, watch);
    }

    const capture: ActiveCapture = {
      id,
      serviceId,
      name: finalName,
      startedAt,
      buckets,
      watchSnapshots,
      unsubscribe: () => {},
      includeLogs: Boolean(options?.includeLogs),
      includeMetrics: Boolean(options?.includeMetrics),
      includeStatus: Boolean(options?.includeStatus),
      logs: [],
      metrics: [],
      statusChanges: [],
      kind: options?.kind ?? 'manual',
      snapshots: [],
      autoTimer: null,
    };

    const unsubs: Array<() => void> = [];
    if (capture.kind === 'manual') {
      unsubs.push(
        watchRegistry.subscribeSamples(serviceId, (sample) => {
          let bucket = capture.buckets.get(sample.watchId);
          if (!bucket) {
            bucket = [];
            capture.buckets.set(sample.watchId, bucket);
          }
          bucket.push(sample);
        })
      );
    }
    unsubs.push(
      watchRegistry.subscribeSession(serviceId, (state) => {
        for (const watch of state.watches) {
          capture.watchSnapshots.set(watch.id, watch);
        }
      })
    );

    if (capture.includeLogs) {
      unsubs.push(
        logBus.subscribeLog(serviceId, (entry) => {
          capture.logs.push({ t: entry.timestamp, data: entry.data });
          if (capture.logs.length > MAX_CAPTURED_LOGS) {
            capture.logs.splice(0, capture.logs.length - MAX_CAPTURED_LOGS);
          }
        })
      );
    }
    if (capture.includeMetrics) {
      unsubs.push(
        logBus.subscribeMetrics(serviceId, (metrics) => {
          capture.metrics.push({ ...metrics });
          if (capture.metrics.length > MAX_CAPTURED_METRICS) {
            capture.metrics.splice(0, capture.metrics.length - MAX_CAPTURED_METRICS);
          }
        })
      );
    }
    if (capture.includeStatus) {
      unsubs.push(
        logBus.subscribeStatus(serviceId, (status, pid) => {
          const change: DebugRecordingStatusChange = { t: Date.now(), status };
          if (pid !== undefined) change.pid = pid;
          capture.statusChanges.push(change);
          if (capture.statusChanges.length > MAX_CAPTURED_STATUS) {
            capture.statusChanges.splice(0, capture.statusChanges.length - MAX_CAPTURED_STATUS);
          }
        })
      );
    }

    capture.unsubscribe = () => {
      if (capture.autoTimer) {
        clearInterval(capture.autoTimer);
        capture.autoTimer = null;
      }
      for (const u of unsubs) {
        try { u(); } catch { /* ignore */ }
      }
    };

    if (capture.kind === 'auto') {
      if (!options?.snapshotScope) {
        throw new Error('Auto recording requires an attached debug adapter');
      }
      const autoIntervalMs = Math.max(AUTO_INTERVAL_MIN, Math.min(AUTO_INTERVAL_MAX, options.autoIntervalMs ?? AUTO_INTERVAL_DEFAULT));
      const autoMaxSnapshots = Math.max(1, Math.min(AUTO_MAX_SNAPSHOTS_MAX, options.autoMaxSnapshots ?? AUTO_MAX_SNAPSHOTS_DEFAULT));
      const autoFrameDepth = Math.max(1, Math.min(AUTO_FRAME_DEPTH_MAX, options.autoFrameDepth ?? AUTO_FRAME_DEPTH_DEFAULT));
      const includeUserGlobals = options.includeUserGlobals ?? true;
      const includeClosures = options.includeClosures ?? true;

      let chain: Promise<void> = Promise.resolve();
      capture.autoTimer = setInterval(() => {
        chain = chain.then(async () => {
          if (!active.has(serviceId)) return;
          try {
            const snapshot = await options.snapshotScope!({
              autoFrameDepth,
              includeUserGlobals,
              includeClosures,
              excludeFrameRegex: options.excludeFrameRegex,
            });
            capture.snapshots.push(snapshot);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            capture.snapshots.push({ t: Date.now(), frames: [], userGlobals: [], error: message });
          }
          if (capture.snapshots.length >= autoMaxSnapshots) {
            recordingStore.stopRecording(serviceId, capture.id);
          }
        });
      }, autoIntervalMs);
    }

    active.set(serviceId, capture);

    const summary = summariseActive(capture);
    emit(startedListeners, serviceId, summary);
    return summary;
  },

  stopRecording(serviceId: string, recordingId?: string): DebugRecordingSummary | null {
    const capture = active.get(serviceId);
    if (!capture) return null;
    if (recordingId !== undefined && capture.id !== recordingId) return null;

    capture.unsubscribe();
    active.delete(serviceId);

    const endedAt = Date.now();
    const tracks: DebugRecordingTrack[] = [];
    for (const [watchId, samples] of capture.buckets.entries()) {
      const watch = capture.watchSnapshots.get(watchId);
      if (!watch) continue; // watch deleted before we ever saw metadata
      tracks.push({ watch, samples });
    }

    const recording: DebugRecording = {
      id: capture.id,
      serviceId: capture.serviceId,
      name: capture.name,
      startedAt: capture.startedAt,
      endedAt,
      kind: capture.kind,
      tracks,
      snapshots: capture.kind === 'auto' ? capture.snapshots : undefined,
      ...(capture.includeLogs ? { logs: capture.logs } : {}),
      ...(capture.includeMetrics ? { metrics: capture.metrics } : {}),
      ...(capture.includeStatus ? { statusChanges: capture.statusChanges } : {}),
    };

    const list = finished.get(serviceId) ?? [];
    list.unshift(recording);
    while (list.length > MAX_RECORDINGS_PER_SERVICE) list.pop();
    finished.set(serviceId, list);

    const summary = summarise(recording);
    emit(stoppedListeners, serviceId, summary);
    return summary;
  },

  /** Returns the live capture for a service, if any (for UI status display). */
  getActive(serviceId: string): DebugRecordingSummary | null {
    const capture = active.get(serviceId);
    return capture ? summariseActive(capture) : null;
  },

  listRecordings(serviceId: string): DebugRecordingSummary[] {
    return (finished.get(serviceId) ?? []).map(summarise);
  },

  getRecording(serviceId: string, recordingId: string): DebugRecording | null {
    const list = finished.get(serviceId) ?? [];
    const found = list.find((r) => r.id === recordingId);
    return found ?? null;
  },

  removeRecording(serviceId: string, recordingId: string): boolean {
    const list = finished.get(serviceId);
    if (!list) return false;
    const index = list.findIndex((r) => r.id === recordingId);
    if (index === -1) return false;
    list.splice(index, 1);

    const set = removedListeners.get(serviceId);
    if (set) {
      for (const listener of set) listener(recordingId);
    }
    return true;
  },

  /** Reset all recordings for a service — called when its process exits. */
  resetService(serviceId: string): void {
    const capture = active.get(serviceId);
    if (capture) {
      capture.unsubscribe();
      active.delete(serviceId);
    }
    finished.delete(serviceId);
  },

  subscribeStarted: subscribeFactory(startedListeners),
  subscribeStopped: subscribeFactory(stoppedListeners),
  subscribeRemoved(serviceId: string, listener: RemoveListener): () => void {
    let set = removedListeners.get(serviceId);
    if (!set) {
      set = new Set();
      removedListeners.set(serviceId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) removedListeners.delete(serviceId);
    };
  },
};

/**
 * In-memory registry for debug watches and their sample history.
 *
 * Foundation only — no language adapter is wired up yet, so sessions stay
 * `detached` and watches receive no samples until Phase 2 lands. The bus
 * surface mirrors `log-bus` so the WS route can subscribe in the same shape.
 */

import { randomUUID } from 'node:crypto';
import type {
  CreateDebugWatchBody,
  DebugAdapterStatus,
  DebugLanguage,
  DebugSample,
  DebugSessionState,
  DebugWatch,
} from '@dev-pagghiaro/shared';

const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_BUFFER_SIZE = 500;
const MIN_INTERVAL_MS = 50;
const MAX_INTERVAL_MS = 60_000;
const MAX_BUFFER_SIZE = 5_000;

interface WatchSlot {
  watch: DebugWatch;
  ring: DebugSample[];
}

interface ServiceSlot {
  serviceId: string;
  language: DebugLanguage | null;
  status: DebugAdapterStatus;
  message?: string;
  watches: Map<string, WatchSlot>;
}

interface HistoryQuery {
  from?: number;
  to?: number;
}

type SessionListener = (state: DebugSessionState) => void;
type SampleListener = (sample: DebugSample) => void;

const services = new Map<string, ServiceSlot>();
const sessionListeners = new Map<string, Set<SessionListener>>();
const sampleListeners = new Map<string, Set<SampleListener>>();

function getSlot(serviceId: string): ServiceSlot {
  let slot = services.get(serviceId);
  if (!slot) {
    slot = {
      serviceId,
      language: null,
      status: 'detached',
      watches: new Map(),
    };
    services.set(serviceId, slot);
  }
  return slot;
}

function cloneWatch(watch: DebugWatch): DebugWatch {
  return { ...watch };
}

function cloneWatchSlot(watch: DebugWatch): WatchSlot {
  return { watch: cloneWatch(watch), ring: [] };
}

function snapshotSession(slot: ServiceSlot): DebugSessionState {
  return {
    serviceId: slot.serviceId,
    language: slot.language,
    status: slot.status,
    ...(slot.message !== undefined ? { message: slot.message } : {}),
    watches: [...slot.watches.values()].map((w) => cloneWatch(w.watch)),
  };
}

function emitSession(slot: ServiceSlot): void {
  const listeners = sessionListeners.get(slot.serviceId);
  if (!listeners || listeners.size === 0) return;
  const snap = snapshotSession(slot);
  for (const listener of listeners) {
    listener(snap);
  }
}

function stringifyForDiff(input: { value?: unknown; error?: string }): string {
  if (input.error !== undefined) return `e:${input.error}`;
  if (input.value === undefined) return 'u';
  if (typeof input.value === 'string') return `s:${input.value}`;
  try {
    return `j:${JSON.stringify(input.value)}`;
  } catch {
    return `o:${String(input.value)}`;
  }
}

function sampleValueDiffers(
  previous: DebugSample,
  next: { value?: unknown; error?: string }
): boolean {
  return stringifyForDiff(previous) !== stringifyForDiff(next);
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeHistoryQuery(query?: HistoryQuery): HistoryQuery {
  const from = query?.from;
  const to = query?.to;
  return {
    ...(from !== undefined && Number.isFinite(from) ? { from } : {}),
    ...(to !== undefined && Number.isFinite(to) ? { to } : {}),
  };
}

function filterHistory(samples: DebugSample[], query?: HistoryQuery): DebugSample[] {
  const { from, to } = normalizeHistoryQuery(query);
  if (from === undefined && to === undefined) {
    return [...samples];
  }

  return samples.filter((sample) => {
    if (from !== undefined && sample.t < from) return false;
    if (to !== undefined && sample.t > to) return false;
    return true;
  });
}

export const watchRegistry = {
  getSession(serviceId: string): DebugSessionState {
    return snapshotSession(getSlot(serviceId));
  },

  listWatches(serviceId: string): DebugWatch[] {
    return [...getSlot(serviceId).watches.values()].map((w) => cloneWatch(w.watch));
  },

  getHistory(serviceId: string, watchId: string, query?: HistoryQuery): DebugSample[] {
    const slot = services.get(serviceId);
    const entry = slot?.watches.get(watchId);
    return entry ? filterHistory(entry.ring, query) : [];
  },

  restoreWatches(serviceId: string, watches: DebugWatch[]): DebugWatch[] {
    const slot = getSlot(serviceId);
    if (slot.watches.size > 0 || watches.length === 0) {
      return this.listWatches(serviceId);
    }

    for (const watch of watches) {
      slot.watches.set(watch.id, cloneWatchSlot({ ...watch, serviceId }));
    }

    emitSession(slot);
    return this.listWatches(serviceId);
  },

  addWatch(serviceId: string, body: CreateDebugWatchBody): DebugWatch {
    const expr = body.expr?.trim();
    if (!expr) {
      throw new Error('Watch expression is required');
    }

    const threadName = body.threadName?.trim();
    const label = body.label?.trim();
    const condition = body.condition?.trim();
    const groupName = body.groupName?.trim();

    const watch: DebugWatch = {
      id: randomUUID(),
      serviceId,
      expr,
      mode: body.mode ?? 'interval',
      intervalMs: clampNumber(body.intervalMs, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS),
      bufferSize: clampNumber(body.bufferSize, DEFAULT_BUFFER_SIZE, 1, MAX_BUFFER_SIZE),
      createdAt: Date.now(),
      ...(threadName ? { threadName } : {}),
      ...(label ? { label } : {}),
      ...(condition ? { condition } : {}),
      ...(groupName ? { groupName } : {}),
    };

    const slot = getSlot(serviceId);
    slot.watches.set(watch.id, { watch, ring: [] });
    emitSession(slot);
    return cloneWatch(watch);
  },

  reorderWatches(serviceId: string, watchIds: string[]): DebugWatch[] | null {
    const slot = services.get(serviceId);
    if (!slot) return [];
    if (watchIds.length !== slot.watches.size) return null;

    const next = new Map<string, WatchSlot>();
    for (const watchId of watchIds) {
      const entry = slot.watches.get(watchId);
      if (!entry || next.has(watchId)) {
        return null;
      }
      next.set(watchId, entry);
    }

    slot.watches = next;
    emitSession(slot);
    return this.listWatches(serviceId);
  },

  removeWatch(serviceId: string, watchId: string): boolean {
    const slot = services.get(serviceId);
    if (!slot) return false;
    const removed = slot.watches.delete(watchId);
    if (removed) {
      emitSession(slot);
    }
    return removed;
  },

  /**
   * Push a new sample for a watch. Adapters call this when they evaluate the
   * expression; nothing is wired up yet, so this method exists for Phase 2.
   */
  pushSample(serviceId: string, watchId: string, sample: Omit<DebugSample, 'watchId' | 'valueChanged'>): void {
    const slot = services.get(serviceId);
    const entry = slot?.watches.get(watchId);
    if (!entry) return;

    const previous = entry.ring[entry.ring.length - 1];
    const valueChanged = !previous || sampleValueDiffers(previous, sample);

    const full: DebugSample = { watchId, ...sample, valueChanged };
    entry.ring.push(full);
    if (entry.ring.length > entry.watch.bufferSize) {
      entry.ring.splice(0, entry.ring.length - entry.watch.bufferSize);
    }

    const listeners = sampleListeners.get(serviceId);
    if (listeners) {
      for (const listener of listeners) {
        listener(full);
      }
    }
  },

  setAdapterState(
    serviceId: string,
    patch: { language?: DebugLanguage | null; status?: DebugAdapterStatus; message?: string | null }
  ): DebugSessionState {
    const slot = getSlot(serviceId);
    if (patch.language !== undefined) slot.language = patch.language;
    if (patch.status !== undefined) slot.status = patch.status;
    if (patch.message === null) {
      delete slot.message;
    } else if (patch.message !== undefined) {
      slot.message = patch.message;
    }
    emitSession(slot);
    return snapshotSession(slot);
  },

  /** Reset everything for a service — called when its process exits. */
  resetService(serviceId: string): void {
    const slot = services.get(serviceId);
    if (!slot) return;
    slot.watches.clear();
    slot.status = 'detached';
    slot.language = null;
    delete slot.message;
    emitSession(slot);
  },

  subscribeSession(serviceId: string, listener: SessionListener): () => void {
    let listeners = sessionListeners.get(serviceId);
    if (!listeners) {
      listeners = new Set();
      sessionListeners.set(serviceId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        sessionListeners.delete(serviceId);
      }
    };
  },

  subscribeSamples(serviceId: string, listener: SampleListener): () => void {
    let listeners = sampleListeners.get(serviceId);
    if (!listeners) {
      listeners = new Set();
      sampleListeners.set(serviceId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        sampleListeners.delete(serviceId);
      }
    };
  },
};

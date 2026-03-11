import type { ServiceMetrics, ServiceStatus } from '@dev-pagghiaro/shared';

export interface LogEntry {
  data: string;
  timestamp: number;
}

type LogListener = (entry: LogEntry) => void;
type StatusListener = (status: ServiceStatus, pid?: number) => void;
type MetricsListener = (metrics: ServiceMetrics) => void;
type ClearListener = (timestamp: number) => void;

const RING_SIZE = 500;

class RingBuffer {
  private entries: LogEntry[] = [];

  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > RING_SIZE) {
      this.entries.shift();
    }
  }

  snapshot(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

const logListeners = new Map<string, Set<LogListener>>();
const statusListeners = new Map<string, Set<StatusListener>>();
const metricsListeners = new Map<string, Set<MetricsListener>>();
const clearListeners = new Map<string, Set<ClearListener>>();
const ringBuffers = new Map<string, RingBuffer>();

function getRing(serviceId: string): RingBuffer {
  let ring = ringBuffers.get(serviceId);
  if (!ring) {
    ring = new RingBuffer();
    ringBuffers.set(serviceId, ring);
  }
  return ring;
}

export const logBus = {
  emit(serviceId: string, data: string): void {
    const entry: LogEntry = { data, timestamp: Date.now() };
    getRing(serviceId).push(entry);
    const listeners = logListeners.get(serviceId);
    if (listeners) {
      for (const listener of listeners) {
        listener(entry);
      }
    }
  },

  emitStatus(serviceId: string, status: ServiceStatus, pid?: number): void {
    const listeners = statusListeners.get(serviceId);
    if (listeners) {
      for (const listener of listeners) {
        listener(status, pid);
      }
    }
  },

  emitMetrics(serviceId: string, metrics: ServiceMetrics): void {
    const listeners = metricsListeners.get(serviceId);
    if (listeners) {
      for (const listener of listeners) {
        listener(metrics);
      }
    }
  },

  clearHistory(serviceId: string): number {
    getRing(serviceId).clear();
    const timestamp = Date.now();
    const listeners = clearListeners.get(serviceId);
    if (listeners) {
      for (const listener of listeners) {
        listener(timestamp);
      }
    }
    return timestamp;
  },

  getHistory(serviceId: string): LogEntry[] {
    return getRing(serviceId).snapshot();
  },

  subscribeLog(serviceId: string, listener: LogListener): () => void {
    let listeners = logListeners.get(serviceId);
    if (!listeners) {
      listeners = new Set();
      logListeners.set(serviceId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        logListeners.delete(serviceId);
      }
    };
  },

  subscribeStatus(serviceId: string, listener: StatusListener): () => void {
    let listeners = statusListeners.get(serviceId);
    if (!listeners) {
      listeners = new Set();
      statusListeners.set(serviceId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        statusListeners.delete(serviceId);
      }
    };
  },

  subscribeMetrics(serviceId: string, listener: MetricsListener): () => void {
    let listeners = metricsListeners.get(serviceId);
    if (!listeners) {
      listeners = new Set();
      metricsListeners.set(serviceId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        metricsListeners.delete(serviceId);
      }
    };
  },

  subscribeClear(serviceId: string, listener: ClearListener): () => void {
    let listeners = clearListeners.get(serviceId);
    if (!listeners) {
      listeners = new Set();
      clearListeners.set(serviceId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        clearListeners.delete(serviceId);
      }
    };
  },
};

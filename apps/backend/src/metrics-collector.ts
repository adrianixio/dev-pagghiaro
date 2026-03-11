/**
 * Metrics collector — polls pidusage for CPU/RAM of tracked PIDs.
 *
 * CPU is normalised by logical core count so it stays in 0-100% range.
 * Tracking is cleared when a process stops.
 */

import { cpus } from "node:os";
import pidusage from "pidusage";
import type { ServiceMetrics } from "@dev-pagghiaro/shared";
import { logBus } from "./log-bus";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2000;
const CPU_CORES = cpus().length || 1;

// ─── State ────────────────────────────────────────────────────────────────────

/** serviceId → pid */
const tracked = new Map<string, number>();
/** serviceId → latest metrics */
const latest = new Map<string, ServiceMetrics>();

let timer: ReturnType<typeof setInterval> | null = null;

// ─── Polling ──────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (tracked.size === 0) return;

  const entries = [...tracked.entries()];
  const pids = entries.map(([, pid]) => pid);

  let stats: Record<number, { cpu: number; memory: number }>;
  try {
    stats = await pidusage(pids);
  } catch {
    return;
  }

  for (const [serviceId, pid] of entries) {
    const stat = stats[pid];
    if (!stat) continue;

    const metrics: ServiceMetrics = {
      serviceId,
      cpu: Math.min(100, stat.cpu / CPU_CORES),
      memoryBytes: stat.memory,
      measuredAt: Date.now(),
    };

    latest.set(serviceId, metrics);

    // Broadcast via log bus so WebSocket handler can forward to subscribers
    logBus.emitMetrics(serviceId, metrics);
  }
}

function ensureTimer(): void {
  if (timer !== null) return;
  timer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
}

function maybeStopTimer(): void {
  if (tracked.size > 0) return;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const metricsCollector = {
  track(serviceId: string, pid: number): void {
    tracked.set(serviceId, pid);
    ensureTimer();
  },

  untrack(serviceId: string): void {
    tracked.delete(serviceId);
    latest.delete(serviceId);
    // Clear pidusage internal cache for this pid
    try {
      pidusage.clear();
    } catch { /* ignore */ }
    maybeStopTimer();
  },

  getLatest(serviceId: string): ServiceMetrics | undefined {
    return latest.get(serviceId);
  },

  getAllLatest(): ServiceMetrics[] {
    return [...latest.values()];
  },

  stopAll(): void {
    tracked.clear();
    latest.clear();
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    try { pidusage.clear(); } catch { /* ignore */ }
  },
};

/**
 * Health monitor — polls a service's HTTP endpoint to classify it up/down.
 *
 * The probe guards on `tracked.has(serviceId)` before writing `latest` so a
 * probe that resolves after `untrack` cannot repopulate cleared state.
 */

import type { ServiceHealth } from "@dev-pagghiaro/shared";

const PROBE_TIMEOUT_MS = 3000;

export function classifyProbe(
  result: { ok: true; status: number } | { ok: false; detail: string }
): ServiceHealth {
  const checkedAt = Date.now();
  if (result.ok) {
    return { state: 'up', checkedAt, statusCode: result.status };
  }
  return { state: 'down', checkedAt, detail: result.detail };
}

interface Tracked {
  timer: ReturnType<typeof setInterval>;
  port: number;
  path: string;
}

const tracked = new Map<string, Tracked>();
const latest = new Map<string, ServiceHealth>();

async function probe(serviceId: string, port: number, path: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let health: ServiceHealth;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal });
    health = classifyProbe({ ok: true, status: res.status });
  } catch (err) {
    const detail =
      err instanceof Error && err.name === 'AbortError'
        ? 'timeout'
        : err instanceof Error
          ? err.message
          : String(err);
    health = classifyProbe({ ok: false, detail });
  } finally {
    clearTimeout(timeout);
  }
  // Guard against a probe resolving after untrack: don't repopulate a cleared service.
  if (tracked.has(serviceId)) {
    latest.set(serviceId, health);
  }
}

export const healthMonitor = {
  track(serviceId: string, opts: { port: number; path: string; intervalMs: number }): void {
    if (tracked.has(serviceId)) return;
    const timer = setInterval(() => { void probe(serviceId, opts.port, opts.path); }, opts.intervalMs);
    tracked.set(serviceId, { timer, port: opts.port, path: opts.path });
    void probe(serviceId, opts.port, opts.path); // immediate first probe
  },

  untrack(serviceId: string): void {
    const entry = tracked.get(serviceId);
    if (entry) {
      clearInterval(entry.timer);
      tracked.delete(serviceId);
    }
    latest.delete(serviceId);
  },

  getHealth(serviceId: string): ServiceHealth {
    return latest.get(serviceId) ?? { state: 'unknown' };
  },
};

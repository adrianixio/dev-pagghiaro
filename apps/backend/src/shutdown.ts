/**
 * Bounded server shutdown.
 *
 * Stops metrics and every managed process tree, but never blocks forever:
 * if child termination stalls, the global timeout wins so the process can exit.
 */

import { setTimeout as delay } from "node:timers/promises";
import { metricsCollector } from "./metrics-collector";
import { processManager } from "./process-manager";

export const SHUTDOWN_TIMEOUT_MS = 8000;

export async function gracefulShutdown(
  opts: {
    stopMetrics?: () => void;
    stopAll?: () => Promise<void>;
    timeoutMs?: number;
  } = {}
): Promise<void> {
  const stopMetrics = opts.stopMetrics ?? (() => metricsCollector.stopAll());
  const stopAll = opts.stopAll ?? (() => processManager.stopAll());
  const timeoutMs = opts.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;

  stopMetrics();
  await Promise.race([stopAll(), delay(timeoutMs)]);
}

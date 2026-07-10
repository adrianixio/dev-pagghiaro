import { test, expect } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { gracefulShutdown } from "./shutdown";

test("resolves after stopAll completes normally", async () => {
  let stoppedMetrics = false;
  let stoppedAll = false;
  await gracefulShutdown({
    stopMetrics: () => {
      stoppedMetrics = true;
    },
    stopAll: async () => {
      stoppedAll = true;
    },
    timeoutMs: 5000,
  });
  expect(stoppedMetrics).toBe(true);
  expect(stoppedAll).toBe(true);
});

test("does not hang when stopAll never resolves — bounded by timeout", async () => {
  const finished = await Promise.race([
    gracefulShutdown({
      stopMetrics: () => {},
      stopAll: () => new Promise<void>(() => {}), // never resolves
      timeoutMs: 150,
    }).then(() => "shutdown-returned"),
    delay(2000).then(() => "test-timeout"),
  ]);
  expect(finished).toBe("shutdown-returned");
});

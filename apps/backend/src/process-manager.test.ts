import { test, expect } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import type { ServiceConfig } from "@dev-pagghiaro/shared";
import { processManager } from "./process-manager";
import { isPidAlive, snapshotProcessTree } from "./process-tree";

const isWin = process.platform === "win32";

function treeCommand(): string {
  return isWin ? "ping -n 300 127.0.0.1 >NUL" : "sh -c 'sleep 300; true'; true";
}

function makeService(id: string): ServiceConfig {
  return { id, name: id, command: treeCommand(), cwd: "." };
}

test("stop() kills the whole tree and reports 'stopped', not 'error'", async () => {
  const service = makeService("test-stop-tree");
  // import.meta.dir is an existing directory with no .env files → safe rootPath
  const state = await processManager.start("proj", service, import.meta.dir);
  expect(state.status).toBe("running");
  const pid = state.pid as number;

  await delay(300);
  const tree = await snapshotProcessTree(pid);

  const stopped = await processManager.stop(service.id);
  await delay(200);

  expect(stopped?.status).toBe("stopped");
  expect(processManager.getState(service.id)?.status).toBe("stopped");
  expect(isPidAlive(pid)).toBe(false);
  if (!isWin) {
    for (const descendant of tree) {
      expect(isPidAlive(descendant)).toBe(false);
    }
  }
});

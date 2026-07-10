import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { isPidAlive, snapshotProcessTree, stopProcessTree } from "./process-tree";

const isWin = process.platform === "win32";

// A shell that spawns a nested child which spawns a long-lived grandchild.
// The trailing `; true` / `& call` prevents the shell from exec-optimising
// away the intermediate process, guaranteeing a real multi-level tree.
function spawnTree(): { pid: number } {
  if (isWin) {
    const comspec = process.env["ComSpec"] ?? "cmd.exe";
    const child = spawn(comspec, ["/d", "/s", "/c", "ping -n 300 127.0.0.1 >NUL"], {
      stdio: "ignore",
    });
    if (child.pid === undefined) throw new Error("no pid");
    return { pid: child.pid };
  }
  const child = spawn("/bin/sh", ["-c", "sh -c 'sleep 300; true'; true"], {
    stdio: "ignore",
  });
  if (child.pid === undefined) throw new Error("no pid");
  return { pid: child.pid };
}

test("snapshotProcessTree includes the root pid", async () => {
  const { pid } = spawnTree();
  await delay(300); // let descendants spawn
  try {
    const tree = await snapshotProcessTree(pid);
    expect(tree).toContain(pid);
    if (!isWin) {
      // Unix enumeration must see at least one descendant (the nested sh/sleep).
      expect(tree.length).toBeGreaterThanOrEqual(2);
    }
  } finally {
    await stopProcessTree(pid, { graceMs: 0 });
  }
});

test("stopProcessTree kills the whole tree, including descendants", async () => {
  const { pid } = spawnTree();
  await delay(300);
  const tree = await snapshotProcessTree(pid);

  const ok = await stopProcessTree(pid, { graceMs: 0 });
  await delay(200);

  expect(ok).toBe(true);
  expect(isPidAlive(pid)).toBe(false);
  if (!isWin) {
    for (const descendant of tree) {
      expect(isPidAlive(descendant)).toBe(false);
    }
  }
});

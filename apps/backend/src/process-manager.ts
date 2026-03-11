/**
 * Process manager — spawns, stops, and restarts service processes.
 *
 * Each service runs inside a real PTY via the pty-adapter module.
 * Output is forwarded to the log bus; stdin input arrives from the WS route.
 * Terminal resize requests are forwarded to the PTY handle.
 */

import { join } from "node:path";
import type { ServiceConfig, ServiceState, ServiceStatus } from "@dev-pagghiaro/shared";
import { spawnPty } from "./pty-adapter";
import type { PtyHandle, PtySize } from "./pty-adapter";
import { logBus } from "./log-bus";
import { metricsCollector } from "./metrics-collector";

// ─── Internal state ───────────────────────────────────────────────────────────

interface ManagedProcess {
  pty: PtyHandle;
  serviceId: string;
  projectId: string;
  startedAt: string;
}

const processes = new Map<string, ManagedProcess>();
const states = new Map<string, ServiceState>();

// ─── State helpers ────────────────────────────────────────────────────────────

/**
 * Merge a patch into the stored ServiceState.
 * `pid: null` explicitly removes the pid field (process stopped).
 */
function setState(
  serviceId: string,
  projectId: string,
  patch: Omit<Partial<ServiceState>, "pid"> & { pid?: number | null }
): ServiceState {
  const prev: ServiceState = states.get(serviceId) ?? {
    serviceId,
    projectId,
    status: "stopped" as ServiceStatus,
  };
  const { pid, ...rest } = patch;
  const next: ServiceState = { ...prev, ...rest };
  if (pid !== null && pid !== undefined) {
    next.pid = pid;
  } else if (pid === null) {
    delete next.pid;
  }
  states.set(serviceId, next);
  return next;
}

// ─── CWD resolution ───────────────────────────────────────────────────────────

function resolveCwd(serviceCwd: string, projectRootPath: string): string {
  // Absolute path (Unix /… or Windows C:\…)
  if (serviceCwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(serviceCwd)) {
    return serviceCwd;
  }
  return join(projectRootPath, serviceCwd);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const processManager = {
  getState(serviceId: string): ServiceState | undefined {
    return states.get(serviceId);
  },

  getAllStates(): ServiceState[] {
    return [...states.values()];
  },

  async start(
    projectId: string,
    service: ServiceConfig,
    projectRootPath: string,
    initialSize?: PtySize
  ): Promise<ServiceState> {
    // Idempotent: if already running, return current state
    const existing = processes.get(service.id);
    if (existing) {
      const state = states.get(service.id);
      if (state?.status === "running") {
        return state;
      }
    }

    setState(service.id, projectId, { status: "restarting" });
    logBus.emitStatus(service.id, "restarting");

    const cwd = resolveCwd(service.cwd, projectRootPath);

    let pty: PtyHandle;
    try {
      pty = spawnPty({
        command: service.command,
        cwd,
        env: service.env,
        initialSize,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logBus.emit(service.id, `\r\n[DevPagghiaro] Failed to start: ${msg}\r\n`);
      const errState = setState(service.id, projectId, {
        status: "error",
        pid: null,
      });
      logBus.emitStatus(service.id, "error");
      return errState;
    }

    const startedAt = new Date().toISOString();
    processes.set(service.id, {
      pty,
      serviceId: service.id,
      projectId,
      startedAt,
    });

    const state = setState(service.id, projectId, {
      status: "running",
      pid: pty.pid,
      startedAt,
    });

    // Track metrics
    metricsCollector.track(service.id, pty.pid);

    // Forward PTY output to the log bus
    pty.onData((chunk) => {
      logBus.emit(service.id, chunk);
    });

    // Watch for process exit
    void pty.exited.then((code) => {
      metricsCollector.untrack(service.id);
      processes.delete(service.id);
      const exitState = setState(service.id, projectId, {
        status: code === 0 ? "stopped" : "error",
        lastExitCode: code,
        pid: null,
      });
      logBus.emit(
        service.id,
        `\r\n[DevPagghiaro] Process exited with code ${code}\r\n`
      );
      logBus.emitStatus(service.id, exitState.status);
    });

    logBus.emitStatus(service.id, "running", pty.pid);
    return state;
  },

  async stop(serviceId: string): Promise<ServiceState | undefined> {
    const managed = processes.get(serviceId);
    if (!managed) {
      return states.get(serviceId);
    }

    const { pty, projectId } = managed;

    // Mark stopped immediately so the UI updates before the process dies
    setState(serviceId, projectId, { status: "stopped" });
    logBus.emitStatus(serviceId, "stopped");

    // Graceful SIGTERM → wait up to 5 s → SIGKILL
    pty.kill();
    await Promise.race([
      pty.exited,
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
    pty.kill(9);

    metricsCollector.untrack(serviceId);
    processes.delete(serviceId);

    const state = setState(serviceId, projectId, {
      status: "stopped",
      pid: null,
    });

    logBus.emit(serviceId, "\r\n[DevPagghiaro] Process stopped.\r\n");
    return state;
  },

  async restart(
    projectId: string,
    service: ServiceConfig,
    projectRootPath: string,
    initialSize?: PtySize
  ): Promise<ServiceState> {
    await processManager.stop(service.id);
    return processManager.start(projectId, service, projectRootPath, initialSize);
  },

  /** Forward keyboard/paste input to the PTY stdin. */
  sendInput(serviceId: string, data: string): boolean {
    const managed = processes.get(serviceId);
    if (!managed) return false;
    managed.pty.write(data);
    return true;
  },

  /** Resize the terminal for a running service. */
  resize(serviceId: string, size: PtySize): boolean {
    const managed = processes.get(serviceId);
    if (!managed) return false;
    managed.pty.resize(size);
    return true;
  },

  async stopAll(): Promise<void> {
    const ids = [...processes.keys()];
    await Promise.allSettled(ids.map((id) => processManager.stop(id)));
  },
};

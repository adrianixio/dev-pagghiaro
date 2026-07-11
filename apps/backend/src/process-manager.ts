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
import { logStore } from "./log-store";
import { metricsCollector } from "./metrics-collector";
import { healthMonitor } from "./health-monitor";
import { killProcessesListeningOnPort } from "./port-processes";
import { stopProcessTree, isPidAlive } from "./process-tree";
import { buildServiceProcessContext } from "./process-context";

// ─── Internal state ───────────────────────────────────────────────────────────

interface ManagedProcess {
  pty: PtyHandle;
  serviceId: string;
  projectId: string;
  startedAt: string;
}

const processes = new Map<string, ManagedProcess>();
const states = new Map<string, ServiceState>();

// Service ids currently being stopped intentionally. The exit handler consults
// this so a kill-induced non-zero exit is reported as "stopped", not "error".
const stopping = new Set<string>();

// Last-known configured port per service, so stop() can free it as a fallback.
const servicePorts = new Map<string, number>();

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

export function resolveCwd(serviceCwd: string, projectRootPath: string): string {
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
    logStore.attach(service.id, projectId);

    // Idempotent: if already running, return current state
    const existing = processes.get(service.id);
    if (existing) {
      const state = states.get(service.id);
      if (state?.status === "running") {
        return state;
      }
    }

    stopping.delete(service.id);

    setState(service.id, projectId, { status: "restarting" });
    logBus.emitStatus(service.id, "restarting");

    const cwd = resolveCwd(service.cwd, projectRootPath);

    if (service.port != null) {
      servicePorts.set(service.id, service.port);
    } else {
      servicePorts.delete(service.id);
    }

    if (service.port != null) {
      const portCleanup = await killProcessesListeningOnPort(service.port);
      if (portCleanup.killed.length > 0) {
        logBus.emit(
          service.id,
          `\r\n[DevPagghiaro] Freed port ${service.port} by stopping PID ${portCleanup.killed.join(', ')}\r\n`
        );
      }
      if (portCleanup.failed.length > 0) {
        logBus.emit(
          service.id,
          `\r\n[DevPagghiaro] Could not stop some processes on port ${service.port}: ${portCleanup.failed
            .map(({ pid, reason }) => `${pid} (${reason})`)
            .join(', ')}\r\n`
        );
      }
    }

    let pty: PtyHandle;
    try {
      const processContext = await buildServiceProcessContext(projectRootPath, service);
      pty = spawnPty({
        command: service.command,
        cwd,
        env: processContext,
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

    if (service.healthCheck?.enabled === true && service.port != null) {
      healthMonitor.track(service.id, {
        port: service.port,
        path: service.healthCheck.path ?? "/",
        intervalMs: service.healthCheck.intervalMs ?? 10000,
      });
    }

    // Forward PTY output to the log bus
    pty.onData((chunk) => {
      logBus.emit(service.id, chunk);
    });

    // Watch for process exit
    void pty.exited.then((code) => {
      metricsCollector.untrack(service.id);
      healthMonitor.untrack(service.id);
      processes.delete(service.id);
      const intentional = stopping.has(service.id);
      const status = intentional || code === 0 ? "stopped" : "error";
      const exitState = setState(service.id, projectId, {
        status,
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

    // Flag the stop as intentional so the exit handler reports "stopped".
    stopping.add(serviceId);
    setState(serviceId, projectId, { status: "stopped" });
    logBus.emitStatus(serviceId, "stopped");

    // Graceful terminate → wait up to grace → force-kill the WHOLE tree.
    const killed = await stopProcessTree(pty.pid, {
      graceMs: 5000,
      onLog: (msg) => logBus.emit(serviceId, msg),
    });

    // Last-resort safety net: if the tree still holds a configured port, free it,
    // then re-check whether the root process is finally dead.
    let treeDead = killed;
    const port = servicePorts.get(serviceId);
    if (!treeDead && port != null) {
      const outcome = await killProcessesListeningOnPort(port);
      if (outcome.killed.length > 0) {
        logBus.emit(
          serviceId,
          `\r\n[DevPagghiaro] Freed port ${port} by stopping PID ${outcome.killed.join(", ")}\r\n`
        );
      }
      treeDead = !isPidAlive(pty.pid);
    }

    metricsCollector.untrack(serviceId);
    healthMonitor.untrack(serviceId);
    processes.delete(serviceId);

    // If the tree is still alive after force-kill AND the port fallback, report
    // "error" instead of falsely claiming the service stopped.
    const finalStatus: ServiceStatus = treeDead ? "stopped" : "error";
    if (!treeDead) {
      logBus.emit(
        serviceId,
        `\r\n[DevPagghiaro] Could not fully stop service — PID ${pty.pid} is still alive\r\n`
      );
    }

    const state = setState(serviceId, projectId, {
      status: finalStatus,
      pid: null,
    });
    logBus.emitStatus(serviceId, finalStatus);
    // Do NOT clear `stopping` here: stop() does not await pty.exited, so the
    // exit handler registered in start() (an independent path off
    // child.on('exit')) can still fire after this point. If it saw the flag
    // cleared already, a non-zero kill-induced exit code would be reported as
    // "error", violating the intentional-stop contract. The flag is instead
    // cleared at the top of the next start() call.

    logBus.emit(
      serviceId,
      treeDead
        ? "\r\n[DevPagghiaro] Process stopped.\r\n"
        : "\r\n[DevPagghiaro] Stop completed with errors.\r\n"
    );
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

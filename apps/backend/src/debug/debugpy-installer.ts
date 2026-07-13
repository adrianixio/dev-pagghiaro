/**
 * On the first time a Python service is started with debug enabled, probe the
 * target interpreter for `import debugpy`. If the import fails, kick off a
 * one-shot `python -m pip install debugpy` and stream the output into the
 * service's log panel so the user can see the install progress.
 *
 * The probe runs in the same cwd + env that the service will use so it picks
 * up the project's virtualenv, if any.
 */

import { logBus } from '../log-bus';

export interface DebugpyEnsureContext {
  serviceId: string;
  cwd: string;
  /** Service env overrides (merged on top of the inherited process env). */
  env: Record<string, string>;
}

const PROBE_TIMEOUT_MS = 5_000;
const INSTALL_TIMEOUT_MS = 90_000;

/**
 * Returns true if debugpy is importable (already installed or just installed).
 * Returns false if the install attempt failed — caller should surface an
 * unsupported/error state on the debug session.
 */
export async function ensureDebugpyInstalled(context: DebugpyEnsureContext): Promise<boolean> {
  if (await probeDebugpy(context)) return true;

  logBus.emit(
    context.serviceId,
    '\r\n[DevPagghiaro] debugpy is not installed in the target environment — installing via pip…\r\n'
  );

  const installed = await runPipInstall(context);
  if (!installed) {
    logBus.emit(
      context.serviceId,
      '\r\n[DevPagghiaro] debugpy install failed. Install it manually with `python -m pip install debugpy`.\r\n'
    );
    return false;
  }

  logBus.emit(context.serviceId, '\r\n[DevPagghiaro] debugpy installed successfully.\r\n');
  // Re-probe so a corrupted install doesn't get reported as success.
  return probeDebugpy(context);
}

async function probeDebugpy(context: DebugpyEnsureContext): Promise<boolean> {
  try {
    const proc = Bun.spawn(['python', '-c', 'import debugpy'], {
      cwd: context.cwd,
      env: { ...process.env, ...context.env },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });

    const exited = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) => setTimeout(() => resolve(-1), PROBE_TIMEOUT_MS)),
    ]);

    if (exited === -1) {
      try { proc.kill(); } catch { /* already gone */ }
      return false;
    }
    return exited === 0;
  } catch {
    // python missing entirely — let the spawn surface the real error later.
    return false;
  }
}

async function runPipInstall(context: DebugpyEnsureContext): Promise<boolean> {
  try {
    const proc = Bun.spawn(['python', '-m', 'pip', 'install', '--disable-pip-version-check', 'debugpy'], {
      cwd: context.cwd,
      env: { ...process.env, ...context.env },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    void streamToLog(proc.stdout, context.serviceId);
    void streamToLog(proc.stderr, context.serviceId);

    const exited = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) => setTimeout(() => resolve(-1), INSTALL_TIMEOUT_MS)),
    ]);

    if (exited === -1) {
      try { proc.kill(); } catch { /* already gone */ }
      logBus.emit(context.serviceId, '\r\n[DevPagghiaro] debugpy install timed out after 90s.\r\n');
      return false;
    }
    return exited === 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logBus.emit(context.serviceId, `\r\n[DevPagghiaro] debugpy install error: ${message}\r\n`);
    return false;
  }
}

async function streamToLog(stream: ReadableStream<Uint8Array> | null, serviceId: string): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value && value.length > 0) {
        // Replace bare \n with \r\n so xterm renders it cleanly alongside PTY output.
        const text = decoder.decode(value, { stream: true }).replace(/(?<!\r)\n/g, '\r\n');
        logBus.emit(serviceId, text);
      }
    }
  } catch {
    // stream errored — give up silently
  } finally {
    reader.releaseLock();
  }
}

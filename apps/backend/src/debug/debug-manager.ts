/**
 * Per-service debug session orchestrator.
 *
 * The process-manager calls into this module around the spawn boundary so we
 * can rewrite the command to enable an inspector and connect a language-
 * specific adapter once the runtime is ready.
 *
 * Node and Bun expose CDP over WebSocket: the inspector URL is logged to
 * stdout, parsed via logBus, and consumed by `CdpAdapter`. Python uses
 * debugpy's DAP listener on a TCP port we pre-allocate before spawn —
 * `DapAdapter` connects directly with retry once the child process boots.
 */

import type { DebugLanguage, ServiceConfig } from '@dev-pagghiaro/shared';
import { CdpAdapter } from './cdp-adapter';
import { DapAdapter } from './dap-adapter';
import { ensureDebugpyInstalled } from './debugpy-installer';
import { logBus } from '../log-bus';
import { allocateFreePort } from './port-allocator';
import {
  detectLanguage,
  extractInspectorUrl,
  planBunSpawn,
  planNodeSpawn,
  planPythonSpawn,
} from './runtime-detector';
import { watchRegistry } from './watch-registry';

type AttachKind =
  | { kind: 'parse-url'; language: 'node' | 'bun' }
  | { kind: 'tcp'; language: 'python'; host: string; port: number };

interface ActiveSession {
  serviceId: string;
  attach: AttachKind;
  unsubscribeLog: () => void;
  adapter?: CdpAdapter | DapAdapter;
  attachTimeout: ReturnType<typeof setTimeout>;
  resolved: boolean;
}

const sessions = new Map<string, ActiveSession>();
const pendingAttach = new Map<string, AttachKind>();
const ATTACH_TIMEOUT_MS = 15_000;

export interface DebugSpawnOverrides {
  command: string;
  env: Record<string, string>;
}

export interface DebugSpawnContext {
  /** Resolved service cwd (already includes project root resolution). */
  cwd: string;
  /** Service env overrides — merged with debug env in the returned overrides. */
  env: Record<string, string>;
}

export const debugManager = {
  async prepareSpawn(
    service: ServiceConfig,
    context: DebugSpawnContext
  ): Promise<DebugSpawnOverrides | null> {
    watchRegistry.restoreWatches(service.id, service.debugWatches ?? []);

    if (!service.debug) {
      watchRegistry.setAdapterState(service.id, {
        language: null,
        status: 'detached',
        message: null,
      });
      pendingAttach.delete(service.id);
      return null;
    }

    const language = detectLanguage(service.command);
    if (language === null) {
      watchRegistry.setAdapterState(service.id, {
        language: null,
        status: 'unsupported',
        message: `Debug runtime not supported for command: ${service.command.split(/\s+/)[0]}`,
      });
      return null;
    }

    let mutation: { command?: string; env: Record<string, string> } | null = null;
    let attach: AttachKind;

    if (language === 'node') {
      mutation = planNodeSpawn();
      attach = { kind: 'parse-url', language };
    } else if (language === 'bun') {
      mutation = planBunSpawn(service.command);
      attach = { kind: 'parse-url', language };
    } else {
      const installed = await ensureDebugpyInstalled({
        serviceId: service.id,
        cwd: context.cwd,
        env: context.env,
      });
      if (!installed) {
        watchRegistry.setAdapterState(service.id, {
          language,
          status: 'error',
          message: 'debugpy is not available in the target environment.',
        });
        return null;
      }

      const port = await allocateFreePort();
      const planned = planPythonSpawn(service.command, port);
      if (!planned) {
        watchRegistry.setAdapterState(service.id, {
          language,
          status: 'unsupported',
          message: `Cannot wrap python command: ${service.command}`,
        });
        return null;
      }
      mutation = planned;
      attach = { kind: 'tcp', language, host: '127.0.0.1', port };
    }

    pendingAttach.set(service.id, attach);
    watchRegistry.setAdapterState(service.id, {
      language,
      status: 'attaching',
      message:
        attach.kind === 'tcp'
          ? `Connecting to debugpy on ${attach.host}:${attach.port}…`
          : 'Waiting for inspector URL…',
    });

    return {
      command: mutation.command ?? service.command,
      env: mutation.env,
    };
  },

  onProcessStarted(service: ServiceConfig): void {
    if (!service.debug) return;
    const attach = pendingAttach.get(service.id);
    if (!attach) return;
    pendingAttach.delete(service.id);

    debugManager.onProcessExited(service.id);

    const session: ActiveSession = {
      serviceId: service.id,
      attach,
      unsubscribeLog: () => {},
      attachTimeout: setTimeout(() => {
        if (session.resolved) return;
        session.resolved = true;
        session.unsubscribeLog();
        watchRegistry.setAdapterState(service.id, {
          status: 'error',
          message: 'Timed out waiting for inspector',
        });
        sessions.delete(service.id);
      }, ATTACH_TIMEOUT_MS),
      resolved: false,
    };
    sessions.set(service.id, session);

    if (attach.kind === 'parse-url') {
      session.unsubscribeLog = logBus.subscribeLog(service.id, (entry) => {
        if (session.resolved) return;
        const url = extractInspectorUrl(entry.data);
        if (!url) return;

        session.resolved = true;
        session.unsubscribeLog();
        clearTimeout(session.attachTimeout);

        const adapter = new CdpAdapter(service.id, attach.language, url);
        session.adapter = adapter;
        attachAdapter(service.id, adapter);
      });
    } else {
      // Connect immediately — debugpy is in --wait-for-client and the retry
      // loop inside DapAdapter handles the brief startup gap.
      session.resolved = true;
      clearTimeout(session.attachTimeout);
      const adapter = new DapAdapter(service.id, attach.host, attach.port);
      session.adapter = adapter;
      attachAdapter(service.id, adapter);
    }
  },

  onProcessExited(serviceId: string): void {
    pendingAttach.delete(serviceId);
    const session = sessions.get(serviceId);
    if (!session) return;
    sessions.delete(serviceId);

    session.resolved = true;
    session.unsubscribeLog();
    clearTimeout(session.attachTimeout);
    session.adapter?.close('process exited');

    watchRegistry.setAdapterState(serviceId, {
      language: null,
      status: 'detached',
      message: null,
    });
  },

  getActiveAdapter(serviceId: string): CdpAdapter | DapAdapter | null {
    return sessions.get(serviceId)?.adapter ?? null;
  },
};

function attachAdapter(serviceId: string, adapter: CdpAdapter | DapAdapter): void {
  void adapter.connect().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    watchRegistry.setAdapterState(serviceId, {
      status: 'error',
      message: `Failed to attach: ${message}`,
    });
    sessions.delete(serviceId);
  });
}

// Re-export for existing imports if any (no-op type aliases).
export type { DebugLanguage };

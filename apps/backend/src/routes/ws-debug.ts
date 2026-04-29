import { Elysia } from 'elysia';
import type { DebugWsServerMessage } from '@dev-pagghiaro/shared';
import { recordingStore } from '../debug/recording-store';
import { watchRegistry } from '../debug/watch-registry';

const wsCleanup = new Map<string, Array<() => void>>();

export const wsDebugRouter = new Elysia().ws('/ws/debug/:serviceId', {
  open(ws) {
    const serviceId = ws.data.params.serviceId;

    const sessionMessage: DebugWsServerMessage = {
      type: 'session',
      payload: watchRegistry.getSession(serviceId),
    };
    ws.send(JSON.stringify(sessionMessage));

    for (const watch of watchRegistry.listWatches(serviceId)) {
      const history = watchRegistry.getHistory(serviceId, watch.id);
      if (history.length === 0) continue;
      const message: DebugWsServerMessage = {
        type: 'watch-history',
        serviceId,
        watchId: watch.id,
        samples: history,
      };
      ws.send(JSON.stringify(message));
    }

    const unsubscribeSession = watchRegistry.subscribeSession(serviceId, (state) => {
      const message: DebugWsServerMessage = { type: 'session', payload: state };
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // closed
      }
    });

    const unsubscribeSamples = watchRegistry.subscribeSamples(serviceId, (sample) => {
      const message: DebugWsServerMessage = { type: 'sample', payload: sample };
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // closed
      }
    });

    const unsubscribeRecStarted = recordingStore.subscribeStarted(serviceId, (summary) => {
      const message: DebugWsServerMessage = { type: 'recording-started', payload: summary };
      try { ws.send(JSON.stringify(message)); } catch { /* closed */ }
    });
    const unsubscribeRecStopped = recordingStore.subscribeStopped(serviceId, (summary) => {
      const message: DebugWsServerMessage = { type: 'recording-stopped', payload: summary };
      try { ws.send(JSON.stringify(message)); } catch { /* closed */ }
    });
    const unsubscribeRecRemoved = recordingStore.subscribeRemoved(serviceId, (recordingId) => {
      const message: DebugWsServerMessage = { type: 'recording-removed', serviceId, recordingId };
      try { ws.send(JSON.stringify(message)); } catch { /* closed */ }
    });

    wsCleanup.set(ws.id, [
      unsubscribeSession,
      unsubscribeSamples,
      unsubscribeRecStarted,
      unsubscribeRecStopped,
      unsubscribeRecRemoved,
    ]);
  },

  message() {
    // No client-driven messages in Phase 1; CRUD goes through REST.
  },

  close(ws) {
    const cleanups = wsCleanup.get(ws.id);
    if (cleanups) {
      for (const cleanup of cleanups) {
        cleanup();
      }
      wsCleanup.delete(ws.id);
    }
  },
});

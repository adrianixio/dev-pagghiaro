import { Elysia } from 'elysia';
import type { WsClientMessage, WsServerMessage } from '@dev-pagghiaro/shared';
import { logBus } from '../log-bus';
import { processManager } from '../process-manager';

const wsCleanup = new Map<string, Array<() => void>>();

export const wsLogsRouter = new Elysia().ws('/ws/logs/:serviceId', {
  open(ws) {
    const serviceId = ws.data.params.serviceId;

    for (const entry of logBus.getHistory(serviceId)) {
      const message: WsServerMessage = {
        type: 'log',
        serviceId,
        data: entry.data,
        timestamp: entry.timestamp,
      };
      ws.send(JSON.stringify(message));
    }

    const state = processManager.getState(serviceId);
    if (state) {
      const message: WsServerMessage =
        state.pid !== undefined
          ? { type: 'status', serviceId, status: state.status, pid: state.pid }
          : { type: 'status', serviceId, status: state.status };
      ws.send(JSON.stringify(message));
    }

    const unsubscribeLog = logBus.subscribeLog(serviceId, (entry) => {
      const message: WsServerMessage = {
        type: 'log',
        serviceId,
        data: entry.data,
        timestamp: entry.timestamp,
      };
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // closed
      }
    });

    const unsubscribeStatus = logBus.subscribeStatus(serviceId, (status, pid) => {
      const message: WsServerMessage =
        pid !== undefined
          ? { type: 'status', serviceId, status, pid }
          : { type: 'status', serviceId, status };
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // closed
      }
    });

    const unsubscribeMetrics = logBus.subscribeMetrics(serviceId, (metrics) => {
      const message: WsServerMessage = { type: 'metrics', payload: metrics };
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // closed
      }
    });

    const unsubscribeClear = logBus.subscribeClear(serviceId, (timestamp) => {
      const message: WsServerMessage = { type: 'cleared', serviceId, timestamp };
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // closed
      }
    });

    wsCleanup.set(ws.id, [unsubscribeLog, unsubscribeStatus, unsubscribeMetrics, unsubscribeClear]);
  },

  message(ws, rawMessage) {
    let message: WsClientMessage;
    try {
      const text =
        typeof rawMessage === 'string'
          ? rawMessage
          : new TextDecoder().decode(rawMessage as ArrayBuffer);
      message = JSON.parse(text) as WsClientMessage;
    } catch {
      return;
    }

    const serviceId = ws.data.params.serviceId;
    switch (message.type) {
      case 'input':
        processManager.sendInput(serviceId, message.data);
        break;
      case 'resize':
        processManager.resize(serviceId, {
          cols: message.cols,
          rows: message.rows,
        });
        break;
      case 'clear':
        logBus.clearHistory(serviceId);
        break;
      case 'subscribe':
      case 'unsubscribe':
        break;
    }
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

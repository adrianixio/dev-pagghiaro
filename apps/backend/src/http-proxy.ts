import { randomUUID } from 'node:crypto';
import type { HttpExchange, HttpRequestRecord, HttpResponseRecord } from '@dev-pagghiaro/shared';
import { captureBody, stripHopByHop, toHeaderRecords } from './http-body';
import { httpCaptureStore } from './http-capture-store';

interface WsData { targetWsUrl: string; target?: WebSocket; queue: Array<string | Uint8Array>; }

const running = new Map<string, { server: ReturnType<typeof Bun.serve>; proxyPort: number }>();

async function handleHttp(serviceId: string, targetPort: number, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname + url.search;
  const startedAt = Date.now();

  const reqBytes = req.body ? new Uint8Array(await req.arrayBuffer()) : new Uint8Array(0);
  const reqBody = captureBody(req.headers.get('content-type'), reqBytes);
  const request: HttpRequestRecord = {
    method: req.method,
    path,
    headers: toHeaderRecords(req.headers),
    ...(reqBody ? { body: reqBody } : {}),
  };
  const exchange: HttpExchange = { id: randomUUID(), serviceId, source: 'proxy', startedAt, request };

  try {
    const res = await fetch(`http://127.0.0.1:${targetPort}${path}`, {
      method: req.method,
      headers: stripHopByHop(req.headers),
      ...(reqBytes.length > 0 ? { body: reqBytes } : {}),
      redirect: 'manual',
    });
    const resBytes = new Uint8Array(await res.arrayBuffer());
    const resBody = captureBody(res.headers.get('content-type'), resBytes);
    const response: HttpResponseRecord = {
      status: res.status,
      headers: toHeaderRecords(res.headers),
      durationMs: Date.now() - startedAt,
      ...(resBody ? { body: resBody } : {}),
    };
    exchange.response = response;
    httpCaptureStore.add(exchange);
    return new Response(resBytes.length > 0 ? resBytes : null, {
      status: res.status,
      headers: stripHopByHop(res.headers),
    });
  } catch (err) {
    exchange.error = err instanceof Error ? err.message : String(err);
    httpCaptureStore.add(exchange);
    return new Response(`[DevPagghiaro proxy] forward failed: ${exchange.error}`, { status: 502 });
  }
}

export const proxyManager = {
  start(serviceId: string, opts: { proxyPort: number; targetPort: number }): void {
    if (running.has(serviceId)) return;
    const { proxyPort, targetPort } = opts;
    try {
      const server = Bun.serve<WsData>({
        port: proxyPort,
        fetch(req, srv) {
          if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            const u = new URL(req.url);
            const targetWsUrl = `ws://127.0.0.1:${targetPort}${u.pathname}${u.search}`;
            if (srv.upgrade(req, { data: { targetWsUrl, queue: [] } })) return undefined;
            return new Response('upgrade failed', { status: 426 });
          }
          return handleHttp(serviceId, targetPort, req);
        },
        websocket: {
          open(ws) {
            const target = new WebSocket(ws.data.targetWsUrl);
            ws.data.target = target;
            target.addEventListener('open', () => {
              for (const m of ws.data.queue) target.send(m);
              ws.data.queue = [];
            });
            target.addEventListener('message', (e) => { try { ws.send(e.data as string); } catch { /* closed */ } });
            target.addEventListener('close', () => { try { ws.close(); } catch { /* closed */ } });
            target.addEventListener('error', () => { try { ws.close(); } catch { /* closed */ } });
          },
          message(ws, message) {
            const t = ws.data.target;
            if (t && t.readyState === WebSocket.OPEN) t.send(message as string);
            else ws.data.queue.push(message as string | Uint8Array);
          },
          close(ws) {
            try { ws.data.target?.close(); } catch { /* closed */ }
          },
        },
      });
      running.set(serviceId, { server, proxyPort });
    } catch (err) {
      console.error(`[DevPagghiaro] Could not start HTTP proxy on port ${proxyPort}: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  stop(serviceId: string): void {
    const entry = running.get(serviceId);
    if (entry) {
      try { entry.server.stop(true); } catch { /* already stopped */ }
      running.delete(serviceId);
    }
  },

  getProxyPort(serviceId: string): number | undefined {
    return running.get(serviceId)?.proxyPort;
  },
};

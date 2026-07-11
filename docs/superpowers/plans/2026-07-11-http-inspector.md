# HTTP Inspector Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an in-app HTTP inspector to DevPagghiaro: a per-service reverse proxy that captures real HTTP traffic, plus a request console (mini-Postman), both feeding one capture store surfaced in an inspector panel.

**Architecture:** A per-service ring store of `HttpExchange` records. A `proxyManager` (lifecycle like `healthMonitor`) opens a Bun.serve reverse proxy per opted-in service, forwards HTTP to `127.0.0.1:<port>`, captures req/resp (with body caps), and bridges WebSocket uncaptured. `sendConsoleRequest` issues user-composed requests to the service directly. REST routes expose list/send/clear; the frontend renders exchanges + a console form.

**Tech Stack:** Backend Bun + Elysia, tests `bun:test`. Frontend Angular 18 standalone + signals, native `fetch`, Jasmine/Karma.

## Global Constraints

- **Do NOT modify `apps/backend/src/log-bus.ts`**; no terminal-WS protocol change. The exchange list is polled via REST.
- Proxy scope: **HTTP-only**; WebSocket/upgrade is **bridged transparently but NOT recorded**; **no HTTPS/TLS**; no streaming/SSE (bodies are buffered).
- Proxy runs only when `service.httpInspect?.enabled === true && service.port != null`. Proxy port = `httpInspect.proxyPort ?? service.port + 10000`.
- **Body cap 64 KB** (`HTTP_BODY_CAP_BYTES`), textual bodies captured as text (truncated beyond cap), binary bodies not captured (marked). **Ring 200 exchanges/service.**
- Console sends **directly** to `127.0.0.1:<port>` (independent of the proxy).
- Request/response bodies MUST be read once into a buffer and reused for both capture and forward/return (streams consume once).
- A single request failure must never crash the proxy `Bun.serve` (per-request try/catch); `proxyManager.start` must not throw on a port collision (log + skip).
- Frontend icon: `arrow-left-right` (register `ArrowLeftRight` in `app.config.ts`).

---

### Task 1: Shared types

**Files:** Modify `packages/shared/src/models.ts`.
**Interfaces produced:** `HttpExchangeSource`, `HttpHeader`, `HttpCapturedBody`, `HttpRequestRecord`, `HttpResponseRecord`, `HttpExchange`, `HttpInspectConfig`; adds `ServiceConfig.httpInspect?`.

- [ ] **Step 1: Add `httpInspect` to `ServiceConfig`** (after `healthCheck?`):
```ts
  httpInspect?: HttpInspectConfig;
```

- [ ] **Step 2: Append the new types at the end of `models.ts`:**
```ts
export type HttpExchangeSource = 'proxy' | 'console';

export interface HttpHeader { name: string; value: string; }

export interface HttpCapturedBody {
  text?: string;
  truncated?: boolean;
  binary?: boolean;
  byteLength?: number;
}

export interface HttpRequestRecord {
  method: string;
  path: string;
  headers: HttpHeader[];
  body?: HttpCapturedBody;
}

export interface HttpResponseRecord {
  status: number;
  headers: HttpHeader[];
  body?: HttpCapturedBody;
  durationMs: number;
}

export interface HttpExchange {
  id: string;
  serviceId: string;
  source: HttpExchangeSource;
  startedAt: number;
  request: HttpRequestRecord;
  response?: HttpResponseRecord;
  error?: string;
}

export interface HttpInspectConfig {
  enabled?: boolean;
  proxyPort?: number;
}
```

- [ ] **Step 3:** `cd apps/backend && bun run build` → OK.
- [ ] **Step 4:** Commit `feat(shared): add HTTP inspector types` (append `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` to every commit in this plan).

---

### Task 2: HTTP body/header primitives (pure)

**Files:** Create `apps/backend/src/http-body.ts`; Test `apps/backend/src/http-body.test.ts`.
**Interfaces produced:** `HTTP_BODY_CAP_BYTES`; `isTextualContentType(ct)`; `captureBody(ct, bytes): HttpCapturedBody | undefined`; `toHeaderRecords(headers: Headers): HttpHeader[]`; `stripHopByHop(headers: Headers): Headers`.

- [ ] **Step 1: Write the failing test:**
```ts
// apps/backend/src/http-body.test.ts
import { test, expect } from 'bun:test';
import { captureBody, isTextualContentType, stripHopByHop, toHeaderRecords, HTTP_BODY_CAP_BYTES } from './http-body';

test('empty body → undefined', () => {
  expect(captureBody('application/json', new Uint8Array(0))).toBeUndefined();
});

test('json body captured as text with byteLength', () => {
  const bytes = new TextEncoder().encode('{"a":1}');
  const b = captureBody('application/json; charset=utf-8', bytes);
  expect(b).toEqual({ text: '{"a":1}', byteLength: 7 });
});

test('oversized text body is truncated', () => {
  const bytes = new TextEncoder().encode('x'.repeat(HTTP_BODY_CAP_BYTES + 100));
  const b = captureBody('text/plain', bytes)!;
  expect(b.truncated).toBe(true);
  expect(b.byteLength).toBe(HTTP_BODY_CAP_BYTES + 100);
  expect(b.text!.length).toBe(HTTP_BODY_CAP_BYTES);
});

test('binary content-type not captured, only marked', () => {
  const bytes = new Uint8Array([0, 1, 2, 3]);
  expect(captureBody('image/png', bytes)).toEqual({ binary: true, byteLength: 4 });
});

test('isTextualContentType', () => {
  expect(isTextualContentType('application/json')).toBe(true);
  expect(isTextualContentType('text/html; charset=utf-8')).toBe(true);
  expect(isTextualContentType('image/png')).toBe(false);
  expect(isTextualContentType(null)).toBe(false);
});

test('stripHopByHop removes connection/transfer-encoding/upgrade, keeps others', () => {
  const h = new Headers({ 'connection': 'keep-alive', 'transfer-encoding': 'chunked', 'upgrade': 'h2c', 'x-keep': 'yes' });
  const out = stripHopByHop(h);
  expect(out.get('connection')).toBeNull();
  expect(out.get('transfer-encoding')).toBeNull();
  expect(out.get('upgrade')).toBeNull();
  expect(out.get('x-keep')).toBe('yes');
});

test('toHeaderRecords lists header pairs', () => {
  const recs = toHeaderRecords(new Headers({ 'x-a': '1', 'x-b': '2' }));
  expect(recs).toContainEqual({ name: 'x-a', value: '1' });
  expect(recs).toContainEqual({ name: 'x-b', value: '2' });
});
```

- [ ] **Step 2:** `cd apps/backend && bun test http-body` → RED (module missing).

- [ ] **Step 3: Implement:**
```ts
// apps/backend/src/http-body.ts
import type { HttpCapturedBody, HttpHeader } from '@dev-pagghiaro/shared';

export const HTTP_BODY_CAP_BYTES = 64 * 1024;

const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql)|application\/[a-z0-9.+-]*\+(json|xml))$/i;

export function isTextualContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const essence = contentType.split(';')[0]!.trim().toLowerCase();
  return TEXTUAL.test(essence);
}

export function captureBody(contentType: string | null, bytes: Uint8Array): HttpCapturedBody | undefined {
  if (bytes.length === 0) return undefined;
  const byteLength = bytes.length;
  if (!isTextualContentType(contentType)) {
    return { binary: true, byteLength };
  }
  const truncated = byteLength > HTTP_BODY_CAP_BYTES;
  const slice = truncated ? bytes.subarray(0, HTTP_BODY_CAP_BYTES) : bytes;
  const text = new TextDecoder().decode(slice);
  return { text, byteLength, ...(truncated ? { truncated: true } : {}) };
}

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

export function stripHopByHop(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const h of HOP_BY_HOP) out.delete(h);
  return out;
}

export function toHeaderRecords(headers: Headers): HttpHeader[] {
  const out: HttpHeader[] = [];
  headers.forEach((value, name) => out.push({ name, value }));
  return out;
}
```

- [ ] **Step 4:** `cd apps/backend && bun test http-body` → GREEN; then `bun test`.
- [ ] **Step 5:** Commit `feat(backend): add HTTP body/header capture primitives`.

---

### Task 3: HTTP capture store (ring)

**Files:** Create `apps/backend/src/http-capture-store.ts`; Test `apps/backend/src/http-capture-store.test.ts`.
**Interfaces produced:** `httpCaptureStore.add/query/clear/reset`; `HTTP_CAPTURE_MAX`.

- [ ] **Step 1: Write the failing test:**
```ts
// apps/backend/src/http-capture-store.test.ts
import { test, expect, beforeEach } from 'bun:test';
import { httpCaptureStore, HTTP_CAPTURE_MAX } from './http-capture-store';
import type { HttpExchange } from '@dev-pagghiaro/shared';

beforeEach(() => httpCaptureStore.reset());

function ex(serviceId: string, id: string): HttpExchange {
  return { id, serviceId, source: 'proxy', startedAt: 1, request: { method: 'GET', path: '/', headers: [] } };
}

test('add + query returns exchanges in insertion order', () => {
  httpCaptureStore.add(ex('s1', 'a'));
  httpCaptureStore.add(ex('s1', 'b'));
  expect(httpCaptureStore.query('s1').map((e) => e.id)).toEqual(['a', 'b']);
});

test('ring caps at HTTP_CAPTURE_MAX, dropping oldest', () => {
  for (let i = 0; i < HTTP_CAPTURE_MAX + 5; i++) httpCaptureStore.add(ex('s1', String(i)));
  const q = httpCaptureStore.query('s1');
  expect(q.length).toBe(HTTP_CAPTURE_MAX);
  expect(q[0]!.id).toBe('5'); // first 5 dropped
});

test('query isolates by service; clear empties one', () => {
  httpCaptureStore.add(ex('s1', 'a'));
  httpCaptureStore.add(ex('s2', 'b'));
  httpCaptureStore.clear('s1');
  expect(httpCaptureStore.query('s1')).toEqual([]);
  expect(httpCaptureStore.query('s2').map((e) => e.id)).toEqual(['b']);
});
```

- [ ] **Step 2:** `cd apps/backend && bun test http-capture-store` → RED.

- [ ] **Step 3: Implement:**
```ts
// apps/backend/src/http-capture-store.ts
import type { HttpExchange } from '@dev-pagghiaro/shared';

export const HTTP_CAPTURE_MAX = 200;

const byService = new Map<string, HttpExchange[]>();

export const httpCaptureStore = {
  add(exchange: HttpExchange): void {
    const arr = byService.get(exchange.serviceId) ?? [];
    arr.push(exchange);
    if (arr.length > HTTP_CAPTURE_MAX) arr.shift();
    byService.set(exchange.serviceId, arr);
  },
  query(serviceId: string): HttpExchange[] {
    return [...(byService.get(serviceId) ?? [])];
  },
  clear(serviceId: string): void {
    byService.delete(serviceId);
  },
  reset(): void {
    byService.clear();
  },
};
```

- [ ] **Step 4:** `cd apps/backend && bun test http-capture-store` → GREEN; then `bun test`.
- [ ] **Step 5:** Commit `feat(backend): add HTTP capture ring store`.

---

### Task 4: Reverse proxy manager

**Files:** Create `apps/backend/src/http-proxy.ts`; Test `apps/backend/src/http-proxy.test.ts`.
**Interfaces produced:** `proxyManager.start(serviceId, {proxyPort, targetPort})`, `proxyManager.stop(serviceId)`, `proxyManager.getProxyPort(serviceId)`.
**Consumes:** `captureBody`/`stripHopByHop`/`toHeaderRecords` (Task 2), `httpCaptureStore` (Task 3), `HttpExchange`/records (Task 1).

- [ ] **Step 1: Write the failing test** (real target server through the proxy):
```ts
// apps/backend/src/http-proxy.test.ts
import { test, expect, beforeEach } from 'bun:test';
import { proxyManager } from './http-proxy';
import { httpCaptureStore } from './http-capture-store';

beforeEach(() => httpCaptureStore.reset());

function freePort(): number {
  const tmp = Bun.serve({ port: 0, fetch: () => new Response('') });
  const p = tmp.port;
  tmp.stop(true);
  return p;
}

test('forwards HTTP and captures the exchange, then stop frees the port', async () => {
  const target = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === 'POST') return new Response(`echo:${await req.text()}`, { status: 201 });
      return Response.json({ ok: true });
    },
  });
  const proxyPort = freePort();
  proxyManager.start('s1', { proxyPort, targetPort: target.port });
  try {
    const get = await fetch(`http://127.0.0.1:${proxyPort}/hello`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ ok: true });

    const post = await fetch(`http://127.0.0.1:${proxyPort}/x`, {
      method: 'POST', body: 'hi', headers: { 'content-type': 'text/plain' },
    });
    expect(post.status).toBe(201);
    expect(await post.text()).toBe('echo:hi');

    const captured = httpCaptureStore.query('s1');
    expect(captured.length).toBe(2);
    const postEx = captured.find((e) => e.request.method === 'POST')!;
    expect(postEx.response?.status).toBe(201);
    expect(postEx.request.body?.text).toBe('hi');
    expect(postEx.source).toBe('proxy');
  } finally {
    proxyManager.stop('s1');
    target.stop(true);
  }
});

test('start is idempotent', () => {
  const proxyPort = freePort();
  const targetPort = freePort();
  proxyManager.start('s2', { proxyPort, targetPort });
  proxyManager.start('s2', { proxyPort, targetPort }); // no throw, no second server
  expect(proxyManager.getProxyPort('s2')).toBe(proxyPort);
  proxyManager.stop('s2');
});
```

- [ ] **Step 2:** `cd apps/backend && bun test http-proxy` → RED.

- [ ] **Step 3: Implement:**
```ts
// apps/backend/src/http-proxy.ts
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
      const server = Bun.serve<WsData, {}>({
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
```
> **Implementer note:** the `Bun.serve<WsData, {}>` generic and `ws.data`/`server.upgrade` typings can be finicky. Adjust ONLY the types to make it compile (e.g. the generic parameters, casting `message`), without changing the forwarding/capture behavior. The HTTP-forwarding path is the load-bearing part the test covers; if the WS bridge cannot be made to compile/work in Bun's current API, keep the HTTP path fully working and report DONE_WITH_CONCERNS describing the WS limitation rather than breaking the build.

- [ ] **Step 4:** `cd apps/backend && bun test http-proxy` → GREEN; then `bun test`.
- [ ] **Step 5:** Commit `feat(backend): add reverse proxy manager with HTTP capture + WS bridge`.

---

### Task 5: Request console

**Files:** Create `apps/backend/src/http-console.ts`; Test `apps/backend/src/http-console.test.ts`.
**Interfaces produced:** `sendConsoleRequest(serviceId, targetPort, input): Promise<HttpExchange>`.
**Consumes:** Task 2 primitives, Task 3 store.

- [ ] **Step 1: Write the failing test:**
```ts
// apps/backend/src/http-console.test.ts
import { test, expect, beforeEach } from 'bun:test';
import { sendConsoleRequest } from './http-console';
import { httpCaptureStore } from './http-capture-store';

beforeEach(() => httpCaptureStore.reset());

test('sends a request and records the exchange', async () => {
  const target = Bun.serve({ port: 0, fetch: () => Response.json({ hi: true }, { status: 202 }) });
  try {
    const ex = await sendConsoleRequest('s1', target.port, { method: 'GET', path: '/ping', headers: [] });
    expect(ex.source).toBe('console');
    expect(ex.response?.status).toBe(202);
    expect(ex.request.path).toBe('/ping');
    expect(httpCaptureStore.query('s1').length).toBe(1);
  } finally {
    target.stop(true);
  }
});

test('records an error when the target is unreachable', async () => {
  const ex = await sendConsoleRequest('s2', 1, { method: 'GET', path: '/', headers: [] }); // port 1 → refused
  expect(ex.error).toBeDefined();
  expect(ex.response).toBeUndefined();
  expect(httpCaptureStore.query('s2').length).toBe(1);
});
```

- [ ] **Step 2:** `cd apps/backend && bun test http-console` → RED.

- [ ] **Step 3: Implement:**
```ts
// apps/backend/src/http-console.ts
import { randomUUID } from 'node:crypto';
import type { HttpExchange, HttpHeader, HttpRequestRecord } from '@dev-pagghiaro/shared';
import { captureBody, toHeaderRecords } from './http-body';
import { httpCaptureStore } from './http-capture-store';

export async function sendConsoleRequest(
  serviceId: string,
  targetPort: number,
  input: { method: string; path: string; headers: HttpHeader[]; body?: string },
): Promise<HttpExchange> {
  const path = input.path.startsWith('/') ? input.path : `/${input.path}`;
  const startedAt = Date.now();

  const headers = new Headers();
  for (const h of input.headers) headers.set(h.name, h.value);
  const reqBytes = input.body != null && input.body.length > 0 ? new TextEncoder().encode(input.body) : new Uint8Array(0);
  const reqBody = captureBody(headers.get('content-type'), reqBytes);
  const request: HttpRequestRecord = {
    method: input.method,
    path,
    headers: input.headers,
    ...(reqBody ? { body: reqBody } : {}),
  };
  const exchange: HttpExchange = { id: randomUUID(), serviceId, source: 'console', startedAt, request };

  try {
    const res = await fetch(`http://127.0.0.1:${targetPort}${path}`, {
      method: input.method,
      headers,
      ...(reqBytes.length > 0 ? { body: reqBytes } : {}),
      redirect: 'manual',
    });
    const resBytes = new Uint8Array(await res.arrayBuffer());
    const resBody = captureBody(res.headers.get('content-type'), resBytes);
    exchange.response = {
      status: res.status,
      headers: toHeaderRecords(res.headers),
      durationMs: Date.now() - startedAt,
      ...(resBody ? { body: resBody } : {}),
    };
  } catch (err) {
    exchange.error = err instanceof Error ? err.message : String(err);
  }

  httpCaptureStore.add(exchange);
  return exchange;
}
```

- [ ] **Step 4:** `cd apps/backend && bun test http-console` → GREEN; then `bun test`.
- [ ] **Step 5:** Commit `feat(backend): add HTTP request console`.

---

### Task 6: HTTP inspect routes + register

**Files:** Create `apps/backend/src/routes/http-inspect.ts`; Test `apps/backend/src/routes/http-inspect.test.ts`; Modify `apps/backend/src/index.ts`.
**Interfaces produced:** `httpInspectRouter`.
**Consumes:** `getProject` (config-store), `httpCaptureStore` (Task 3), `sendConsoleRequest` (Task 5).

- [ ] **Step 1: Write the failing test:**
```ts
// apps/backend/src/routes/http-inspect.test.ts
import { test, expect } from 'bun:test';
import { httpInspectRouter } from './http-inspect';

test('GET /http returns 404 for unknown project', async () => {
  const res = await httpInspectRouter.handle(
    new Request('http://localhost/api/projects/nope-xyz/services/s1/http'),
  );
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2:** `cd apps/backend && bun test routes/http-inspect` → RED.

- [ ] **Step 3: Implement:**
```ts
// apps/backend/src/routes/http-inspect.ts
import { Elysia, t } from 'elysia';
import type { HttpHeader } from '@dev-pagghiaro/shared';
import { getProject } from '../config-store';
import { httpCaptureStore } from '../http-capture-store';
import { sendConsoleRequest } from '../http-console';

const BASE = '/api/projects/:projectId/services/:serviceId/http';

const SendSchema = t.Object({
  method: t.String({ minLength: 1 }),
  path: t.String({ minLength: 1 }),
  headers: t.Optional(t.Array(t.Object({ name: t.String(), value: t.String() }))),
  body: t.Optional(t.String()),
});

async function findService(projectId: string, serviceId: string) {
  const project = await getProject(projectId);
  if (!project) return { error: 'project' as const };
  const service = project.services.find((s) => s.id === serviceId);
  if (!service) return { error: 'service' as const };
  return { project, service };
}

export const httpInspectRouter = new Elysia()
  .get(BASE, async ({ params, set }) => {
    const found = await findService(params.projectId, params.serviceId);
    if ('error' in found) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: `${found.error} not found` };
    }
    return httpCaptureStore.query(params.serviceId);
  })
  .delete(BASE, async ({ params, set }) => {
    const found = await findService(params.projectId, params.serviceId);
    if ('error' in found) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: `${found.error} not found` };
    }
    httpCaptureStore.clear(params.serviceId);
    set.status = 204;
    return null;
  })
  .post(`${BASE}/send`, async ({ params, body, set }) => {
    const found = await findService(params.projectId, params.serviceId);
    if ('error' in found) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: `${found.error} not found` };
    }
    if (found.service.port == null) {
      set.status = 400;
      return { error: 'BAD_REQUEST', message: 'Service has no configured port' };
    }
    const payload = body as { method: string; path: string; headers?: HttpHeader[]; body?: string };
    return sendConsoleRequest(params.serviceId, found.service.port, {
      method: payload.method,
      path: payload.path,
      headers: payload.headers ?? [],
      ...(payload.body !== undefined ? { body: payload.body } : {}),
    });
  }, { body: SendSchema });
```

- [ ] **Step 4: Register in `index.ts`** — import `httpInspectRouter` and add `.use(httpInspectRouter)` after `.use(introspectionRouter)`.

- [ ] **Step 5:** `cd apps/backend && bun test routes/http-inspect` → GREEN; then `bun test`.
- [ ] **Step 6:** Commit `feat(backend): add HTTP inspect routes`.

---

### Task 7: Accept `httpInspect` config

**Files:** Modify `apps/backend/src/config-store.ts`, `apps/backend/src/routes/services.ts`; Test extend `apps/backend/src/config-store.test.ts`.

- [ ] **Step 1: Add failing test** to `config-store.test.ts`:
```ts
import { isServiceConfig } from './config-store';
// (base already defined in the file from Phase 2; if not, use: const base = { id:'s', name:'S', command:'true', cwd:'.' };)

test('accepts a valid httpInspect and rejects a malformed one', () => {
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', httpInspect: { enabled: true, proxyPort: 13000 } })).toBe(true);
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', httpInspect: {} })).toBe(true);
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', httpInspect: { enabled: 'x' } })).toBe(false);
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', httpInspect: { proxyPort: -1 } })).toBe(false);
});
```

- [ ] **Step 2:** `cd apps/backend && bun test config-store` → RED.

- [ ] **Step 3: Implement.** In `config-store.ts` add above `isServiceConfig`:
```ts
function isHttpInspectConfig(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    (c['enabled'] === undefined || typeof c['enabled'] === 'boolean') &&
    (c['proxyPort'] === undefined ||
      (typeof c['proxyPort'] === 'number' && Number.isFinite(c['proxyPort']) && c['proxyPort'] >= 0))
  );
}
```
Add to the `isServiceConfig` `&&` chain:
```ts
    && isHttpInspectConfig((candidate as { httpInspect?: unknown }).httpInspect)
```
In `routes/services.ts`, add to BOTH `CreateServiceSchema` and `UpdateServiceSchema`:
```ts
  httpInspect: t.Optional(
    t.Object({ enabled: t.Optional(t.Boolean()), proxyPort: t.Optional(t.Number({ minimum: 0 })) })
  ),
```
And in the POST create handler service literal:
```ts
        ...(payload.httpInspect !== undefined ? { httpInspect: payload.httpInspect } : {}),
```

- [ ] **Step 4:** `cd apps/backend && bun test config-store` → GREEN; then `bun test`.
- [ ] **Step 5:** Commit `feat(backend): accept and validate httpInspect config`.

---

### Task 8: Wire proxy lifecycle into the process manager

**Files:** Modify `apps/backend/src/process-manager.ts`.

- [ ] **Step 1:** Import at top:
```ts
import { proxyManager } from "./http-proxy";
```

- [ ] **Step 2:** In `start()`, immediately after the `healthMonitor.track(...)` block, add:
```ts
    if (service.httpInspect?.enabled === true && service.port != null) {
      proxyManager.start(service.id, {
        proxyPort: service.httpInspect.proxyPort ?? service.port + 10000,
        targetPort: service.port,
      });
    }
```

- [ ] **Step 3:** In `stop()`, next to `healthMonitor.untrack(serviceId);`, add `proxyManager.stop(serviceId);`. In the `pty.exited` handler, next to `healthMonitor.untrack(service.id)`, add `proxyManager.stop(service.id);`.

- [ ] **Step 4: Verify** — `cd apps/backend && bun test` → full suite green. Then a runtime smoke test:
  - Create `.superpowers/sdd/smoke-http.json` config with one project whose service runs a tiny HTTP server on a known port with `httpInspect.enabled=true`, OR simpler: start the backend and confirm it boots without error (`PAGGHIARO_PORT=3998 bun run apps/backend/src/index.ts` briefly, curl `/health` → ok, kill). The proxy only starts when a service with httpInspect starts, so full E2E is manual; confirm no boot regression. If you cannot run a server here, report DONE_WITH_CONCERNS.

- [ ] **Step 5:** Commit `feat(backend): start/stop HTTP proxy across service lifecycle`.

---

### Task 9: Frontend inspector service + UiService open/close

**Files:** Create `frontend/src/app/services/http-inspector.service.ts`; Modify `frontend/src/app/services/ui.service.ts`.
**Interfaces produced:** `HttpInspectorService.fetchExchanges/send/clear`; `UiService.httpInspectTarget`/`openHttpInspect`/`closeHttpInspect`.

- [ ] **Step 1: Create the service:**
```ts
// frontend/src/app/services/http-inspector.service.ts
import { Injectable } from '@angular/core';
import type { HttpExchange, HttpHeader } from '@dev-pagghiaro/shared';

const API_BASE = '/api';

export interface ConsoleRequestInput { method: string; path: string; headers: HttpHeader[]; body?: string; }

@Injectable({ providedIn: 'root' })
export class HttpInspectorService {
  async fetchExchanges(projectId: string, serviceId: string): Promise<HttpExchange[]> {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/http`);
      if (!res.ok) return [];
      return (await res.json()) as HttpExchange[];
    } catch { return []; }
  }

  async send(projectId: string, serviceId: string, input: ConsoleRequestInput): Promise<HttpExchange | null> {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/http/send`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      return (await res.json()) as HttpExchange;
    } catch { return null; }
  }

  async clear(projectId: string, serviceId: string): Promise<void> {
    try { await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/http`, { method: 'DELETE' }); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 2: Extend `UiService`** (mirror `introspectTarget`):
```ts
  private readonly httpInspectTargetSignal = signal<{ projectId: string; serviceId: string } | null>(null);
  readonly httpInspectTarget = this.httpInspectTargetSignal.asReadonly();
```
```ts
  openHttpInspect(projectId: string, serviceId: string): void { this.httpInspectTargetSignal.set({ projectId, serviceId }); }
  closeHttpInspect(): void { this.httpInspectTargetSignal.set(null); }
```

- [ ] **Step 3:** `cd frontend && bun run build` → PASS.
- [ ] **Step 4:** Commit `feat(frontend): add HTTP inspector service and UiService open/close`.

---

### Task 10: Inspector panel + shell render + icon

**Files:** Create `frontend/src/app/http/http-inspector-panel.component.ts`; Modify `frontend/src/app/layout/app-shell.component.ts`, `frontend/src/app/app.config.ts`.

- [ ] **Step 1: Register the icon.** In `app.config.ts`, add `ArrowLeftRight` to the lucide import list and to `LucideAngularModule.pick({...})` (alphabetical, near `ArrowRight`).

- [ ] **Step 2: Create the panel** (functional, minimal; polling stopped in `ngOnDestroy` like the logs panel):
```ts
// frontend/src/app/http/http-inspector-panel.component.ts
import { Component, OnDestroy, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { HttpExchange } from '@dev-pagghiaro/shared';
import { HttpInspectorService } from '../services/http-inspector.service';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-http-inspector-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="fixed inset-0 z-50 flex bg-black/60" (click)="ui.closeHttpInspect()">
      <div class="m-auto flex h-[85vh] w-[92vw] max-w-6xl flex-col rounded-lg bg-white shadow-xl dark:bg-neutral-900" (click)="$event.stopPropagation()">
        <!-- Console -->
        <div class="flex flex-wrap items-center gap-2 border-b p-3 dark:border-neutral-700">
          <select class="rounded border px-2 py-1 text-sm dark:bg-neutral-800" [(ngModel)]="method">
            <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
          </select>
          <input class="min-w-40 flex-1 rounded border px-2 py-1 text-sm dark:bg-neutral-800" placeholder="/api/path" [(ngModel)]="path" />
          <button class="rounded border px-3 py-1 text-sm" (click)="send()" [disabled]="sending()">Send</button>
          <button class="rounded border px-2 py-1 text-sm" (click)="clear()">Clear</button>
          <button class="ml-auto rounded border px-2 py-1 text-sm" (click)="ui.closeHttpInspect()">Close</button>
        </div>
        @if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
          <textarea class="border-b p-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800" rows="3" placeholder="request body" [(ngModel)]="reqBody"></textarea>
        }
        <div class="flex min-h-0 flex-1">
          <!-- List -->
          <div class="w-1/2 overflow-auto border-r font-mono text-xs dark:border-neutral-700">
            @for (ex of exchanges(); track ex.id) {
              <button class="flex w-full items-center gap-2 border-b px-2 py-1 text-left hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800" (click)="selected.set(ex)">
                <span class="w-12 shrink-0">{{ ex.request.method }}</span>
                <span [class]="statusClass(ex)">{{ ex.response?.status ?? (ex.error ? 'ERR' : '…') }}</span>
                <span class="truncate">{{ ex.request.path }}</span>
                <span class="ml-auto opacity-60">{{ ex.source === 'console' ? '⌨' : '' }}{{ ex.response?.durationMs != null ? ex.response.durationMs + 'ms' : '' }}</span>
              </button>
            }
            @if (exchanges().length === 0) { <div class="p-4 text-center opacity-60">No exchanges</div> }
          </div>
          <!-- Detail -->
          <div class="w-1/2 overflow-auto p-2 font-mono text-xs">
            @if (selected(); as ex) {
              <div class="mb-1 font-bold">{{ ex.request.method }} {{ ex.request.path }}</div>
              @if (ex.error) { <div class="text-red-600">error: {{ ex.error }}</div> }
              <div class="mt-2 font-bold">Request headers</div>
              @for (h of ex.request.headers; track h.name) { <div>{{ h.name }}: {{ h.value }}</div> }
              @if (ex.request.body?.text) { <div class="mt-1 whitespace-pre-wrap break-all">{{ ex.request.body!.text }}</div> }
              @if (ex.response; as r) {
                <div class="mt-2 font-bold">Response {{ r.status }} ({{ r.durationMs }}ms)</div>
                @for (h of r.headers; track h.name) { <div>{{ h.name }}: {{ h.value }}</div> }
                @if (r.body?.binary) { <div class="opacity-60">[binary, {{ r.body!.byteLength }} bytes]</div> }
                @if (r.body?.text) { <div class="mt-1 whitespace-pre-wrap break-all">{{ r.body!.text }}@if (r.body!.truncated) { <span class="opacity-60"> …[truncated]</span> }</div> }
              }
            } @else { <div class="p-4 text-center opacity-60">Select an exchange</div> }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class HttpInspectorPanelComponent implements OnDestroy {
  readonly ui = inject(UiService);
  private readonly service = inject(HttpInspectorService);

  method = 'GET';
  path = '/';
  reqBody = '';

  private readonly exchangesSignal = signal<HttpExchange[]>([]);
  readonly exchanges = this.exchangesSignal.asReadonly();
  readonly selected = signal<HttpExchange | null>(null);
  readonly sending = signal(false);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      if (this.ui.httpInspectTarget()) {
        void this.refresh();
        this.timer ??= setInterval(() => void this.refresh(), 1500);
      } else if (this.timer) {
        clearInterval(this.timer); this.timer = null;
      }
    });
  }

  ngOnDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private target() { return this.ui.httpInspectTarget(); }

  async refresh(): Promise<void> {
    const t = this.target();
    if (!t) return;
    this.exchangesSignal.set(await this.service.fetchExchanges(t.projectId, t.serviceId));
  }

  async send(): Promise<void> {
    const t = this.target();
    if (!t) return;
    this.sending.set(true);
    try {
      const headers = (this.method === 'POST' || this.method === 'PUT' || this.method === 'PATCH') && this.reqBody
        ? [{ name: 'content-type', value: 'application/json' }] : [];
      await this.service.send(t.projectId, t.serviceId, { method: this.method, path: this.path, headers, ...(this.reqBody ? { body: this.reqBody } : {}) });
      await this.refresh();
    } finally { this.sending.set(false); }
  }

  async clear(): Promise<void> {
    const t = this.target();
    if (!t) return;
    await this.service.clear(t.projectId, t.serviceId);
    this.selected.set(null);
    await this.refresh();
  }

  statusClass(ex: HttpExchange): string {
    const s = ex.response?.status;
    if (ex.error || (s && s >= 500)) return 'w-10 shrink-0 text-red-600';
    if (s && s >= 400) return 'w-10 shrink-0 text-yellow-600';
    if (s && s >= 200 && s < 300) return 'w-10 shrink-0 text-green-600';
    return 'w-10 shrink-0 opacity-60';
  }
}
```
> **Implementer note:** if any Angular 18 template/type detail fails to build, fix minimally to compile and note it; the load-bearing parts are the console send, the exchange list, the detail view, and polling stopped in `ngOnDestroy`.

- [ ] **Step 3: Render in `app-shell.component.ts`** — import `HttpInspectorPanelComponent`, add to `imports`, and add near the other panels: `@if (ui.httpInspectTarget()) { <app-http-inspector-panel /> }`.

- [ ] **Step 4:** `cd frontend && bun run build` → PASS; `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless` → green.
- [ ] **Step 5:** Commit `feat(frontend): add HTTP inspector panel`.

---

### Task 11: Service-row button + list wiring

**Files:** Modify `frontend/src/app/dashboard/service-row.component.ts`, `frontend/src/app/dashboard/service-list.component.ts`.

- [ ] **Step 1:** In `service-row.component.ts` template action group, add after the inspect button:
```html
          <ui-icon-button icon="arrow-left-right" label="HTTP inspector" tone="info" (click)="httpInspect.emit()"></ui-icon-button>
```
Add the output to the class: `@Output() httpInspect = new EventEmitter<void>();`

- [ ] **Step 2:** In `service-list.component.ts`, add to the `<app-service-row>` bindings:
```html
            (httpInspect)="ui.openHttpInspect(project.id, service.id)"
```
(`ui` is already public from Phase 2.)

- [ ] **Step 3:** `cd frontend && bun run build` → PASS; existing tests green (update `service-row.component.spec.ts` only if the added output/icon breaks it — the spec's test module registers icons locally, so add `ArrowLeftRight` to its `LucideAngularModule.pick(...)` if the row now renders it).
- [ ] **Step 4:** Commit `feat(frontend): add HTTP inspector button to service row`.

---

### Task 12: Palette "HTTP inspector" command

**Files:** Modify `frontend/src/app/services/command-registry.ts` (+ `.spec.ts`), `frontend/src/app/layout/app-shell.component.ts`.

- [ ] **Step 1: Update spec (RED)** — add `httpInspect: () => {},` to the test `deps` and assert:
```ts
    expect(cmds.some((c) => c.id === 'http:s1')).toBeTrue();
```

- [ ] **Step 2:** `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless` → RED.

- [ ] **Step 3: Implement.** In `command-registry.ts` add to `CommandDeps`:
```ts
  httpInspect: (projectId: string, serviceId: string) => void;
```
In the per-service loop add:
```ts
        { id: `http:${s.id}`, title: `HTTP inspector: ${s.name}`, icon: 'arrow-left-right', action: () => d.httpInspect(active.id, s.id) },
```
In `app-shell.component.ts`'s `buildCommands({...})`:
```ts
        httpInspect: (p, s) => this.ui.openHttpInspect(p, s),
```

- [ ] **Step 4:** tests GREEN; `cd frontend && bun run build` PASS.
- [ ] **Step 5:** Commit `feat(frontend): add HTTP inspector palette command`.

---

### Task 13: Edit `httpInspect` in the config form

**Files:** Modify `frontend/src/app/models/config-form.model.ts`, `frontend/src/app/components/config-form/config-form.component.ts`, `frontend/src/app/services/project.service.ts`.

- [ ] **Step 1:** Add to `EditableServiceDraft`:
```ts
  httpInspectEnabled: boolean;
  httpInspectProxyPort: number | null;
```

- [ ] **Step 2:** At EVERY `EditableServiceDraft` construction site (per Phase 2 there were two: the constructor load-path and `addService()`; grep to confirm) populate the fields — existing service → `service.httpInspect?.enabled ?? false`, `service.httpInspect?.proxyPort ?? null`; blank row → `false`, `null`.

- [ ] **Step 3:** Add 2 minimal controls per service row in the form template (following the existing per-field markup + the healthCheck controls added in Phase 2): an "HTTP inspect" enable checkbox and, when enabled, a proxy-port number input, with `[(ngModel)]` + unique `name` (`'http-en-'+draftKey`, `'http-port-'+draftKey`).

- [ ] **Step 4:** In `saveProjectDraft` (project.service.ts), add to BOTH update and create payloads:
```ts
          httpInspect: {
            enabled: service.httpInspectEnabled,
            ...(service.httpInspectProxyPort != null ? { proxyPort: Math.max(0, Math.floor(service.httpInspectProxyPort)) } : {}),
          },
```

- [ ] **Step 5:** `cd frontend && bun run build` → PASS; `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless` → green.
  If draft construction diverges from the assumed shape, STOP and report DONE_WITH_CONCERNS.
- [ ] **Step 6:** Commit `feat(frontend): edit httpInspect in the config form`.

---

## Self-Review

**Spec coverage:** shared types (T1); body/header primitives (T2); capture store (T3); reverse proxy HTTP+WS-bridge (T4); console (T5); routes (T6); config accept (T7); lifecycle wiring (T8); FE service + UiService (T9); panel (T10); row button + list (T11); palette command (T12); config-form editing (T13). Proxy HTTP-only / WS-uncaptured / no-HTTPS, body cap 64KB, ring 200, console-direct, opt-in-per-service, buffer-read-once — all constrained in Global Constraints and reflected in T2/T4/T5/T8.

**Placeholder scan:** backend tasks carry full test + impl code; frontend panel/service carry complete code; config-form (T13) gives exact model + saveProjectDraft code and describes the template controls to match the existing (Phase 2) healthCheck pattern, with a STOP-and-report escape. Two implementer-notes (T4 WS-bridge typing, T10 template) grant minimal-fix latitude without changing behavior.

**Type consistency:** `HttpExchange`/`HttpHeader`/`HttpCapturedBody`/records/`HttpInspectConfig` defined in T1, consumed unchanged in T2-T13; `captureBody`/`stripHopByHop`/`toHeaderRecords` (T2) used by T4/T5; `httpCaptureStore` (T3) by T4/T5/T6; `proxyManager` (T4) by T8; `sendConsoleRequest` (T5) by T6; `HttpInspectorService`/`openHttpInspect`/`httpInspect` dep consistent across T9-T13.

**Ordering:** backend leaves T2/T3 → T4/T5 → T6 → T7/T8; frontend T9 → T10 → T11/T12/T13. Execute in numeric order.

**Known risk:** T4 WS bridge is the fragile part; the task test covers the HTTP path deterministically and the implementer-note permits reporting a WS limitation rather than breaking the build. The unauthenticated/CORS-* security posture is unchanged and already user-accepted (see the spec's security note).

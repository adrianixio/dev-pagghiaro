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

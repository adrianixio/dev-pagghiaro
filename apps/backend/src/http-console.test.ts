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

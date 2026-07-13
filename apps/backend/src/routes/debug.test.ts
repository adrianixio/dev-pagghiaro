import { test, expect } from 'bun:test';
import { debugRouter } from './debug';

test('GET .../debug/watches returns 404 for unknown service', async () => {
  const res = await debugRouter.handle(
    new Request('http://localhost/api/services/does-not-exist-xyz/debug/watches'),
  );
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: string; message: string };
  expect(body.error).toBe('NOT_FOUND');
});

test('POST .../debug/watches reaches the router (not the SPA fallback) for an unknown service', async () => {
  const res = await debugRouter.handle(
    new Request('http://localhost/api/services/does-not-exist-xyz/debug/watches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expr: 'x' }),
    }),
  );
  // The SPA catch-all in index.ts also answers unmatched /api/* with a 404,
  // but with message 'Route not found'. This router's own 404 body carries
  // 'Service not found' - proving the request was handled by debugRouter's
  // getServiceContext() lookup, not the app-level fallback.
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: string; message: string };
  expect(body.error).toBe('NOT_FOUND');
  expect(body.message).toBe('Service not found');
});

test('GET .../debug/recordings returns 404 for unknown service', async () => {
  const res = await debugRouter.handle(
    new Request('http://localhost/api/services/does-not-exist-xyz/debug/recordings'),
  );
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: string; message: string };
  expect(body.error).toBe('NOT_FOUND');
  expect(body.message).toBe('Service not found');
});

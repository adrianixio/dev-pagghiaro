import { test, expect } from 'bun:test';
import { findListeningPids } from './port-processes';

test('findListeningPids is read-only: a listener survives the query', async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response('ok') });
  const port = server.port;
  try {
    const pids = await findListeningPids(port);
    expect(Array.isArray(pids)).toBe(true);
    // The server must still be listening — the query must not kill it.
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
  } finally {
    server.stop(true);
  }
});

test('findListeningPids returns an array for a likely-free port', async () => {
  const pids = await findListeningPids(59677);
  expect(Array.isArray(pids)).toBe(true);
});

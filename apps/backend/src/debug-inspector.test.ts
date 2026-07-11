import { test, expect } from 'bun:test';
import { fetchInspectorWsUrl } from './debug-inspector';

test('returns the first target webSocketDebuggerUrl', async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === '/json/list') {
        return Response.json([{ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/abc' }]);
      }
      return new Response('nope', { status: 404 });
    },
  });
  try {
    expect(await fetchInspectorWsUrl(server.port)).toBe('ws://127.0.0.1:9229/abc');
  } finally {
    server.stop(true);
  }
});

test('returns null on empty list', async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json([]) });
  try {
    expect(await fetchInspectorWsUrl(server.port)).toBeNull();
  } finally {
    server.stop(true);
  }
});

test('returns null when unreachable', async () => {
  expect(await fetchInspectorWsUrl(1)).toBeNull();
});

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

test('delivers a gzip-compressed target response intact', async () => {
  const target = Bun.serve({
    port: 0,
    fetch: () => new Response(Bun.gzipSync(new TextEncoder().encode('hello world')), {
      headers: { 'content-encoding': 'gzip', 'content-type': 'text/plain' },
    }),
  });
  const proxyPort = freePort();
  proxyManager.start('gz', { proxyPort, targetPort: target.port });
  try {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    expect(await res.text()).toBe('hello world'); // would be garbage if content-encoding were forwarded
  } finally {
    proxyManager.stop('gz');
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

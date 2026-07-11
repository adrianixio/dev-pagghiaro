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

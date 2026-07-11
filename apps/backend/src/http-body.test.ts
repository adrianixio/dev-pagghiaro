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

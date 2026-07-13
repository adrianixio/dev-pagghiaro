import { test, expect } from 'bun:test';
import { logsRouter, buildLogQuery } from './logs';

test('returns 400 on invalid regex (before touching config)', async () => {
  const res = await logsRouter.handle(
    new Request('http://localhost/api/projects/none/logs?q=%5B&regex=true'),
  );
  expect(res.status).toBe(400);
});

test('returns 404 for unknown project', async () => {
  const res = await logsRouter.handle(
    new Request('http://localhost/api/projects/does-not-exist-xyz/logs'),
  );
  expect(res.status).toBe(404);
});

test('buildLogQuery: services comma-split with trimming', () => {
  const result = buildLogQuery({ useRegex: false, services: 'a, b ,c' }, ['x']);
  expect(result.serviceIds).toEqual(['a', 'b', 'c']);
});

test('buildLogQuery: defaults to all services when services omitted', () => {
  const result = buildLogQuery({ useRegex: false }, ['x', 'y']);
  expect(result.serviceIds).toEqual(['x', 'y']);
});

test('buildLogQuery: valid limit is kept', () => {
  const result = buildLogQuery({ useRegex: false, limit: '50' }, ['x']);
  expect(result.limit).toBe(50);
});

test('buildLogQuery: invalid limit is dropped', () => {
  const result = buildLogQuery({ useRegex: false, limit: 'abc' }, ['x']);
  expect(result.limit).toBeUndefined();
});

test('buildLogQuery: zero/negative limit is dropped', () => {
  const zero = buildLogQuery({ useRegex: false, limit: '0' }, ['x']);
  expect(zero.limit).toBeUndefined();

  const negative = buildLogQuery({ useRegex: false, limit: '-5' }, ['x']);
  expect(negative.limit).toBeUndefined();
});

test('buildLogQuery: invalid since is dropped, valid since is kept', () => {
  const invalid = buildLogQuery({ useRegex: false, since: 'abc' }, ['x']);
  expect(invalid.since).toBeUndefined();

  const valid = buildLogQuery({ useRegex: false, since: '123' }, ['x']);
  expect(valid.since).toBe(123);
});

test('buildLogQuery: regex flag passthrough', () => {
  const result = buildLogQuery({ useRegex: true }, ['x']);
  expect(result.regex).toBe(true);
});

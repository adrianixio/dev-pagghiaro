import { test, expect } from 'bun:test';
import { httpInspectRouter } from './http-inspect';

test('GET /http returns 404 for unknown project', async () => {
  const res = await httpInspectRouter.handle(
    new Request('http://localhost/api/projects/nope-xyz/services/s1/http'),
  );
  expect(res.status).toBe(404);
});

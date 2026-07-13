import { test, expect } from 'bun:test';
import { debugRouter } from './debug';

test('GET /debug returns 404 for unknown project', async () => {
  const res = await debugRouter.handle(
    new Request('http://localhost/api/projects/nope-xyz/services/s1/debug'),
  );
  expect(res.status).toBe(404);
});

test('break-in returns 404 for unknown project', async () => {
  const res = await debugRouter.handle(
    new Request('http://localhost/api/projects/nope-xyz/services/s1/debug/break-in', { method: 'POST' }),
  );
  expect(res.status).toBe(404);
});

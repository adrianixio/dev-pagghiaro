import { test, expect } from 'bun:test';
import { logsRouter } from './logs';

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

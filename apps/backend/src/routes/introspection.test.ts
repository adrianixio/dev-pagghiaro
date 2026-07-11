import { test, expect } from 'bun:test';
import { introspectionRouter } from './introspection';

test('returns 404 for an unknown project', async () => {
  const res = await introspectionRouter.handle(
    new Request('http://localhost/api/projects/nope-xyz/services/s1/introspect'),
  );
  expect(res.status).toBe(404);
});

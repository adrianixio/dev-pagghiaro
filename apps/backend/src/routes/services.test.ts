import { test, expect } from 'bun:test';
import { servicesRouter } from './services';

test('GET .../state includes a health field', async () => {
  const res = await servicesRouter.handle(
    new Request('http://localhost/api/projects/p1/services/never-started/state'),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { status: string; health: { state: string } };
  expect(body.status).toBe('stopped');
  expect(body.health.state).toBe('unknown');
});

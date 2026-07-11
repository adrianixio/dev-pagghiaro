// apps/backend/src/service-introspection.test.ts
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServiceIntrospection } from './service-introspection';
import type { ProjectConfig, ServiceConfig } from '@dev-pagghiaro/shared';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pagghiaro-intro-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function project(service: ServiceConfig): ProjectConfig {
  return { id: 'p1', name: 'P', rootPath: root, services: [service], createdAt: '2026-01-01T00:00:00.000Z' };
}

test('composes cwd(existence), expanded command, env, null port, unknown health', async () => {
  await Bun.write(join(root, '.env'), 'FOO=bar\n');
  const service: ServiceConfig = { id: 's1', name: 'api', command: 'echo hi', cwd: '.' };

  const intro = await buildServiceIntrospection(project(service), service);

  expect(intro.serviceId).toBe('s1');
  expect(intro.cwd.exists).toBe(true);
  expect(intro.command.raw).toBe('echo hi');
  expect(intro.command.argv[intro.command.argv.length - 1]).toBe('echo hi');
  expect(intro.env.find((v) => v.key === 'FOO')?.value).toBe('bar');
  expect(intro.port).toBeNull();
  expect(intro.runtime.status).toBe('stopped'); // never started
  expect(intro.health.state).toBe('unknown');
});

test('flags a non-existent cwd', async () => {
  const service: ServiceConfig = { id: 's2', name: 'api', command: 'true', cwd: 'does-not-exist' };
  const intro = await buildServiceIntrospection(project(service), service);
  expect(intro.cwd.exists).toBe(false);
});

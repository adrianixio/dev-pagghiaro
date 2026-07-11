import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeServiceEnv } from './process-context';
import type { ServiceConfig } from '@dev-pagghiaro/shared';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pagghiaro-env-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function svc(env?: Record<string, string>): ServiceConfig {
  return { id: 's', name: 'S', command: 'true', cwd: '.', ...(env ? { env } : {}) };
}

test('reports winning source and shadowed layers in precedence order', async () => {
  await Bun.write(join(root, '.env'), 'FOO=from-env\nBAR=bar1\n');
  await Bun.write(join(root, '.env.local'), 'FOO=from-local\n');

  const result = await describeServiceEnv(root, svc({ FOO: 'from-service' }));
  const foo = result.find((v) => v.key === 'FOO');
  const bar = result.find((v) => v.key === 'BAR');

  expect(foo).toBeDefined();
  expect(foo!.value).toBe('from-service');
  expect(foo!.source).toBe('service.env');
  expect(foo!.shadowed).toEqual([
    { source: 'project/.env', value: 'from-env' },
    { source: 'project/.env.local', value: 'from-local' },
  ]);

  expect(bar!.value).toBe('bar1');
  expect(bar!.source).toBe('project/.env');
  expect(bar!.shadowed).toEqual([]);
});

test('returns empty array when no env sources exist', async () => {
  const result = await describeServiceEnv(root, svc());
  expect(result).toEqual([]);
});

import { describe, expect, it } from 'bun:test';
import { detectLanguage, planNodeSpawn } from './runtime-detector';

describe('detectLanguage', () => {
  it('detects direct Node TypeScript runners as node debug targets', () => {
    expect(detectLanguage('tsx src/server.ts')).toBe('node');
    expect(detectLanguage('ts-node src/server.ts')).toBe('node');
    expect(detectLanguage('ts-node-esm src/server.ts')).toBe('node');
  });

  it('detects Windows package manager shims as node debug targets', () => {
    expect(detectLanguage('npm.cmd run dev')).toBe('node');
    expect(detectLanguage('pnpm.cmd dev')).toBe('node');
    expect(detectLanguage('yarn.cmd dev')).toBe('node');
  });
});

describe('planNodeSpawn', () => {
  it('injects inspect argv for direct node servers', () => {
    expect(planNodeSpawn('node src/server.js')).toEqual({
      command: 'node --inspect=127.0.0.1:0 src/server.js',
      env: {},
    });
  });

  it('injects inspect argv for tsx TypeScript servers', () => {
    expect(planNodeSpawn('tsx watch src/server.ts')).toEqual({
      command: 'tsx --inspect=127.0.0.1:0 watch src/server.ts',
      env: {},
    });
  });

  it('normalizes ts-node CommonJS servers through node register hook', () => {
    expect(planNodeSpawn('ts-node src/server.ts --port 3000')).toEqual({
      command: 'node -r ts-node/register --inspect=127.0.0.1:0 src/server.ts --port 3000',
      env: {},
    });
  });

  it('normalizes ts-node ESM servers through node loader hook', () => {
    expect(planNodeSpawn('ts-node --esm src/server.ts')).toEqual({
      command: 'node --loader ts-node/esm --inspect=127.0.0.1:0 src/server.ts',
      env: {},
    });
  });

  it('falls back to scoped NODE_OPTIONS for package manager wrappers', () => {
    expect(planNodeSpawn('pnpm dev')).toEqual({
      env: { NODE_OPTIONS: '--inspect=127.0.0.1:0' },
    });
  });

  it('preserves existing NODE_OPTIONS when wrapper fallback needs inspect', () => {
    expect(planNodeSpawn('npm run dev', { NODE_OPTIONS: '--enable-source-maps' })).toEqual({
      env: { NODE_OPTIONS: '--inspect=127.0.0.1:0 --enable-source-maps' },
    });
  });

  it('does not duplicate existing inspect configuration', () => {
    expect(planNodeSpawn('node --inspect=127.0.0.1:9229 src/server.js')).toEqual({
      command: 'node --inspect=127.0.0.1:9229 src/server.js',
      env: {},
    });
    expect(planNodeSpawn('npm run dev', { NODE_OPTIONS: '--inspect=127.0.0.1:9229' })).toEqual({
      command: 'npm run dev',
      env: {},
    });
  });
});

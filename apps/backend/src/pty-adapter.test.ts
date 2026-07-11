import { test, expect } from 'bun:test';
import { resolveShellArgs } from './pty-adapter';

test('resolveShellArgs puts the raw command last and wraps it in a shell', () => {
  const argv = resolveShellArgs('echo hi');
  expect(argv[argv.length - 1]).toBe('echo hi');
  if (process.platform === 'win32') {
    expect(argv).toContain('/c');
    expect(argv[0].length).toBeGreaterThan(0);
  } else {
    expect(argv[0]).toBe('/bin/sh');
    expect(argv[1]).toBe('-c');
  }
});

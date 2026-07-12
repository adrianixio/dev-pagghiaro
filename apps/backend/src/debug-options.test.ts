import { test, expect } from 'bun:test';
import { buildDebugNodeOptions, DEBUG_DEFAULT_PORT } from './debug-options';

test('DEBUG_DEFAULT_PORT is 9229', () => {
  expect(DEBUG_DEFAULT_PORT).toBe(9229);
});

test('produces the inspect flag when no existing options', () => {
  expect(buildDebugNodeOptions(undefined, 9229)).toBe('--inspect=127.0.0.1:9229');
  expect(buildDebugNodeOptions('   ', 9229)).toBe('--inspect=127.0.0.1:9229');
});

test('appends to existing NODE_OPTIONS without clobbering', () => {
  expect(buildDebugNodeOptions('--max-old-space-size=256', 9230)).toBe('--max-old-space-size=256 --inspect=127.0.0.1:9230');
});

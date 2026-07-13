import { describe, expect, it } from 'bun:test';
import { shouldSkipDirectTsNodeRewriteForPlatform } from './debug-manager';

describe('shouldSkipDirectTsNodeRewriteForPlatform', () => {
  it('skips direct ts-node rewrite on Windows', () => {
    expect(shouldSkipDirectTsNodeRewriteForPlatform('win32')).toBe(true);
  });

  it('preserves direct ts-node rewrite on non-Windows platforms', () => {
    expect(shouldSkipDirectTsNodeRewriteForPlatform('linux')).toBe(false);
    expect(shouldSkipDirectTsNodeRewriteForPlatform('darwin')).toBe(false);
  });
});

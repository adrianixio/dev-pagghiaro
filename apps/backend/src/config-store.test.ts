import { test, expect } from 'bun:test';
import { isServiceConfig } from './config-store';

const base = { id: 's', name: 'S', command: 'true', cwd: '.' };

test('accepts a service with a valid healthCheck', () => {
  expect(isServiceConfig({ ...base, healthCheck: { enabled: true, path: '/health', intervalMs: 5000 } })).toBe(true);
  expect(isServiceConfig({ ...base, healthCheck: {} })).toBe(true);
  expect(isServiceConfig(base)).toBe(true); // healthCheck optional
});

test('rejects a malformed healthCheck', () => {
  expect(isServiceConfig({ ...base, healthCheck: { enabled: 'yes' } })).toBe(false);
  expect(isServiceConfig({ ...base, healthCheck: { intervalMs: -1 } })).toBe(false);
  expect(isServiceConfig({ ...base, healthCheck: 'nope' })).toBe(false);
});

test('accepts a valid httpInspect and rejects a malformed one', () => {
  expect(isServiceConfig({ ...base, httpInspect: { enabled: true, proxyPort: 13000 } })).toBe(true);
  expect(isServiceConfig({ ...base, httpInspect: {} })).toBe(true);
  expect(isServiceConfig(base)).toBe(true); // httpInspect optional
  expect(isServiceConfig({ ...base, httpInspect: { enabled: 'x' } })).toBe(false);
  expect(isServiceConfig({ ...base, httpInspect: { proxyPort: -1 } })).toBe(false);
});

test('accepts a valid debug config and rejects a malformed one', () => {
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', debug: { enabled: true, port: 9229 } })).toBe(true);
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', debug: {} })).toBe(true);
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', debug: { enabled: 1 } })).toBe(false);
  expect(isServiceConfig({ id: 's', name: 'S', command: 'true', cwd: '.', debug: { port: -1 } })).toBe(false);
});

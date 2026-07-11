import { test, expect } from 'bun:test';
import { classifyProbe, healthMonitor } from './health-monitor';

test('classifyProbe maps an HTTP response to up with the status code', () => {
  const h = classifyProbe({ ok: true, status: 404 });
  expect(h.state).toBe('up');
  expect(h.statusCode).toBe(404);
  expect(typeof h.checkedAt).toBe('number');
});

test('classifyProbe maps a failure to down with detail', () => {
  const h = classifyProbe({ ok: false, detail: 'ECONNREFUSED' });
  expect(h.state).toBe('down');
  expect(h.detail).toBe('ECONNREFUSED');
});

test('getHealth is unknown for an untracked service', () => {
  expect(healthMonitor.getHealth('never-tracked').state).toBe('unknown');
});

test('track is idempotent and untrack resets to unknown', () => {
  healthMonitor.track('svc-x', { port: 59677, path: '/', intervalMs: 600000 });
  healthMonitor.track('svc-x', { port: 59677, path: '/', intervalMs: 600000 }); // no duplicate timer, no throw
  healthMonitor.untrack('svc-x');
  expect(healthMonitor.getHealth('svc-x').state).toBe('unknown');
});

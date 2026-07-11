import { test, expect } from 'bun:test';
import { createSeverityClassifier, SEVERITY_RANK } from './log-severity';

test('info by default', () => {
  const c = createSeverityClassifier();
  expect(c.classify('Listening on port 3000')).toEqual({ severity: 'info', continuesEvent: false });
});

test('warnings detected', () => {
  const c = createSeverityClassifier();
  expect(c.classify('warning: deprecated API')).toEqual({ severity: 'warn', continuesEvent: false });
});

test('JS error header opens a stack, at-frames continue it', () => {
  const c = createSeverityClassifier();
  expect(c.classify('Error: boom')).toEqual({ severity: 'error', continuesEvent: false });
  expect(c.classify('    at foo (a.js:1:1)')).toEqual({ severity: 'error', continuesEvent: true });
});

test('Python traceback groups until the error line', () => {
  const c = createSeverityClassifier();
  expect(c.classify('Traceback (most recent call last):')).toEqual({ severity: 'error', continuesEvent: false });
  expect(c.classify('  File "x.py", line 2, in <module>')).toEqual({ severity: 'error', continuesEvent: true });
  expect(c.classify('ValueError: bad')).toEqual({ severity: 'error', continuesEvent: false });
});

test('bare Exception header is classified as error', () => {
  const c = createSeverityClassifier();
  expect(c.classify('Exception: kaboom')).toEqual({ severity: 'error', continuesEvent: false });
});

test('bare Error header still opens a JS stack', () => {
  const c = createSeverityClassifier();
  expect(c.classify('Error: bare')).toEqual({ severity: 'error', continuesEvent: false });
  expect(c.classify('    at x (a.js:1:1)')).toEqual({ severity: 'error', continuesEvent: true });
});

test('mid-message "error:" mention does not reopen the stack', () => {
  const c = createSeverityClassifier();
  expect(c.classify('Retry failed, error: timeout')).toEqual({ severity: 'error', continuesEvent: false });
  expect(c.classify('    some indented detail')).toEqual({ severity: 'info', continuesEvent: false });
});

test('severity rank ordering', () => {
  expect(SEVERITY_RANK.info).toBeLessThan(SEVERITY_RANK.warn);
  expect(SEVERITY_RANK.warn).toBeLessThan(SEVERITY_RANK.error);
});

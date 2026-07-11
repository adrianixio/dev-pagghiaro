import { test, expect, beforeEach } from 'bun:test';
import { logBus } from './log-bus';
import { logStore } from './log-store';

beforeEach(() => {
  logStore.reset();
});

test('ingests bus chunks as structured lines', () => {
  logStore.attach('s1', 'p1');
  logBus.emit('s1', 'hello world\n');
  const lines = logStore.query({ serviceIds: ['s1'] });
  expect(lines.length).toBe(1);
  expect(lines[0]!.text).toBe('hello world');
  expect(lines[0]!.severity).toBe('info');
  expect(lines[0]!.kind).toBe('log');
});

test('filters by severity threshold', () => {
  logStore.attach('s1', 'p1');
  logBus.emit('s1', 'starting up\nError: boom\n');
  const errors = logStore.query({ serviceIds: ['s1'], severity: 'error' });
  expect(errors.length).toBe(1);
  expect(errors[0]!.text).toBe('Error: boom');
});

test('substring query matches text', () => {
  logStore.attach('s1', 'p1');
  logBus.emit('s1', 'alpha\nbeta\n');
  const hits = logStore.query({ serviceIds: ['s1'], q: 'bet' });
  expect(hits.map((l) => l.text)).toEqual(['beta']);
});

test('records a marker on error status', () => {
  logStore.attach('s1', 'p1');
  logBus.emitStatus('s1', 'error');
  const lines = logStore.query({ serviceIds: ['s1'] });
  expect(lines.some((l) => l.kind === 'marker' && l.severity === 'error')).toBe(true);
});

test('merges lines from multiple services', () => {
  logStore.attach('s1', 'p1');
  logStore.attach('s2', 'p1');
  logBus.emit('s1', 'first\n');
  logBus.emit('s2', 'second\n');
  const texts = logStore.query({ serviceIds: ['s1', 's2'] }).map((l) => l.text);
  expect(texts).toContain('first');
  expect(texts).toContain('second');
});

test('empty serviceIds queries all attached services', () => {
  logStore.attach('s1', 'p1');
  logBus.emit('s1', 'x\n');
  expect(logStore.query({ serviceIds: [] }).length).toBe(1);
});

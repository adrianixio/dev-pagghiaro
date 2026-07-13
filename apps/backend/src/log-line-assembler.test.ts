import { test, expect } from 'bun:test';
import { createLineAssembler, stripAnsi } from './log-line-assembler';

test('emits a completed line on newline', () => {
  const a = createLineAssembler();
  expect(a.push('hello\n')).toEqual([{ raw: 'hello', text: 'hello' }]);
});

test('buffers partial lines across chunks', () => {
  const a = createLineAssembler();
  expect(a.push('hel')).toEqual([]);
  expect(a.push('lo\n')).toEqual([{ raw: 'hello', text: 'hello' }]);
});

test('handles CRLF without leaking the carriage return', () => {
  const a = createLineAssembler();
  expect(a.push('a\r\nb\n')).toEqual([
    { raw: 'a', text: 'a' },
    { raw: 'b', text: 'b' },
  ]);
});

test('bare CR overwrites the current line (progress bars)', () => {
  const a = createLineAssembler();
  expect(a.push('progress 1\rprogress 2\n')).toEqual([
    { raw: 'progress 2', text: 'progress 2' },
  ]);
});

test('keeps ANSI in raw but strips it in text', () => {
  const a = createLineAssembler();
  const [line] = a.push('[31merr[0m\n');
  expect(line!.text).toBe('err');
  expect(line!.raw).toContain('[31m');
});

test('flush emits the trailing partial line', () => {
  const a = createLineAssembler();
  expect(a.push('tail')).toEqual([]);
  expect(a.flush()).toEqual([{ raw: 'tail', text: 'tail' }]);
});

test('stripAnsi removes escape sequences', () => {
  expect(stripAnsi('[1;32mok[0m')).toBe('ok');
});

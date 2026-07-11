import { buildLogsQueryString, nextErrorIndex } from './logs.service';

describe('buildLogsQueryString', () => {
  it('serializes ids and flags', () => {
    const qs = buildLogsQueryString({ serviceIds: ['a', 'b'], q: 'boom', regex: true, severity: 'error' });
    expect(qs).toContain('services=a%2Cb');
    expect(qs).toContain('q=boom');
    expect(qs).toContain('regex=true');
    expect(qs).toContain('severity=error');
  });

  it('returns empty string with no params', () => {
    expect(buildLogsQueryString({})).toBe('');
  });
});

describe('nextErrorIndex', () => {
  const lines: any[] = [
    { eventHead: true, severity: 'info' },
    { eventHead: true, severity: 'error' },
    { eventHead: false, severity: 'error' },
    { eventHead: true, severity: 'error' },
  ];

  it('finds the next error head forward', () => {
    expect(nextErrorIndex(lines, 0, 1)).toBe(1);
    expect(nextErrorIndex(lines, 1, 1)).toBe(3);
  });

  it('finds the previous error head backward', () => {
    expect(nextErrorIndex(lines, 3, -1)).toBe(1);
  });

  it('stays put when none found', () => {
    expect(nextErrorIndex(lines, 3, 1)).toBe(3);
  });
});

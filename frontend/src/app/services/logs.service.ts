import { Injectable } from '@angular/core';
import type { LogQuery, StructuredLine } from '@dev-pagghiaro/shared';

const API_BASE = '/api';

export function buildLogsQueryString(params: Partial<LogQuery>): string {
  const sp = new URLSearchParams();
  if (params.serviceIds && params.serviceIds.length > 0) sp.set('services', params.serviceIds.join(','));
  if (params.q) sp.set('q', params.q);
  if (params.regex) sp.set('regex', 'true');
  if (params.severity) sp.set('severity', params.severity);
  if (params.since !== undefined) sp.set('since', String(params.since));
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function nextErrorIndex(lines: StructuredLine[], from: number, dir: 1 | -1): number {
  const n = lines.length;
  for (let step = 1; step <= n; step += 1) {
    const i = from + dir * step;
    if (i < 0 || i >= n) break;
    const line = lines[i];
    if (line && line.eventHead && line.severity === 'error') return i;
  }
  return from;
}

@Injectable({ providedIn: 'root' })
export class LogsService {
  async fetchLogs(projectId: string, params: Partial<LogQuery>): Promise<StructuredLine[]> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/logs${buildLogsQueryString(params)}`);
    if (!res.ok) return [];
    return (await res.json()) as StructuredLine[];
  }
}

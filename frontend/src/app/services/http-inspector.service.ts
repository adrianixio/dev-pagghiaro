import { Injectable } from '@angular/core';
import type { HttpExchange, HttpHeader } from '@dev-pagghiaro/shared';

const API_BASE = '/api';

export interface ConsoleRequestInput { method: string; path: string; headers: HttpHeader[]; body?: string; }

@Injectable({ providedIn: 'root' })
export class HttpInspectorService {
  async fetchExchanges(projectId: string, serviceId: string): Promise<HttpExchange[]> {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/http`);
      if (!res.ok) return [];
      return (await res.json()) as HttpExchange[];
    } catch { return []; }
  }

  async send(projectId: string, serviceId: string, input: ConsoleRequestInput): Promise<HttpExchange | null> {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/http/send`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      return (await res.json()) as HttpExchange;
    } catch { return null; }
  }

  async clear(projectId: string, serviceId: string): Promise<void> {
    try { await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/http`, { method: 'DELETE' }); } catch { /* ignore */ }
  }
}

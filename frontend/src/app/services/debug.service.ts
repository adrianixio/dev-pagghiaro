import { Injectable } from '@angular/core';
import type { DebugInfo } from '@dev-pagghiaro/shared';

const API_BASE = '/api';

export interface BreakInResult { ok: boolean; port?: number; message?: string; }

@Injectable({ providedIn: 'root' })
export class DebugService {
  async fetchDebugInfo(projectId: string, serviceId: string): Promise<DebugInfo | null> {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/debug`);
      if (!res.ok) return null;
      return (await res.json()) as DebugInfo;
    } catch { return null; }
  }

  async breakIn(projectId: string, serviceId: string): Promise<BreakInResult> {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/debug/break-in`, { method: 'POST' });
      const body = (await res.json()) as BreakInResult;
      return res.ok ? body : { ok: false, message: (body as { message?: string }).message ?? 'Break-in failed' };
    } catch { return { ok: false, message: 'Break-in request failed' }; }
  }
}

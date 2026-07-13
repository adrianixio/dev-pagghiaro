import { Injectable } from '@angular/core';
import type { ServiceIntrospection } from '@dev-pagghiaro/shared';

const API_BASE = '/api';

@Injectable({ providedIn: 'root' })
export class IntrospectionService {
  async fetchIntrospection(projectId: string, serviceId: string): Promise<ServiceIntrospection | null> {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/introspect`);
      if (!res.ok) return null;
      return (await res.json()) as ServiceIntrospection;
    } catch {
      return null;
    }
  }
}

import { Injectable, computed, inject, signal } from '@angular/core';
import { TerminalService } from '../services/terminal.service';

export interface FloatGeometry {
  x: number; y: number; width: number; height: number; maximized: boolean;
}
export interface OpenTerminal {
  serviceId: string;
  projectId: string;
  serviceName: string;
  mode: 'docked' | 'floating';
  float: FloatGeometry;
}

const DEFAULT_FLOAT: FloatGeometry = { x: 80, y: 80, width: 520, height: 320, maximized: false };
const FLOAT_KEY = 'dev-pagghiaro-floats';

@Injectable({ providedIn: 'root' })
export class TerminalManager {
  private readonly terminalService = inject(TerminalService);

  private readonly terminals = signal<OpenTerminal[]>([]);
  private readonly activeIdSignal = signal<string | null>(null);
  private readonly splitIdsSignal = signal<string[]>([]);
  private zCounter = 0;

  readonly openTerminals = this.terminals.asReadonly();
  readonly activeId = this.activeIdSignal.asReadonly();
  readonly splitIds = this.splitIdsSignal.asReadonly();
  readonly dockedTerminals = computed(() => this.terminals().filter((t) => t.mode === 'docked'));
  readonly floatingTerminals = computed(() => this.terminals().filter((t) => t.mode === 'floating'));

  open(projectId: string, serviceId: string, serviceName: string): void {
    const existing = this.terminals().find((t) => t.serviceId === serviceId);
    if (existing) {
      if (existing.mode === 'docked') this.activeIdSignal.set(serviceId);
      return;
    }
    this.terminalService.toggleTerminal(projectId, serviceId, serviceName); // opens WS
    this.terminals.update((list) => [
      ...list,
      { serviceId, projectId, serviceName, mode: 'docked', float: this.loadFloat(serviceId) },
    ]);
    this.activeIdSignal.set(serviceId);
  }

  close(serviceId: string): void {
    this.terminalService.closeTerminal(serviceId);
    this.terminals.update((list) => list.filter((t) => t.serviceId !== serviceId));
    this.splitIdsSignal.update((ids) => ids.filter((id) => id !== serviceId));
    if (this.activeIdSignal() === serviceId) {
      this.activeIdSignal.set(this.dockedTerminals()[0]?.serviceId ?? null);
    }
  }

  activate(serviceId: string): void {
    if (this.terminals().some((t) => t.serviceId === serviceId && t.mode === 'docked')) {
      this.activeIdSignal.set(serviceId);
    }
  }

  toggleSplit(serviceId: string): void {
    const term = this.terminals().find((t) => t.serviceId === serviceId);
    if (!term || term.mode !== 'docked') return;
    const ids = this.splitIdsSignal();
    if (ids.includes(serviceId)) {
      this.splitIdsSignal.set(ids.filter((id) => id !== serviceId));
      return;
    }
    if (ids.length >= 2) return; // max two side by side
    this.splitIdsSignal.set([...ids, serviceId]);
  }

  float(serviceId: string): void {
    this.setMode(serviceId, 'floating');
    this.splitIdsSignal.update((ids) => ids.filter((id) => id !== serviceId));
    if (this.activeIdSignal() === serviceId) {
      this.activeIdSignal.set(this.dockedTerminals()[0]?.serviceId ?? null);
    }
    this.bringToFront(serviceId);
  }

  dock(serviceId: string): void {
    this.setMode(serviceId, 'docked');
    this.activeIdSignal.set(serviceId);
  }

  toggleMaximize(serviceId: string): void {
    this.updateFloat(serviceId, (g) => ({ ...g, maximized: !g.maximized }));
    this.persistFloats();
  }

  setFloatGeometry(serviceId: string, geo: Partial<FloatGeometry>): void {
    this.updateFloat(serviceId, (g) => ({ ...g, ...geo }));
    this.persistFloats();
  }

  bringToFront(serviceId: string): void {
    this.zCounter += 1;
    this.zIndexMap[serviceId] = this.zCounter;
  }

  readonly zIndexMap: Record<string, number> = {};

  private setMode(serviceId: string, mode: OpenTerminal['mode']): void {
    this.terminals.update((list) =>
      list.map((t) => (t.serviceId === serviceId ? { ...t, mode } : t))
    );
  }

  private updateFloat(serviceId: string, fn: (g: FloatGeometry) => FloatGeometry): void {
    this.terminals.update((list) =>
      list.map((t) => (t.serviceId === serviceId ? { ...t, float: fn(t.float) } : t))
    );
  }

  private loadFloat(serviceId: string): FloatGeometry {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_FLOAT };
    try {
      const all = JSON.parse(localStorage.getItem(FLOAT_KEY) ?? '{}') as Record<string, FloatGeometry>;
      return all[serviceId] ?? { ...DEFAULT_FLOAT };
    } catch {
      return { ...DEFAULT_FLOAT };
    }
  }

  private persistFloats(): void {
    if (typeof localStorage === 'undefined') return;
    const map: Record<string, FloatGeometry> = {};
    for (const t of this.terminals()) map[t.serviceId] = t.float;
    localStorage.setItem(FLOAT_KEY, JSON.stringify(map));
  }
}

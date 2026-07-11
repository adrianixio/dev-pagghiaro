import { Component, effect, inject, signal } from '@angular/core';
import type { ServiceIntrospection } from '@dev-pagghiaro/shared';
import { IntrospectionService } from '../services/introspection.service';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-introspection-panel',
  standalone: true,
  template: `
    <div class="fixed inset-0 z-50 flex bg-black/60" (click)="ui.closeIntrospect()">
      <div class="m-auto flex max-h-[85vh] w-[90vw] max-w-3xl flex-col overflow-auto rounded-lg bg-white p-4 shadow-xl dark:bg-neutral-900" (click)="$event.stopPropagation()">
        @if (data(); as d) {
          <div class="mb-3 flex items-center justify-between">
            <h2 class="font-bold">Diagnostics</h2>
            <button class="rounded border px-2 py-1 text-sm" (click)="ui.closeIntrospect()">Close</button>
          </div>
          <section class="mb-3 text-sm">
            <div><b>Status:</b> {{ d.runtime.status }} <b>Health:</b> {{ d.health.state }}
              @if (d.health.statusCode) { ({{ d.health.statusCode }}) } @if (d.health.detail) { ({{ d.health.detail }}) }</div>
            @if (d.runtime.pid) { <div><b>PID:</b> {{ d.runtime.pid }} <b>Uptime:</b> {{ d.runtime.uptimeMs }}ms</div> }
            @if (d.runtime.lastExitCode !== undefined) { <div><b>Last exit:</b> {{ d.runtime.lastExitCode }}</div> }
          </section>
          <section class="mb-3 font-mono text-xs">
            <div [class.text-red-600]="!d.cwd.exists"><b>cwd:</b> {{ d.cwd.resolved }} @if (!d.cwd.exists) { — MISSING }</div>
            <div><b>argv:</b> {{ d.command.argv.join(' ') }}</div>
            @if (d.port) { <div [class.text-red-600]="d.port.inUse"><b>port:</b> {{ d.port.configured }} @if (d.port.inUse) { — IN USE by {{ d.port.pids.join(', ') }} }</div> }
          </section>
          <section class="text-xs">
            <div class="mb-1 font-bold">Environment ({{ d.env.length }})</div>
            <table class="w-full">
              <tbody>
                @for (v of d.env; track v.key) {
                  <tr class="border-b border-neutral-200 dark:border-neutral-700">
                    <td class="pr-2 font-mono">{{ v.key }}</td>
                    <td class="pr-2 font-mono break-all">{{ v.value }}</td>
                    <td class="whitespace-nowrap text-neutral-500">{{ v.source }}@if (v.shadowed.length) { <span title="overrides {{ v.shadowed.length }} layer(s)"> ⧉{{ v.shadowed.length }}</span> }</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        } @else {
          <div class="p-6 text-center opacity-60">Loading…</div>
        }
      </div>
    </div>
  `,
})
export class IntrospectionPanelComponent {
  readonly ui = inject(UiService);
  private readonly service = inject(IntrospectionService);
  private readonly dataSignal = signal<ServiceIntrospection | null>(null);
  readonly data = this.dataSignal.asReadonly();

  constructor() {
    effect(() => {
      const target = this.ui.introspectTarget();
      if (!target) { this.dataSignal.set(null); return; }
      void this.load(target.projectId, target.serviceId);
    });
  }

  private async load(projectId: string, serviceId: string): Promise<void> {
    this.dataSignal.set(await this.service.fetchIntrospection(projectId, serviceId));
  }
}

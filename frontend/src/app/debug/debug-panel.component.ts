import { Component, OnDestroy, effect, inject, signal } from '@angular/core';
import type { DebugInfo } from '@dev-pagghiaro/shared';
import { DebugService } from '../services/debug.service';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-debug-panel',
  standalone: true,
  template: `
    <div class="fixed inset-0 z-50 flex bg-black/60" (click)="ui.closeDebug()">
      <div class="m-auto flex max-h-[85vh] w-[90vw] max-w-2xl flex-col gap-3 overflow-auto rounded-lg bg-white p-4 text-sm shadow-xl dark:bg-neutral-900" (click)="$event.stopPropagation()">
        <div class="flex items-center justify-between">
          <h2 class="font-bold">Debugger</h2>
          <button class="rounded border px-2 py-1" (click)="ui.closeDebug()">Close</button>
        </div>
        @if (info(); as d) {
          <div><b>Inspect enabled:</b> {{ d.enabled ? 'yes' : 'no (set debug.enabled + restart)' }} · <b>port:</b> {{ d.port }} · <b>listening:</b> {{ d.listening ? 'yes' : 'no' }}</div>
          @if (d.wsUrl) {
            <div class="font-mono text-xs break-all"><b>ws:</b> {{ d.wsUrl }}
              <button class="ml-2 rounded border px-1" (click)="copy(d.wsUrl!)">copy</button></div>
          }
          <div class="rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-800">
            <div class="font-bold">Attach with Chrome</div>
            <div>Open <span class="font-mono">chrome://inspect</span> → Configure → add <span class="font-mono">127.0.0.1:{{ d.port }}</span>.</div>
            <div class="mt-1 font-bold">Attach with VS Code (launch.json)</div>
            <pre class="whitespace-pre-wrap">{{ vscodeSnippet(d.port) }}</pre>
            <div class="mt-1 font-bold">Python (debugpy)</div>
            <pre class="whitespace-pre-wrap">python -m debugpy --listen 127.0.0.1:{{ d.port }} --wait-for-client your_script.py</pre>
          </div>
          @if (d.breakInSupported) {
            <div>
              <button class="rounded border px-3 py-1" (click)="breakIn()" [disabled]="breaking()">Break in (SIGUSR1 → :9229)</button>
              @if (breakMsg()) { <span class="ml-2 text-xs opacity-70">{{ breakMsg() }}</span> }
            </div>
          } @else {
            <div class="text-xs opacity-70">Break-in (SIGUSR1) is not supported on this platform.</div>
          }
        } @else {
          <div class="p-4 text-center opacity-60">Loading…</div>
        }
      </div>
    </div>
  `,
})
export class DebugPanelComponent implements OnDestroy {
  readonly ui = inject(UiService);
  private readonly service = inject(DebugService);
  private readonly infoSignal = signal<DebugInfo | null>(null);
  readonly info = this.infoSignal.asReadonly();
  readonly breaking = signal(false);
  readonly breakMsg = signal('');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      if (this.ui.debugTarget()) {
        void this.refresh();
        this.timer ??= setInterval(() => void this.refresh(), 2000);
      } else if (this.timer) {
        clearInterval(this.timer); this.timer = null;
      }
    });
  }

  ngOnDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private target() { return this.ui.debugTarget(); }

  async refresh(): Promise<void> {
    const t = this.target();
    if (!t) return;
    this.infoSignal.set(await this.service.fetchDebugInfo(t.projectId, t.serviceId));
  }

  async breakIn(): Promise<void> {
    const t = this.target();
    if (!t) return;
    this.breaking.set(true);
    try {
      const r = await this.service.breakIn(t.projectId, t.serviceId);
      this.breakMsg.set(r.ok ? `inspector opened on :${r.port}` : (r.message ?? 'failed'));
      await this.refresh();
    } finally { this.breaking.set(false); }
  }

  vscodeSnippet(port: number): string {
    return `{ "type": "node", "request": "attach", "name": "pagghiaro", "address": "127.0.0.1", "port": ${port} }`;
  }

  copy(text: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(text);
  }
}

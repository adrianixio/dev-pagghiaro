import { Component, OnDestroy, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { HttpExchange } from '@dev-pagghiaro/shared';
import { HttpInspectorService } from '../services/http-inspector.service';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-http-inspector-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="fixed inset-0 z-50 flex bg-black/60" (click)="ui.closeHttpInspect()">
      <div class="m-auto flex h-[85vh] w-[92vw] max-w-6xl flex-col rounded-lg bg-white shadow-xl dark:bg-neutral-900" (click)="$event.stopPropagation()">
        <!-- Console -->
        <div class="flex flex-wrap items-center gap-2 border-b p-3 dark:border-neutral-700">
          <select class="rounded border px-2 py-1 text-sm dark:bg-neutral-800" [(ngModel)]="method">
            <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
          </select>
          <input class="min-w-40 flex-1 rounded border px-2 py-1 text-sm dark:bg-neutral-800" placeholder="/api/path" [(ngModel)]="path" />
          <button class="rounded border px-3 py-1 text-sm" (click)="send()" [disabled]="sending()">Send</button>
          <button class="rounded border px-2 py-1 text-sm" (click)="clear()">Clear</button>
          <button class="ml-auto rounded border px-2 py-1 text-sm" (click)="ui.closeHttpInspect()">Close</button>
        </div>
        @if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
          <textarea class="border-b p-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800" rows="3" placeholder="request body" [(ngModel)]="reqBody"></textarea>
        }
        <div class="flex min-h-0 flex-1">
          <!-- List -->
          <div class="w-1/2 overflow-auto border-r font-mono text-xs dark:border-neutral-700">
            @for (ex of exchanges(); track ex.id) {
              <button class="flex w-full items-center gap-2 border-b px-2 py-1 text-left hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800" (click)="selected.set(ex)">
                <span class="w-12 shrink-0">{{ ex.request.method }}</span>
                <span [class]="statusClass(ex)">{{ ex.response?.status ?? (ex.error ? 'ERR' : '…') }}</span>
                <span class="truncate">{{ ex.request.path }}</span>
                <span class="ml-auto opacity-60">{{ ex.source === 'console' ? '⌨' : '' }}{{ ex.response?.durationMs != null ? ex.response!.durationMs + 'ms' : '' }}</span>
              </button>
            }
            @if (exchanges().length === 0) { <div class="p-4 text-center opacity-60">No exchanges</div> }
          </div>
          <!-- Detail -->
          <div class="w-1/2 overflow-auto p-2 font-mono text-xs">
            @if (selected(); as ex) {
              <div class="mb-1 font-bold">{{ ex.request.method }} {{ ex.request.path }}</div>
              @if (ex.error) { <div class="text-red-600">error: {{ ex.error }}</div> }
              <div class="mt-2 font-bold">Request headers</div>
              @for (h of ex.request.headers; track h.name) { <div>{{ h.name }}: {{ h.value }}</div> }
              @if (ex.request.body?.text) { <div class="mt-1 whitespace-pre-wrap break-all">{{ ex.request.body!.text }}</div> }
              @if (ex.response; as r) {
                <div class="mt-2 font-bold">Response {{ r.status }} ({{ r.durationMs }}ms)</div>
                @for (h of r.headers; track h.name) { <div>{{ h.name }}: {{ h.value }}</div> }
                @if (r.body?.binary) { <div class="opacity-60">[binary, {{ r.body!.byteLength }} bytes]</div> }
                @if (r.body?.text) { <div class="mt-1 whitespace-pre-wrap break-all">{{ r.body!.text }}@if (r.body!.truncated) { <span class="opacity-60"> …[truncated]</span> }</div> }
              }
            } @else { <div class="p-4 text-center opacity-60">Select an exchange</div> }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class HttpInspectorPanelComponent implements OnDestroy {
  readonly ui = inject(UiService);
  private readonly service = inject(HttpInspectorService);

  method = 'GET';
  path = '/';
  reqBody = '';

  private readonly exchangesSignal = signal<HttpExchange[]>([]);
  readonly exchanges = this.exchangesSignal.asReadonly();
  readonly selected = signal<HttpExchange | null>(null);
  readonly sending = signal(false);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      if (this.ui.httpInspectTarget()) {
        void this.refresh();
        this.timer ??= setInterval(() => void this.refresh(), 1500);
      } else if (this.timer) {
        clearInterval(this.timer); this.timer = null;
      }
    });
  }

  ngOnDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private target() { return this.ui.httpInspectTarget(); }

  async refresh(): Promise<void> {
    const t = this.target();
    if (!t) return;
    this.exchangesSignal.set(await this.service.fetchExchanges(t.projectId, t.serviceId));
  }

  async send(): Promise<void> {
    const t = this.target();
    if (!t) return;
    this.sending.set(true);
    try {
      const headers = (this.method === 'POST' || this.method === 'PUT' || this.method === 'PATCH') && this.reqBody
        ? [{ name: 'content-type', value: 'application/json' }] : [];
      await this.service.send(t.projectId, t.serviceId, { method: this.method, path: this.path, headers, ...(this.reqBody ? { body: this.reqBody } : {}) });
      await this.refresh();
    } finally { this.sending.set(false); }
  }

  async clear(): Promise<void> {
    const t = this.target();
    if (!t) return;
    await this.service.clear(t.projectId, t.serviceId);
    this.selected.set(null);
    await this.refresh();
  }

  statusClass(ex: HttpExchange): string {
    const s = ex.response?.status;
    if (ex.error || (s && s >= 500)) return 'w-10 shrink-0 text-red-600';
    if (s && s >= 400) return 'w-10 shrink-0 text-yellow-600';
    if (s && s >= 200 && s < 300) return 'w-10 shrink-0 text-green-600';
    return 'w-10 shrink-0 opacity-60';
  }
}

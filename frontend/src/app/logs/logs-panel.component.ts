import { Component, computed, inject, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { LogQuery, LogSeverity, StructuredLine } from '@dev-pagghiaro/shared';
import { LogsService, nextErrorIndex } from '../services/logs.service';
import { ProjectService } from '../services/project.service';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-logs-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="fixed inset-0 z-50 flex flex-col bg-black/60" (click)="ui.closeLogs()">
      <div class="m-auto flex h-[85vh] w-[90vw] max-w-5xl flex-col rounded-lg bg-white shadow-xl dark:bg-neutral-900" (click)="$event.stopPropagation()">
        <!-- Toolbar -->
        <div class="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-700">
          <input class="min-w-40 flex-1 rounded border px-2 py-1 text-sm dark:bg-neutral-800"
                 placeholder="Cerca..." [(ngModel)]="qModel" (ngModelChange)="refresh()" />
          <label class="flex items-center gap-1 text-sm"><input type="checkbox" [(ngModel)]="regex" (ngModelChange)="refresh()" /> regex</label>
          <select class="rounded border px-2 py-1 text-sm dark:bg-neutral-800" [(ngModel)]="severity" (ngModelChange)="refresh()">
            <option value="">tutte</option>
            <option value="warn">warn+</option>
            <option value="error">solo error</option>
          </select>
          <button class="rounded border px-2 py-1 text-sm" (click)="jump(-1)">↑ err</button>
          <button class="rounded border px-2 py-1 text-sm" (click)="jump(1)">↓ err</button>
          <button class="ml-auto rounded border px-2 py-1 text-sm" (click)="ui.closeLogs()">Chiudi</button>
        </div>
        <!-- Lines -->
        <div class="flex-1 overflow-auto p-2 font-mono text-xs leading-relaxed">
          @for (line of lines(); track line.seq + ':' + line.serviceId; let i = $index) {
            <div [attr.data-idx]="i" [class]="rowClass(line)">
              <span class="mr-2 opacity-60">{{ shortId(line.serviceId) }}</span>{{ line.text }}
            </div>
          }
          @if (lines().length === 0) {
            <div class="p-4 text-center opacity-60">Nessun log</div>
          }
        </div>
      </div>
    </div>
  `,
})
export class LogsPanelComponent {
  readonly ui = inject(UiService);
  private readonly logsService = inject(LogsService);
  private readonly projectService = inject(ProjectService);

  // Campi semplici bindati con [(ngModel)] (i signal non supportano ngModel).
  qModel = '';
  regex = false;
  severity: '' | LogSeverity = '';

  private readonly linesSignal = signal<StructuredLine[]>([]);
  readonly lines = this.linesSignal.asReadonly();
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursor = -1;

  constructor() {
    // Ricarica quando il pannello si apre e avvia il polling; ferma alla chiusura.
    effect(() => {
      if (this.ui.logsOpen()) {
        void this.refresh();
        this.timer ??= setInterval(() => void this.refresh(), 1000);
      } else if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    });
  }

  private currentProjectId(): string | null {
    return this.ui.logsProjectId() ?? this.projectService.activeProject()?.id ?? null;
  }

  async refresh(): Promise<void> {
    try {
      const projectId = this.currentProjectId();
      if (!projectId) return;
      const params: Partial<LogQuery> = { serviceIds: [], regex: this.regex, limit: 2000 };
      if (this.qModel) params.q = this.qModel;
      if (this.severity) params.severity = this.severity;
      this.linesSignal.set(await this.logsService.fetchLogs(projectId, params));
    } catch {
      // Transient fetch failure (offline/DNS): keep showing the current lines.
    }
  }

  jump(dir: 1 | -1): void {
    const idx = nextErrorIndex(this.lines(), this.cursor, dir);
    if (idx === this.cursor) return;
    this.cursor = idx;
    const el = document.querySelector(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: 'center' });
  }

  shortId(id: string): string { return id.slice(0, 6); }

  rowClass(line: StructuredLine): string {
    if (line.kind === 'marker') return 'text-amber-600 dark:text-amber-400';
    if (line.severity === 'error') return 'text-red-600 dark:text-red-400';
    if (line.severity === 'warn') return 'text-yellow-600 dark:text-yellow-400';
    return 'text-neutral-800 dark:text-neutral-200';
  }
}

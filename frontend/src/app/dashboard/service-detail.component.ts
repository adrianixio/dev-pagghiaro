import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiBadgeComponent } from '../ui/ui-badge.component';
import { UiService } from '../models/project.model';

@Component({
  selector: 'app-service-detail',
  standalone: true,
  imports: [CommonModule, UiBadgeComponent],
  template: `
    <div class="grid gap-3 border-t border-border bg-surface px-4 py-3 text-sm dark:border-rustic-700 dark:bg-rustic-900 md:grid-cols-2">
      <div>
        <div class="mb-1 text-xs uppercase tracking-wider text-content-muted">Command</div>
        <code class="block break-all rounded bg-rustic-100 px-2 py-1 font-mono text-xs text-content dark:bg-rustic-800 dark:text-rustic-200">{{ service.command }}</code>
        <div class="mt-2 text-xs text-content-muted">cwd: <span class="font-mono">{{ service.cwd }}</span></div>
      </div>
      <div>
        <div class="mb-1 text-xs uppercase tracking-wider text-content-muted">Environment</div>
        @if (envEntries().length > 0) {
          <div class="flex flex-wrap gap-1">
            @for (e of envEntries(); track e[0]) { <ui-badge tone="muted">{{ e[0] }}</ui-badge> }
          </div>
        } @else {
          <div class="text-xs text-content-muted">No service-level env vars</div>
        }
        <div class="mt-2 flex gap-4 text-xs text-content-muted">
          <span>CPU <span class="font-mono text-content dark:text-rustic-200">{{ service.metrics?.cpu ?? 0 }}%</span></span>
          <span>MEM <span class="font-mono text-content dark:text-rustic-200">{{ (service.metrics?.ram ?? 0) | number:'1.0-0' }}MB</span></span>
        </div>
      </div>
    </div>
  `,
})
export class ServiceDetailComponent {
  @Input({ required: true }) service!: UiService;
  envEntries(): [string, string][] { return Object.entries(this.service.env ?? {}); }
}

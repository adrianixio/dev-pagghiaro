import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { UiBadgeComponent } from '../ui/ui-badge.component';

@Component({
  selector: 'app-execution-plan',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, UiBadgeComponent],
  template: `
    @if (planNames.length > 0) {
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-bold uppercase tracking-wider text-content-muted">Plan</span>
        @for (name of planNames; track $index; let i = $index; let last = $last) {
          <span class="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-content dark:border-rustic-600 dark:bg-rustic-900 dark:text-rustic-200">
            <span class="font-semibold text-accent">{{ i + 1 }}</span>{{ name }}
          </span>
          @if (!last) { <lucide-icon name="arrow-right" [size]="12" class="text-content-muted"></lucide-icon> }
        }
        @if (delayMs > 0) { <ui-badge tone="muted">{{ delayMs }}ms</ui-badge> }
        @if (excludedNames.length > 0) { <ui-badge tone="muted">+{{ excludedNames.length }} excluded</ui-badge> }
      </div>
    }
  `,
})
export class ExecutionPlanComponent {
  @Input() planNames: string[] = [];
  @Input() excludedNames: string[] = [];
  @Input() delayMs = 0;
}

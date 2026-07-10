import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-panel',
  standalone: true,
  template: `
    <section class="rounded-lg border border-border bg-surface-raised shadow-soft transition-colors dark:border-rustic-700 dark:bg-rustic-800">
      @if (title) {
        <header class="border-b border-border px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-content dark:border-rustic-700 dark:text-rustic-100">
          {{ title }}
        </header>
      }
      <div class="p-4"><ng-content></ng-content></div>
    </section>
  `,
})
export class UiPanelComponent {
  @Input() title?: string;
}

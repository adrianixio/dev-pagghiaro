import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-badge',
  standalone: true,
  template: `<span [class]="classes"><ng-content></ng-content></span>`,
})
export class UiBadgeComponent {
  @Input() tone: 'neutral' | 'accent' | 'danger' | 'muted' = 'neutral';
  get classes(): string {
    const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono';
    const tones = {
      neutral: 'bg-rustic-100 text-content-muted border border-border dark:bg-rustic-800 dark:text-rustic-300 dark:border-rustic-700',
      accent: 'bg-accent/15 text-accent border border-accent/30',
      danger: 'bg-danger/12 text-danger border border-danger/30',
      muted: 'bg-rustic-100 text-content-muted dark:bg-rustic-800 dark:text-rustic-400',
    };
    return `${base} ${tones[this.tone]}`;
  }
}

import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-button',
  standalone: true,
  template: `
    <button type="button" [disabled]="disabled" [class]="classes">
      <ng-content></ng-content>
    </button>
  `,
})
export class UiButtonComponent {
  @Input() variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary';
  @Input() size: 'sm' | 'md' = 'md';
  @Input() disabled = false;

  get classes(): string {
    const base = 'inline-flex items-center gap-2 rounded-md font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
    const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' };
    const variants = {
      primary: 'bg-accent text-white hover:bg-accent/90',
      secondary: 'bg-surface-raised text-content-muted border border-border hover:bg-rustic-100 dark:bg-rustic-800 dark:text-rustic-200 dark:border-rustic-700 dark:hover:bg-rustic-700',
      ghost: 'text-content-muted hover:bg-rustic-100 dark:text-rustic-300 dark:hover:bg-rustic-800',
      danger: 'bg-danger text-white hover:bg-danger/90',
    };
    return `${base} ${sizes[this.size]} ${variants[this.variant]}`;
  }
}

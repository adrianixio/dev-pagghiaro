import { Component, Input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'ui-icon-button',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <button type="button" [attr.aria-label]="label" [attr.title]="label" [class]="classes">
      <lucide-icon [name]="icon" [size]="size"></lucide-icon>
    </button>
  `,
})
export class UiIconButtonComponent {
  @Input() icon = 'circle';
  @Input() label = '';
  @Input() size = 16;
  @Input() tone: 'default' | 'accent' | 'danger' | 'warning' | 'info' = 'default';

  get classes(): string {
    const base = 'inline-flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-rustic-100 dark:hover:bg-rustic-800';
    const tones = {
      default: 'text-content-muted hover:text-content dark:hover:text-rustic-100',
      accent: 'text-content-muted hover:text-accent',
      danger: 'text-content-muted hover:text-danger',
      warning: 'text-content-muted hover:text-warning',
      info: 'text-content-muted hover:text-info',
    };
    return `${base} ${tones[this.tone]}`;
  }
}

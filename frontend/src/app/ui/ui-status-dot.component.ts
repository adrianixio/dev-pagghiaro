import { Component, Input, computed, signal } from '@angular/core';
import { ServiceStatus } from '../models/project.model';

@Component({
  selector: 'ui-status-dot',
  standalone: true,
  template: `<span class="inline-block h-2.5 w-2.5 rounded-full" [class]="cls()"></span>`,
})
export class UiStatusDotComponent {
  private readonly status$ = signal<ServiceStatus>('stopped');
  @Input() set status(value: ServiceStatus) { this.status$.set(value); }
  readonly cls = computed(() => {
    switch (this.status$()) {
      case 'running': return 'bg-accent';
      case 'error': return 'bg-danger';
      case 'restarting': return 'bg-warning animate-pulse';
      default: return 'bg-content-muted';
    }
  });
}

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { UiStatusDotComponent } from '../ui/ui-status-dot.component';
import { UiBadgeComponent } from '../ui/ui-badge.component';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';
import { ServiceDetailComponent } from './service-detail.component';
import { UiService } from '../models/project.model';

@Component({
  selector: 'app-service-row',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, UiStatusDotComponent, UiBadgeComponent, UiIconButtonComponent, ServiceDetailComponent],
  template: `
    <div class="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-soft transition-colors dark:border-rustic-700 dark:bg-rustic-800">
      <div class="flex items-center gap-3 px-4 py-2.5">
        <button type="button" (click)="toggle.emit()" class="text-content-muted hover:text-content" [attr.aria-expanded]="expanded" aria-label="Toggle details">
          <lucide-icon [name]="expanded ? 'chevron-down' : 'chevron-right'" [size]="16"></lucide-icon>
        </button>
        <ui-status-dot [status]="service.status"></ui-status-dot>
        <span class="inline-block h-2 w-2 rounded-full" [class]="healthDotClass()" [title]="'health: ' + (service.health?.state ?? 'unknown')"></span>
        <span class="font-display font-bold text-content dark:text-rustic-100">{{ service.name }}</span>
        <code class="hidden min-w-0 flex-1 truncate font-mono text-xs text-content-muted md:block">{{ service.command }}</code>
        @if (service.port != null) { <ui-badge tone="neutral">:{{ service.port }}</ui-badge> }
        <div class="flex w-24 items-center gap-1 text-xs text-content-muted">
          <span class="inline-block h-3 w-10 rounded bg-gradient-to-r from-accent/20 to-accent/60"></span>
          <span class="font-mono">{{ service.metrics?.cpu ?? 0 }}%</span>
        </div>
        <div class="flex items-center gap-0.5">
          <ui-icon-button icon="play" label="Start" tone="accent" (click)="start.emit()"></ui-icon-button>
          <ui-icon-button icon="rotate-cw" label="Restart" tone="warning" (click)="restart.emit()"></ui-icon-button>
          <ui-icon-button icon="square" label="Stop" tone="danger" (click)="stop.emit()"></ui-icon-button>
          <span data-action="open-terminal" class="contents"><ui-icon-button icon="terminal" label="Open terminal" tone="info" (click)="openTerminal.emit()"></ui-icon-button></span>
          <ui-icon-button icon="activity" label="Inspect" tone="info" (click)="inspect.emit()"></ui-icon-button>
          <ui-icon-button icon="plug-zap" label="Kill port" (click)="killPort.emit()"></ui-icon-button>
        </div>
      </div>
      @if (expanded) { <app-service-detail [service]="service"></app-service-detail> }
    </div>
  `,
})
export class ServiceRowComponent {
  @Input({ required: true }) service!: UiService;
  @Input() expanded = false;
  @Output() toggle = new EventEmitter<void>();
  @Output() start = new EventEmitter<void>();
  @Output() stop = new EventEmitter<void>();
  @Output() restart = new EventEmitter<void>();
  @Output() openTerminal = new EventEmitter<void>();
  @Output() killPort = new EventEmitter<void>();
  @Output() inspect = new EventEmitter<void>();

  healthDotClass(): string {
    switch (this.service.health?.state) {
      case 'up': return 'bg-green-500';
      case 'down': return 'bg-red-500';
      default: return 'bg-neutral-400';
    }
  }
}

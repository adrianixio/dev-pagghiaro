import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { ProjectService } from '../services/project.service';
import { UiService } from '../services/ui.service';
import { UiButtonComponent } from '../ui/ui-button.component';
import { UiBadgeComponent } from '../ui/ui-badge.component';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, UiButtonComponent, UiBadgeComponent, UiIconButtonComponent],
  template: `
    @if (projectService.activeProject(); as project) {
      <div class="flex flex-wrap items-center gap-3 border-b border-border bg-surface-raised px-4 py-2.5 dark:border-rustic-700 dark:bg-rustic-800">
        @if (ui.isMobile()) {
          <ui-icon-button icon="menu" label="Open sidebar" (click)="ui.openSidebar()"></ui-icon-button>
        }
        <div class="min-w-0">
          <h1 class="truncate font-display text-lg font-bold text-content dark:text-rustic-100">{{ project.name }}</h1>
          <div class="flex items-center gap-1 truncate font-mono text-xs text-content-muted">
            <lucide-icon name="hard-drive" [size]="12"></lucide-icon>{{ project.rootPath }}
          </div>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <ui-badge tone="neutral">{{ running() }}/{{ project.services.length }} running</ui-badge>
          <ui-button variant="primary" size="sm" (click)="projectService.startAllServices(project.id)"><lucide-icon name="play" [size]="14"></lucide-icon>Start all</ui-button>
          <ui-button variant="secondary" size="sm" (click)="projectService.restartAllServices(project.id)"><lucide-icon name="refresh-cw" [size]="14"></lucide-icon>Restart</ui-button>
          <ui-button variant="secondary" size="sm" (click)="projectService.stopAllServices(project.id)"><lucide-icon name="square" [size]="14"></lucide-icon>Stop all</ui-button>
          <ui-button variant="ghost" size="sm" (click)="projectService.reloadProjectContext(project.id)"><lucide-icon name="rotate-cw" [size]="14"></lucide-icon>Reload</ui-button>
          <ui-icon-button icon="settings" label="Project settings" (click)="ui.openConfig(project.id)"></ui-icon-button>
        </div>
      </div>
    }
  `,
})
export class ToolbarComponent {
  readonly projectService = inject(ProjectService);
  readonly ui = inject(UiService);
  running(): number {
    return this.projectService.activeServices().filter((s) => s.status === 'running').length;
  }
}

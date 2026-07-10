import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { ProjectService } from '../services/project.service';
import { UiService } from '../services/ui.service';
import { TerminalManager } from '../terminal/terminal-manager.service';
import { UiStatusDotComponent } from '../ui/ui-status-dot.component';
import { UiIconButtonComponent } from '../ui/ui-icon-button.component';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, UiStatusDotComponent, UiIconButtonComponent],
  template: `
    <aside id="app-sidebar"
      class="z-40 flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface-raised transition-transform dark:border-rustic-700 dark:bg-rustic-800"
      [class.fixed]="ui.isMobile()" [class.-translate-x-full]="ui.isMobile() && !ui.sidebarOpen()">
      <div class="flex items-center justify-between border-b border-border px-4 py-3 dark:border-rustic-700">
        <span class="font-display text-sm font-bold uppercase tracking-[0.18em] text-accent">Projects</span>
        <ui-icon-button icon="plus" label="New project" (click)="ui.openNewProject()"></ui-icon-button>
      </div>
      <nav class="min-h-0 flex-1 overflow-auto p-2">
        @for (project of projectService.projects(); track project.id) {
          <button type="button" (click)="select(project.id)"
            class="mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
            [class]="project.id === projectService.activeProjectId()
              ? 'bg-accent/12 text-accent'
              : 'text-content hover:bg-rustic-100 dark:text-rustic-200 dark:hover:bg-rustic-700'">
            <lucide-icon name="folder" [size]="16"></lucide-icon>
            <span class="min-w-0 flex-1 truncate">{{ project.name }}</span>
            <span class="font-mono text-xs text-content-muted">{{ runningCount(project.id) }}/{{ project.services.length }}</span>
          </button>
          @if (project.id === projectService.activeProjectId()) {
            <div class="mb-2 ml-3 border-l border-border pl-2 dark:border-rustic-700">
              @for (service of project.services; track service.id) {
                <button type="button" (click)="mgr.open(project.id, service.id, service.name)"
                  class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-content-muted hover:bg-rustic-100 dark:hover:bg-rustic-700">
                  <ui-status-dot [status]="service.status"></ui-status-dot>
                  <span class="truncate">{{ service.name }}</span>
                </button>
              }
            </div>
          }
        }
      </nav>
    </aside>
  `,
})
export class SidebarComponent {
  readonly projectService = inject(ProjectService);
  readonly ui = inject(UiService);
  readonly mgr = inject(TerminalManager);

  select(id: string): void {
    this.projectService.setActiveProject(id);
    if (this.ui.isMobile()) this.ui.closeSidebar();
  }
  runningCount(projectId: string): number {
    return this.projectService.getProjectById(projectId)?.services.filter((s) => s.status === 'running').length ?? 0;
  }
}

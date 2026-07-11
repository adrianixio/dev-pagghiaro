import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectService } from '../services/project.service';
import { TerminalManager } from '../terminal/terminal-manager.service';
import { UiService } from '../services/ui.service';
import { ServiceRowComponent } from './service-row.component';
import { ExecutionPlanComponent } from './execution-plan.component';
import { EmptyStateComponent } from './empty-state.component';
import { UiProject, UiService as UiServiceModel } from '../models/project.model';

@Component({
  selector: 'app-service-list',
  standalone: true,
  imports: [CommonModule, ServiceRowComponent, ExecutionPlanComponent, EmptyStateComponent],
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    @if (projectService.activeProject(); as project) {
      <div class="border-b border-border px-6 py-3 dark:border-rustic-700">
        <app-execution-plan [planNames]="planNames(project)" [excludedNames]="excludedNames(project)"
          [delayMs]="project.executionOrder?.delayMs || 0"></app-execution-plan>
      </div>
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-4">
        @for (service of projectService.activeServices(); track service.id) {
          <app-service-row [service]="service" [expanded]="expandedId() === service.id"
            (toggle)="toggleExpand(service.id)"
            (start)="projectService.startService(project.id, service.id)"
            (stop)="projectService.stopService(project.id, service.id)"
            (restart)="projectService.restartService(project.id, service.id)"
            (openTerminal)="mgr.open(project.id, service.id, service.name)"
            (killPort)="killPort(project.id, service)"
            (inspect)="ui.openIntrospect(project.id, service.id)"
            (httpInspect)="ui.openHttpInspect(project.id, service.id)">
          </app-service-row>
        }
      </div>
    } @else {
      <app-empty-state></app-empty-state>
    }
  `,
})
export class ServiceListComponent {
  readonly projectService = inject(ProjectService);
  readonly mgr = inject(TerminalManager);
  readonly ui = inject(UiService);
  private readonly expandedIdSignal = signal<string | null>(null);
  readonly expandedId = this.expandedIdSignal.asReadonly();

  toggleExpand(id: string): void {
    this.expandedIdSignal.update((cur) => (cur === id ? null : id));
  }

  planNames(project: UiProject): string[] {
    const ids = project.executionOrder?.serviceIds ?? project.services.map((s) => s.id);
    return ids.map((id) => project.services.find((s) => s.id === id)?.name).filter((n): n is string => !!n);
  }

  excludedNames(project: UiProject): string[] {
    const included = new Set(project.executionOrder?.serviceIds ?? project.services.map((s) => s.id));
    return project.services.filter((s) => !included.has(s.id)).map((s) => s.name);
  }

  async killPort(projectId: string, service: UiServiceModel): Promise<void> {
    if (service.port == null) { this.ui.showToast('No port', `${service.name} has no configured port`, 'error'); return; }
    const result = await this.projectService.killServicePort(projectId, service.id);
    if (result && result.killed.length > 0) {
      this.ui.showToast('Port freed', `Stopped PID ${result.killed.join(', ')} on :${service.port}`);
    } else {
      this.ui.showToast('Nothing to kill', `No process was listening on :${service.port}`);
    }
  }
}

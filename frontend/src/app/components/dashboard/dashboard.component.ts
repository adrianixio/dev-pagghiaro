import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ServiceCardComponent } from '../service-card/service-card.component';
import { ProjectService } from '../../services/project.service';
import { UiProject } from '../../models/project.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ServiceCardComponent, LucideAngularModule],
  host: {
    class: 'flex min-h-0 flex-1',
  },
  template: `
    <div class="flex min-h-0 flex-1 flex-col overflow-auto bg-rustic-50 p-6 transition-colors duration-300 dark:bg-rustic-900">
      @if (projectService.activeProject(); as project) {
        <div class="mb-8 flex flex-wrap justify-between gap-4 items-end border-b border-rustic-200 dark:border-rustic-700 pb-4">
          <div>
            <h2 class="text-3xl font-bold text-country-green tracking-tight">{{ project.name }}</h2>
            <p class="text-rustic-500 dark:text-rustic-400 font-mono text-sm mt-2 flex items-center gap-2">
              <lucide-icon name="hard-drive" [size]="14"></lucide-icon>
              {{ project.rootPath }}
            </p>
          </div>

          <div class="flex flex-wrap gap-3 items-center">
            <button class="btn btn-secondary flex items-center gap-2 text-country-green hover:text-opacity-80"
                    (click)="projectService.startAllServices(project.id)">
              <lucide-icon name="play" [size]="16"></lucide-icon>
              Start All
            </button>
            <button class="btn btn-secondary flex items-center gap-2 text-country-yellow hover:text-opacity-80"
                    (click)="projectService.restartAllServices(project.id)">
              <lucide-icon name="refresh-cw" [size]="16"></lucide-icon>
              Restart All
            </button>
            <button class="btn btn-secondary flex items-center gap-2 text-country-red hover:text-opacity-80"
                    (click)="projectService.stopAllServices(project.id)">
              <lucide-icon name="square" [size]="16"></lucide-icon>
              Stop All
            </button>
            <button class="btn btn-secondary flex items-center gap-2 text-country-blue hover:text-opacity-80"
                    (click)="projectService.reloadProjectContext(project.id)"
                    title="Reload project env and restart active services">
              <lucide-icon name="rotate-cw" [size]="16"></lucide-icon>
              Reload Context
            </button>

            <div class="bg-white dark:bg-rustic-800 border border-rustic-200 dark:border-rustic-700 rounded-md px-4 py-2 flex items-center gap-3 shadow-sm transition-colors duration-300">
              <lucide-icon name="server" [size]="18" class="text-country-blue"></lucide-icon>
              <div class="flex flex-col">
                <span class="text-xs text-rustic-500 dark:text-rustic-400 uppercase">Services</span>
                <span class="font-mono font-bold text-rustic-900 dark:text-rustic-100">{{ projectService.activeServices().length }}</span>
              </div>
            </div>

            <div class="bg-white dark:bg-rustic-800 border border-rustic-200 dark:border-rustic-700 rounded-md px-4 py-2 flex items-center gap-3 shadow-sm transition-colors duration-300">
              <lucide-icon name="activity" [size]="18" class="text-country-green"></lucide-icon>
              <div class="flex flex-col">
                <span class="text-xs text-rustic-500 dark:text-rustic-400 uppercase">Running</span>
                <span class="font-mono font-bold text-rustic-900 dark:text-rustic-100">{{ getRunningCount() }}</span>
              </div>
            </div>
          </div>
        </div>

        @if (getExecutionPlan(project).length > 0) {
          <div class="mb-8 bg-white dark:bg-rustic-800 border border-rustic-200 dark:border-rustic-700 rounded-lg p-4 shadow-sm transition-colors duration-300">
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <lucide-icon name="list-ordered" [size]="18" class="text-rustic-500 dark:text-rustic-400"></lucide-icon>
              <h3 class="text-sm font-bold text-rustic-900 dark:text-rustic-100 uppercase tracking-wider">Execution Plan</h3>
              @if ((project.executionOrder?.delayMs || 0) > 0) {
                <span class="ml-2 text-xs font-mono bg-rustic-100 dark:bg-rustic-700 text-rustic-600 dark:text-rustic-300 px-2 py-0.5 rounded">
                  {{ project.executionOrder?.delayMs }}ms delay
                </span>
              }
              <span class="ml-auto text-xs font-mono bg-country-green/15 text-country-green px-2 py-0.5 rounded-full border border-country-green/30">
                Included {{ getExecutionPlan(project).length }}
              </span>
              @if (getExcludedServices(project).length > 0) {
                <span class="text-xs font-mono bg-rustic-100 dark:bg-rustic-700 text-rustic-600 dark:text-rustic-300 px-2 py-0.5 rounded-full border border-rustic-200 dark:border-rustic-600">
                  Excluded {{ getExcludedServices(project).length }}
                </span>
              }
            </div>
            <div class="flex flex-wrap items-center gap-2">
              @for (serviceName of getExecutionPlan(project); track $index; let i = $index; let last = $last) {
                <div class="flex items-center gap-2">
                  <div class="flex items-center gap-2 rounded-full border border-rustic-300 dark:border-rustic-600 bg-rustic-50 dark:bg-rustic-900 px-3 py-1 text-sm text-rustic-700 dark:text-rustic-200">
                    <span class="text-country-green font-semibold">{{ i + 1 }}</span>
                    <span>{{ serviceName }}</span>
                  </div>
                  @if (!last) {
                    <lucide-icon name="arrow-right" [size]="14" class="text-rustic-400 dark:text-rustic-500"></lucide-icon>
                  }
                </div>
              }
            </div>
            @if (getExcludedServices(project).length > 0) {
              <div class="mt-4 border-t border-rustic-200 dark:border-rustic-700 pt-3">
                <div class="text-xs uppercase tracking-[0.2em] text-rustic-500 dark:text-rustic-400 mb-2">Not In Plan</div>
                <div class="flex flex-wrap gap-2">
                  @for (serviceName of getExcludedServices(project); track $index) {
                    <div class="rounded-full border border-rustic-200 dark:border-rustic-600 bg-rustic-100 dark:bg-rustic-900 px-3 py-1 text-sm text-rustic-500 dark:text-rustic-400">
                      {{ serviceName }}
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }

        <div class="overflow-x-auto pb-2">
          <div class="grid min-w-[20rem] grid-cols-1 gap-6 md:min-w-0 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            @for (service of projectService.activeServices(); track service.id) {
              <app-service-card [service]="service" [projectId]="project.id"></app-service-card>
            }
          </div>
        </div>
      } @else {
        <div class="flex-1 flex items-center justify-center flex-col text-rustic-400 dark:text-rustic-500">
          <lucide-icon name="server" [size]="64" class="mb-4 opacity-50"></lucide-icon>
          <h2 class="text-2xl font-bold text-rustic-600 dark:text-rustic-400">No Project Selected</h2>
          <p class="mt-2 text-center max-w-xl">Select a project from the sidebar or press <kbd class="bg-rustic-200 dark:bg-rustic-700 px-2 py-1 rounded text-country-green font-mono text-xs">Ctrl+K</kbd> to search projects and run commands.</p>
        </div>
      }
    </div>
  `,
})
export class DashboardComponent {
  readonly projectService = inject(ProjectService);

  getRunningCount(): number {
    return this.projectService.activeServices().filter((service) => service.status === 'running').length;
  }

  getExecutionPlan(project: UiProject): string[] {
    const services = project.services ?? [];
    const serviceIds = project.executionOrder?.serviceIds ?? services.map((service) => service.id);
    const plan: string[] = [];
    for (const id of serviceIds) {
      const service = services.find((entry) => entry.id === id);
      if (service) {
        plan.push(service.name);
      }
    }
    return plan;
  }

  getExcludedServices(project: UiProject): string[] {
    const includedIds = new Set(project.executionOrder?.serviceIds ?? (project.services ?? []).map((service) => service.id));
    return (project.services ?? [])
      .filter((service) => !includedIds.has(service.id))
      .map((service) => service.name);
  }
}

import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ServiceCardComponent } from '../service-card/service-card.component';
import { ProjectService } from '../../services/project.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ServiceCardComponent, LucideAngularModule],
  template: `
    <div class="flex-1 flex flex-col h-full overflow-y-auto bg-rustic-50 dark:bg-rustic-900 p-6 transition-colors duration-300">
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

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
          @for (service of projectService.activeServices(); track service.id) {
            <app-service-card [service]="service" [projectId]="project.id"></app-service-card>
          }
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
}

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
    <div class="flex-1 flex flex-col h-full overflow-y-auto bg-hacker-900 p-6">
      @if (projectService.activeProject(); as project) {
        <div class="mb-8 flex flex-wrap justify-between gap-4 items-end border-b border-hacker-700 pb-4">
          <div>
            <h2 class="text-3xl font-bold text-neon-green tracking-tight">{{ project.name }}</h2>
            <p class="text-hacker-300 font-mono text-sm mt-2 flex items-center gap-2">
              <lucide-icon name="hard-drive" [size]="14"></lucide-icon>
              {{ project.rootPath }}
            </p>
          </div>

          <div class="flex flex-wrap gap-3 items-center">
            <button class="btn btn-secondary flex items-center gap-2 text-neon-green hover:text-green-400"
                    (click)="projectService.startAllServices(project.id)">
              <lucide-icon name="play" [size]="16"></lucide-icon>
              Start All
            </button>
            <button class="btn btn-secondary flex items-center gap-2 text-neon-yellow hover:text-yellow-300"
                    (click)="projectService.restartAllServices(project.id)">
              <lucide-icon name="refresh-cw" [size]="16"></lucide-icon>
              Restart All
            </button>
            <button class="btn btn-secondary flex items-center gap-2 text-neon-red hover:text-red-400"
                    (click)="projectService.stopAllServices(project.id)">
              <lucide-icon name="square" [size]="16"></lucide-icon>
              Stop All
            </button>

            <div class="bg-hacker-800 border border-hacker-700 rounded-md px-4 py-2 flex items-center gap-3">
              <lucide-icon name="server" [size]="18" class="text-neon-blue"></lucide-icon>
              <div class="flex flex-col">
                <span class="text-xs text-hacker-400 uppercase">Services</span>
                <span class="font-mono font-bold text-hacker-100">{{ projectService.activeServices().length }}</span>
              </div>
            </div>

            <div class="bg-hacker-800 border border-hacker-700 rounded-md px-4 py-2 flex items-center gap-3">
              <lucide-icon name="activity" [size]="18" class="text-neon-green"></lucide-icon>
              <div class="flex flex-col">
                <span class="text-xs text-hacker-400 uppercase">Running</span>
                <span class="font-mono font-bold text-hacker-100">{{ getRunningCount() }}</span>
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
        <div class="flex-1 flex items-center justify-center flex-col text-hacker-400">
          <lucide-icon name="server" [size]="64" class="mb-4 opacity-50"></lucide-icon>
          <h2 class="text-2xl font-bold text-hacker-300">No Project Selected</h2>
          <p class="mt-2 text-center max-w-xl">Select a project from the sidebar or press <kbd class="bg-hacker-800 px-2 py-1 rounded text-neon-green font-mono text-xs">Ctrl+K</kbd> to search projects and run commands.</p>
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

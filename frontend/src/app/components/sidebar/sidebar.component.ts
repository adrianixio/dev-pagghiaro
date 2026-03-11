import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ProjectService } from '../../services/project.service';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <aside class="w-72 max-w-[80vw] bg-hacker-800 border-r border-hacker-700 flex flex-col h-full">
      <div class="p-4 border-b border-hacker-700 flex items-center gap-3">
        <div class="w-9 h-9 bg-neon-green rounded-md flex items-center justify-center text-hacker-900 font-bold font-mono">
          DP
        </div>
        <div>
          <h1 class="text-xl font-bold text-neon-green tracking-wider">DevPagghiaro</h1>
          <p class="text-xs text-hacker-400 font-mono">Local microservice orchestrator</p>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-4 space-y-6">
        <div>
          <div class="flex items-center justify-between mb-2 gap-2">
            <h2 class="text-xs uppercase text-hacker-300 font-bold tracking-widest">Projects</h2>
            <div class="flex items-center gap-2">
              <button class="text-xs font-mono text-neon-green hover:text-green-300"
                      (click)="uiService.openNewProject()">
                + New
              </button>
              @if (projectService.activeProjectId(); as activeProjectId) {
                <button class="text-xs font-mono text-neon-blue hover:text-cyan-300"
                        (click)="uiService.openConfig(activeProjectId)">
                  Edit
                </button>
              }
            </div>
          </div>
          <ul class="space-y-1">
            @for (project of projectService.projects(); track project.id) {
              <li>
                <button
                  (click)="projectService.setActiveProject(project.id)"
                  class="w-full text-left px-3 py-2 rounded-md flex items-center gap-2 transition-colors"
                  [class.bg-hacker-700]="projectService.activeProjectId() === project.id"
                  [class.text-neon-green]="projectService.activeProjectId() === project.id"
                  [class.text-hacker-200]="projectService.activeProjectId() !== project.id"
                  [class.hover:bg-hacker-700]="projectService.activeProjectId() !== project.id"
                  [class.hover:text-hacker-100]="projectService.activeProjectId() !== project.id">
                  <lucide-icon name="folder" [size]="16"></lucide-icon>
                  <span class="truncate">{{ project.name }}</span>
                </button>
              </li>
            }
          </ul>
        </div>
      </div>

      <div class="p-4 border-t border-hacker-700">
        <button class="w-full text-left px-3 py-2 rounded-md flex items-center gap-2 text-hacker-200 hover:bg-hacker-700 hover:text-hacker-100 transition-colors"
                (click)="uiService.openConfig(projectService.activeProjectId())">
          <lucide-icon name="settings" [size]="16"></lucide-icon>
          <span>Configuration</span>
        </button>
      </div>
    </aside>
  `,
})
export class SidebarComponent {
  readonly projectService = inject(ProjectService);
  readonly uiService = inject(UiService);
}

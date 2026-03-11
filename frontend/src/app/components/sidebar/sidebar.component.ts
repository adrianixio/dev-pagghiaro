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
    <aside class="w-72 max-w-[80vw] bg-rustic-100 dark:bg-rustic-800 border-r border-rustic-200 dark:border-rustic-700 flex flex-col h-full transition-colors duration-300">
      <div class="p-4 border-b border-rustic-200 dark:border-rustic-700 flex items-center gap-3">
        <div class="w-9 h-9 bg-country-green rounded-md flex items-center justify-center text-rustic-50 font-bold font-sans">
          DP
        </div>
        <div>
          <h1 class="text-xl font-bold text-country-green tracking-wider">DevPagghiaro</h1>
          <p class="text-xs text-rustic-600 dark:text-rustic-400 font-sans">Local microservice orchestrator</p>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-4 space-y-6">
        <div>
          <div class="flex items-center justify-between mb-2 gap-2">
            <h2 class="text-xs uppercase text-rustic-500 dark:text-rustic-400 font-bold tracking-widest">Projects</h2>
            <div class="flex items-center gap-2">
              <button class="text-xs font-sans text-country-green hover:text-opacity-80"
                      (click)="uiService.openNewProject()">
                + New
              </button>
              @if (projectService.activeProjectId(); as activeProjectId) {
                <button class="text-xs font-sans text-country-blue hover:text-opacity-80"
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
                  [class.bg-rustic-200]="projectService.activeProjectId() === project.id"
                  [class.dark:bg-rustic-700]="projectService.activeProjectId() === project.id"
                  [class.text-country-green]="projectService.activeProjectId() === project.id"
                  [class.text-rustic-700]="projectService.activeProjectId() !== project.id"
                  [class.dark:text-rustic-300]="projectService.activeProjectId() !== project.id"
                  [class.hover:bg-rustic-200]="projectService.activeProjectId() !== project.id"
                  [class.dark:hover:bg-rustic-700]="projectService.activeProjectId() !== project.id"
                  [class.hover:text-rustic-900]="projectService.activeProjectId() !== project.id"
                  [class.dark:hover:text-rustic-100]="projectService.activeProjectId() !== project.id">
                  <lucide-icon name="folder" [size]="16"></lucide-icon>
                  <span class="truncate">{{ project.name }}</span>
                </button>
              </li>
            }
          </ul>
        </div>
      </div>

      <div class="p-4 border-t border-rustic-200 dark:border-rustic-700 space-y-1">
        <button class="w-full text-left px-3 py-2 rounded-md flex items-center gap-2 text-rustic-700 dark:text-rustic-300 hover:bg-rustic-200 dark:hover:bg-rustic-700 hover:text-rustic-900 dark:hover:text-rustic-100 transition-colors"
                (click)="uiService.openConfig(projectService.activeProjectId())">
          <lucide-icon name="settings" [size]="16"></lucide-icon>
          <span>Configuration</span>
        </button>
        <button class="w-full text-left px-3 py-2 rounded-md flex items-center gap-2 text-rustic-700 dark:text-rustic-300 hover:bg-rustic-200 dark:hover:bg-rustic-700 hover:text-rustic-900 dark:hover:text-rustic-100 transition-colors"
                (click)="uiService.toggleDarkMode()">
          <lucide-icon [name]="uiService.darkMode() ? 'sun' : 'moon'" [size]="16"></lucide-icon>
          <span>{{ uiService.darkMode() ? 'Light Mode' : 'Dark Mode' }}</span>
        </button>
      </div>
    </aside>
  `,
})
export class SidebarComponent {
  readonly projectService = inject(ProjectService);
  readonly uiService = inject(UiService);
}

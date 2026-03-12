import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ProjectService } from '../../services/project.service';
import { AppMetadataService } from '../../services/app-metadata.service';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <aside
      id="app-sidebar"
      class="fixed inset-y-0 left-0 z-40 flex h-full w-72 max-w-[85vw] flex-col border-r border-rustic-200 bg-rustic-100 shadow-xl transition-all duration-300 dark:border-rustic-700 dark:bg-rustic-800 md:static md:z-auto md:max-w-[80vw] md:translate-x-0 md:shadow-none"
      [class.translate-x-0]="!uiService.isMobile() || uiService.sidebarOpen()"
      [class.-translate-x-full]="uiService.isMobile() && !uiService.sidebarOpen()"
      [attr.aria-hidden]="uiService.isMobile() && !uiService.sidebarOpen() ? 'true' : null"
      [attr.inert]="uiService.isMobile() && !uiService.sidebarOpen() ? '' : null"
    >
      <div class="p-4 border-b border-rustic-200 dark:border-rustic-700 flex items-center gap-3">
        <div class="w-11 h-11 rounded-md overflow-hidden flex items-center justify-center">
          <img src="/logo.png" alt="DevPagghiaro logo" class="w-full h-full object-contain" />
        </div>
        <div class="min-w-0 flex-1">
          <h1 class="text-xl font-bold text-country-green tracking-wider">DevPagghiaro</h1>
          <p class="text-xs text-rustic-600 dark:text-rustic-400 font-sans">Local microservice orchestrator</p>
        </div>
        <button
          type="button"
          class="rounded-md p-2 text-rustic-500 transition-colors hover:bg-rustic-200 hover:text-rustic-900 dark:text-rustic-400 dark:hover:bg-rustic-700 dark:hover:text-rustic-100 md:hidden"
          (click)="uiService.closeSidebar()"
          aria-label="Close sidebar"
        >
          <lucide-icon name="x" [size]="18"></lucide-icon>
        </button>
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
                        (click)="openConfig(activeProjectId)">
                  Edit
                </button>
              }
            </div>
          </div>
          <ul class="space-y-1">
            @for (project of projectService.projects(); track project.id) {
              <li>
                <button
                  (click)="selectProject(project.id)"
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
                (click)="openConfig(projectService.activeProjectId())">
          <lucide-icon name="settings" [size]="16"></lucide-icon>
          <span>Configuration</span>
        </button>
        <button class="w-full text-left px-3 py-2 rounded-md flex items-center gap-2 text-rustic-700 dark:text-rustic-300 hover:bg-rustic-200 dark:hover:bg-rustic-700 hover:text-rustic-900 dark:hover:text-rustic-100 transition-colors"
                (click)="toggleDarkMode()">
          <lucide-icon [name]="uiService.darkMode() ? 'sun' : 'moon'" [size]="16"></lucide-icon>
          <span>{{ uiService.darkMode() ? 'Light Mode' : 'Dark Mode' }}</span>
        </button>

        @if (appMetadata.metadata(); as metadata) {
          <div class="px-3 pt-3 mt-3 border-t border-rustic-200 dark:border-rustic-700 text-[11px] leading-5 text-rustic-500 dark:text-rustic-400 font-sans">
            <div class="font-medium text-rustic-700 dark:text-rustic-200">v{{ metadata.version }}</div>
            @if (metadata.author) {
              <div>by {{ metadata.author }}</div>
            }
          </div>
        }
      </div>
    </aside>
  `,
})
export class SidebarComponent {
  readonly appMetadata = inject(AppMetadataService);
  readonly projectService = inject(ProjectService);
  readonly uiService = inject(UiService);

  selectProject(projectId: string): void {
    this.projectService.setActiveProject(projectId);
    this.uiService.closeSidebar();
  }

  openConfig(projectId: string | null): void {
    this.uiService.openConfig(projectId);
    this.uiService.closeSidebar();
  }

  toggleDarkMode(): void {
    this.uiService.toggleDarkMode();
    this.uiService.closeSidebar();
  }
}

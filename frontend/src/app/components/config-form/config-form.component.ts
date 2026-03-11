import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { EditableServiceDraft } from '../../models/config-form.model';
import { ProjectService } from '../../services/project.service';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-config-form',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-4xl bg-white dark:bg-rustic-800 border border-rustic-200 dark:border-rustic-700 rounded-xl shadow-2xl overflow-hidden flex flex-col mx-4 transition-colors duration-300">
        <div class="flex items-center justify-between px-6 py-4 border-b border-rustic-200 dark:border-rustic-700 bg-rustic-50 dark:bg-rustic-900 transition-colors duration-300">
          <div>
            <h2 class="text-xl font-bold text-country-green tracking-wider">{{ projectId ? 'Edit Project' : 'New Project' }}</h2>
            <p class="text-xs text-rustic-500 dark:text-rustic-400 font-sans mt-1">Manage projects and their services without editing JSON manually.</p>
          </div>
          <button class="p-2 rounded-md hover:bg-rustic-200 dark:hover:bg-rustic-700 text-rustic-400 dark:text-rustic-500 hover:text-rustic-900 dark:hover:text-rustic-100 transition-colors"
                  (click)="close()">
            <lucide-icon name="x" [size]="20"></lucide-icon>
          </button>
        </div>

        <div class="p-6 overflow-y-auto max-h-[70vh]">
          <form (ngSubmit)="save()" class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-sans font-medium text-rustic-700 dark:text-rustic-300 mb-2">Project Name</label>
                <input type="text" [(ngModel)]="projectName" name="projectName"
                       class="input-field" placeholder="e.g. My Awesome Project">
              </div>

              <div>
                <label class="block text-sm font-sans font-medium text-rustic-700 dark:text-rustic-300 mb-2">Project Path</label>
                <input type="text" [(ngModel)]="projectPath" name="projectPath"
                       class="input-field" placeholder="C:/dev/my-project">
              </div>
            </div>

            <div class="border-t border-rustic-200 dark:border-rustic-700 pt-6">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-bold text-rustic-900 dark:text-rustic-100">Services</h3>
                <button type="button" class="btn btn-secondary text-xs py-1" (click)="addService()">
                  + Add Service
                </button>
              </div>

              <div class="space-y-4">
                @for (service of services; track $index; let i = $index) {
                  <div class="p-4 bg-rustic-50 dark:bg-rustic-900 border border-rustic-200 dark:border-rustic-700 rounded-lg relative group transition-colors duration-300">
                    <button type="button" class="absolute top-2 right-2 p-1 text-rustic-400 dark:text-rustic-500 hover:text-country-red dark:hover:text-country-red opacity-0 group-hover:opacity-100 transition-opacity"
                            (click)="removeService(i)">
                      <lucide-icon name="x" [size]="16"></lucide-icon>
                    </button>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label class="block text-xs font-sans font-medium text-rustic-600 dark:text-rustic-400 mb-1">Service Name</label>
                        <input type="text" [(ngModel)]="service.name" [name]="'serviceName' + i"
                               class="input-field text-sm py-1.5" placeholder="e.g. api">
                      </div>
                      <div>
                        <label class="block text-xs font-sans font-medium text-rustic-600 dark:text-rustic-400 mb-1">Command</label>
                        <input type="text" [(ngModel)]="service.command" [name]="'serviceCommand' + i"
                               class="input-field text-sm py-1.5 font-mono" placeholder="e.g. bun run dev">
                      </div>
                      <div class="md:col-span-2">
                        <label class="block text-xs font-sans font-medium text-rustic-600 dark:text-rustic-400 mb-1">Working Directory</label>
                        <input type="text" [(ngModel)]="service.cwd" [name]="'serviceCwd' + i"
                               class="input-field text-sm py-1.5 font-mono" placeholder="e.g. apps/backend">
                      </div>
                      <label class="flex items-center gap-2 text-sm text-rustic-700 dark:text-rustic-300 font-sans md:col-span-2">
                        <input type="checkbox" [(ngModel)]="service.autoStart" [name]="'serviceAutoStart' + i"
                               class="rounded border-rustic-300 dark:border-rustic-600 bg-white dark:bg-rustic-800 text-country-green focus:ring-country-green">
                        Auto Start
                      </label>
                    </div>
                  </div>
                }
              </div>
            </div>

            <div class="flex justify-between gap-3 flex-wrap pt-4 border-t border-rustic-200 dark:border-rustic-700">
              <div>
                @if (projectId) {
                  <button type="button" class="btn btn-danger" (click)="removeProject()">Delete Project</button>
                }
              </div>
              <div class="flex gap-3">
                <button type="button" class="btn btn-secondary" (click)="close()">Cancel</button>
                <button type="submit" class="btn btn-primary flex items-center gap-2">
                  <lucide-icon name="save" [size]="16"></lucide-icon>
                  Save Configuration
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  `,
})
export class ConfigFormComponent {
  readonly projectService = inject(ProjectService);
  readonly uiService = inject(UiService);

  projectId?: string;
  projectName = '';
  projectPath = '';
  services: EditableServiceDraft[] = [];

  constructor() {
    const editingProject = this.projectService.getProjectById(this.uiService.editingProjectId());
    if (!editingProject) {
      return;
    }

    this.projectId = editingProject.id;
    this.projectName = editingProject.name;
    this.projectPath = editingProject.rootPath;
    this.services = editingProject.services.map((service) => ({
      id: service.id,
      name: service.name,
      command: service.command,
      cwd: service.cwd,
      autoStart: Boolean(service.autoStart),
    }));
  }

  addService(): void {
    this.services.push({
      name: '',
      command: '',
      cwd: '.',
      autoStart: false,
    });
  }

  removeService(index: number): void {
    this.services.splice(index, 1);
  }

  async save(): Promise<void> {
    if (!this.projectName.trim() || !this.projectPath.trim()) {
      return;
    }

    await this.projectService.saveProjectDraft({
      projectId: this.projectId,
      name: this.projectName,
      rootPath: this.projectPath,
      services: this.services,
    });
    this.uiService.closeConfig();
  }

  async removeProject(): Promise<void> {
    if (!this.projectId) {
      return;
    }
    await this.projectService.deleteProject(this.projectId);
    this.uiService.closeConfig();
  }

  close(): void {
    this.uiService.closeConfig();
  }
}

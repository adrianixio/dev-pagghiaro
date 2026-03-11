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
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div class="w-full max-w-4xl bg-hacker-800 border border-hacker-600 rounded-xl shadow-2xl overflow-hidden flex flex-col mx-4">
        <div class="flex items-center justify-between px-6 py-4 border-b border-hacker-700 bg-hacker-900">
          <div>
            <h2 class="text-xl font-bold text-neon-green tracking-wider">{{ projectId ? 'Edit Project' : 'New Project' }}</h2>
            <p class="text-xs text-hacker-400 font-mono mt-1">Manage projects and their services without editing JSON manually.</p>
          </div>
          <button class="p-2 rounded-md hover:bg-hacker-700 text-hacker-400 hover:text-hacker-100 transition-colors"
                  (click)="close()">
            <lucide-icon name="x" [size]="20"></lucide-icon>
          </button>
        </div>

        <div class="p-6 overflow-y-auto max-h-[70vh]">
          <form (ngSubmit)="save()" class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-mono text-hacker-300 mb-2">Project Name</label>
                <input type="text" [(ngModel)]="projectName" name="projectName"
                       class="input-field" placeholder="e.g. My Awesome Project">
              </div>

              <div>
                <label class="block text-sm font-mono text-hacker-300 mb-2">Project Path</label>
                <input type="text" [(ngModel)]="projectPath" name="projectPath"
                       class="input-field" placeholder="C:/dev/my-project">
              </div>
            </div>

            <div class="border-t border-hacker-700 pt-6">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-bold text-hacker-100">Services</h3>
                <button type="button" class="btn btn-secondary text-xs py-1" (click)="addService()">
                  + Add Service
                </button>
              </div>

              <div class="space-y-4">
                @for (service of services; track $index; let i = $index) {
                  <div class="p-4 bg-hacker-900 border border-hacker-700 rounded-lg relative group">
                    <button type="button" class="absolute top-2 right-2 p-1 text-hacker-500 hover:text-neon-red opacity-0 group-hover:opacity-100 transition-opacity"
                            (click)="removeService(i)">
                      <lucide-icon name="x" [size]="16"></lucide-icon>
                    </button>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label class="block text-xs font-mono text-hacker-400 mb-1">Service Name</label>
                        <input type="text" [(ngModel)]="service.name" [name]="'serviceName' + i"
                               class="input-field text-sm py-1.5" placeholder="e.g. api">
                      </div>
                      <div>
                        <label class="block text-xs font-mono text-hacker-400 mb-1">Command</label>
                        <input type="text" [(ngModel)]="service.command" [name]="'serviceCommand' + i"
                               class="input-field text-sm py-1.5" placeholder="e.g. bun run dev">
                      </div>
                      <div class="md:col-span-2">
                        <label class="block text-xs font-mono text-hacker-400 mb-1">Working Directory</label>
                        <input type="text" [(ngModel)]="service.cwd" [name]="'serviceCwd' + i"
                               class="input-field text-sm py-1.5" placeholder="e.g. apps/backend">
                      </div>
                      <label class="flex items-center gap-2 text-sm text-hacker-300 font-mono md:col-span-2">
                        <input type="checkbox" [(ngModel)]="service.autoStart" [name]="'serviceAutoStart' + i">
                        Auto Start
                      </label>
                    </div>
                  </div>
                }
              </div>
            </div>

            <div class="flex justify-between gap-3 flex-wrap">
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

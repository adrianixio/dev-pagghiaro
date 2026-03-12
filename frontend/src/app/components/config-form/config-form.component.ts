import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
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
  imports: [CommonModule, FormsModule, LucideAngularModule, CdkDropList, CdkDrag, CdkDragHandle],
  styles: [`
    .cdk-drag-preview {
      box-sizing: border-box;
      border-radius: 0.5rem;
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
    }
    .cdk-drag-placeholder {
      opacity: 0.3;
    }
    .cdk-drag-animating {
      transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
    }
    .space-y-4.cdk-drop-list-dragging .cdk-drag {
      transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
    }
  `],
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

              <div class="space-y-4" cdkDropList (cdkDropListDropped)="drop($event)">
                @for (service of services; track service.draftKey; let i = $index) {
                  <div cdkDrag class="p-4 bg-rustic-50 dark:bg-rustic-900 border border-rustic-200 dark:border-rustic-700 rounded-lg relative group transition-colors duration-300 flex gap-4">
                    <div class="flex items-center justify-center cursor-grab active:cursor-grabbing text-rustic-400 hover:text-rustic-600 dark:hover:text-rustic-300" cdkDragHandle>
                      <lucide-icon name="grip-vertical" [size]="20"></lucide-icon>
                    </div>
                    <div class="flex-1">
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
                        <div>
                          <label class="block text-xs font-sans font-medium text-rustic-600 dark:text-rustic-400 mb-1">Working Directory</label>
                          <input type="text" [(ngModel)]="service.cwd" [name]="'serviceCwd' + i"
                                 class="input-field text-sm py-1.5 font-mono" placeholder="e.g. apps/backend">
                        </div>
                        <div>
                          <label class="block text-xs font-sans font-medium text-rustic-600 dark:text-rustic-400 mb-1">Port (Optional)</label>
                          <input type="number" [(ngModel)]="service.port" [name]="'servicePort' + i"
                                 class="input-field text-sm py-1.5 font-mono" placeholder="e.g. 3000">
                        </div>
                        <label class="flex items-center gap-2 text-sm text-rustic-700 dark:text-rustic-300 font-sans md:col-span-2">
                          <input type="checkbox" [(ngModel)]="service.autoStart" [name]="'serviceAutoStart' + i"
                                 class="rounded border-rustic-300 dark:border-rustic-600 bg-white dark:bg-rustic-800 text-country-green focus:ring-country-green">
                          Auto Start
                        </label>
                        <div class="md:col-span-2 rounded-lg border border-dashed border-rustic-300 dark:border-rustic-600 bg-white/80 dark:bg-rustic-800/70 px-3 py-3">
                          <div class="flex flex-wrap items-center justify-between gap-3">
                            <label class="flex items-center gap-2 text-sm text-rustic-700 dark:text-rustic-300 font-sans">
                              <input type="checkbox" [(ngModel)]="service.includeInExecution" [name]="'serviceExecution' + i"
                                     class="rounded border-rustic-300 dark:border-rustic-600 bg-white dark:bg-rustic-800 text-country-green focus:ring-country-green">
                              Include in project execution order
                            </label>
                          </div>
                          <p class="mt-2 text-xs text-rustic-500 dark:text-rustic-400">
                            The current list order defines the custom project launch sequence for selected services.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                }
              </div>
            </div>

            <div class="border-t border-rustic-200 dark:border-rustic-700 pt-6">
              <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 class="text-lg font-bold text-rustic-900 dark:text-rustic-100">Execution Order</h3>
                  <p class="text-xs text-rustic-500 dark:text-rustic-400 font-sans mt-1">
                    Choose which services run in bulk start/restart and optionally wait between one launch and the next.
                  </p>
                </div>
                <div class="w-full md:w-56">
                  <label class="block text-xs font-sans font-medium text-rustic-600 dark:text-rustic-400 mb-1">Delay Between Services (ms)</label>
                  <input type="number" min="0" step="100" [(ngModel)]="executionDelayMs" name="executionDelayMs"
                         class="input-field text-sm py-1.5 font-mono" placeholder="0">
                </div>
              </div>

              <div class="mt-4 rounded-lg border border-rustic-200 dark:border-rustic-700 bg-rustic-50 dark:bg-rustic-900 px-4 py-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="text-xs uppercase tracking-[0.2em] text-rustic-500 dark:text-rustic-400">Launch Preview</div>
                  @if (projectId) {
                    <div class="text-[11px] font-sans"
                         [class.text-rustic-500]="executionOrderSaveState === 'idle'"
                         [class.dark:text-rustic-400]="executionOrderSaveState === 'idle'"
                         [class.text-country-blue]="executionOrderSaveState === 'saving'"
                         [class.text-country-green]="executionOrderSaveState === 'saved'"
                         [class.text-country-red]="executionOrderSaveState === 'error'">
                      @switch (executionOrderSaveState) {
                        @case ('saving') { Saving order... }
                        @case ('saved') { Order saved }
                        @case ('error') { Save failed }
                        @default { Drag to reorder }
                      }
                    </div>
                  }
                </div>
                @if (executionPreview().length > 0) {
                  <div class="mt-3 flex flex-wrap gap-2">
                    @for (serviceName of executionPreview(); track $index; let i = $index) {
                      <div class="flex items-center gap-2 rounded-full border border-rustic-300 dark:border-rustic-600 bg-white dark:bg-rustic-800 px-3 py-1 text-sm text-rustic-700 dark:text-rustic-200">
                        <span class="text-country-green font-semibold">{{ i + 1 }}</span>
                        <span>{{ serviceName }}</span>
                      </div>
                    }
                  </div>
                } @else {
                  <p class="mt-2 text-sm text-rustic-500 dark:text-rustic-400">No service selected for the custom execution order yet.</p>
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
  private autosaveTimer?: ReturnType<typeof setTimeout>;
  private autosaveInFlight = false;
  private autosaveQueued = false;
  private autosaveSuppressed = false;
  private autosavePromise: Promise<void> | null = null;

  projectId?: string;
  projectName = '';
  projectPath = '';
  services: EditableServiceDraft[] = [];
  executionDelayMs = 0;
  persistedExecutionDelayMs = 0;
  executionOrderSaveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle';

  constructor() {
    const editingProject = this.projectService.getProjectById(this.uiService.editingProjectId());
    if (!editingProject) {
      return;
    }

    this.projectId = editingProject.id;
    this.projectName = editingProject.name;
    this.projectPath = editingProject.rootPath;
    const orderedServiceIds = editingProject.executionOrder?.serviceIds ?? editingProject.services.map((service) => service.id);
    const executionIds = new Set(orderedServiceIds);
    this.executionDelayMs = editingProject.executionOrder?.delayMs ?? 0;
    this.persistedExecutionDelayMs = this.executionDelayMs;
    const serviceById = new Map(editingProject.services.map((service) => [service.id, service]));
    const orderedServices = orderedServiceIds
      .map((serviceId) => serviceById.get(serviceId))
      .filter((service): service is NonNullable<typeof service> => Boolean(service));
    const remainingServices = editingProject.services.filter((service) => !executionIds.has(service.id));

    this.services = [...orderedServices, ...remainingServices].map((service) => ({
      draftKey: service.id,
      id: service.id,
      name: service.name,
      command: service.command,
      cwd: service.cwd,
      port: service.port ?? null,
      autoStart: Boolean(service.autoStart),
      includeInExecution: executionIds.has(service.id),
    }));
  }

  addService(): void {
    this.services.push({
      draftKey: crypto.randomUUID(),
      name: '',
      command: '',
      cwd: '.',
      port: null,
      autoStart: false,
      includeInExecution: true,
    });
  }

  removeService(index: number): void {
    this.services.splice(index, 1);
  }

  drop(event: CdkDragDrop<EditableServiceDraft[]>): void {
    moveItemInArray(this.services, event.previousIndex, event.currentIndex);
    this.scheduleAutoSaveExecutionOrder();
  }

  executionPreview(): string[] {
    return this.services
      .filter((service) => service.includeInExecution && service.name.trim())
      .map((service) => service.name.trim());
  }

  async save(): Promise<void> {
    if (!this.canSaveDraft()) {
      return;
    }

    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = undefined;
    }
    this.autosaveQueued = false;
    this.autosaveSuppressed = true;

    if (this.autosavePromise) {
      try {
        await this.autosavePromise;
      } catch {
        // ignore autosave failure and continue with explicit save
      }
    }

    await this.projectService.saveProjectDraft(this.buildDraft());
    this.persistedExecutionDelayMs = this.executionDelayMs;
    this.executionOrderSaveState = 'idle';
    this.autosaveSuppressed = false;
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
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
    }
    this.uiService.closeConfig();
  }

  private canSaveDraft(): boolean {
    return Boolean(this.projectName.trim() && this.projectPath.trim());
  }

  private buildDraft() {
    return {
      projectId: this.projectId,
      name: this.projectName,
      rootPath: this.projectPath,
      services: this.services,
      executionDelayMs: this.executionDelayMs,
    };
  }

  private scheduleAutoSaveExecutionOrder(): void {
    if (this.autosaveSuppressed) {
      return;
    }

    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
    }

    this.executionOrderSaveState = 'saving';
    this.autosaveTimer = setTimeout(() => {
      void this.autoSaveExecutionOrder();
    }, 250);
  }

  private async autoSaveExecutionOrder(): Promise<void> {
    if (this.autosaveSuppressed || !this.projectId || !this.canSaveDraft()) {
      this.executionOrderSaveState = 'idle';
      return;
    }

    if (this.autosaveInFlight) {
      this.autosaveQueued = true;
      return;
    }

    this.autosaveInFlight = true;
    this.autosavePromise = (async () => {
      this.executionOrderSaveState = 'saving';
      try {
        await this.projectService.updateProjectExecutionOrder(
          this.projectId!,
          this.services
            .filter((service) => service.includeInExecution && Boolean(service.id))
            .map((service) => service.id as string),
          this.persistedExecutionDelayMs
        );
        this.executionOrderSaveState = 'saved';
      } catch {
        this.executionOrderSaveState = 'error';
      } finally {
        this.autosaveInFlight = false;
        this.autosavePromise = null;
        if (this.autosaveQueued && !this.autosaveSuppressed) {
          this.autosaveQueued = false;
          this.scheduleAutoSaveExecutionOrder();
        }
      }
    })();

    try {
      await this.autosavePromise;
    } finally {
      if (this.autosaveSuppressed) {
        this.autosaveQueued = false;
      }
    }
  }
}

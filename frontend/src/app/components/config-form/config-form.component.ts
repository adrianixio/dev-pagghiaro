import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { EditableServiceDraft } from '../../models/config-form.model';
import { ProjectService } from '../../services/project.service';
import { UiService } from '../../services/ui.service';
import { UiIconButtonComponent } from '../../ui/ui-icon-button.component';
import { UiBadgeComponent } from '../../ui/ui-badge.component';

@Component({
  selector: 'app-config-form',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, CdkDropList, CdkDrag, CdkDragHandle, UiIconButtonComponent, UiBadgeComponent],
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
      <div class="mx-4 flex w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-float transition-colors dark:border-rustic-700 dark:bg-rustic-800">
        <div class="flex items-center justify-between border-b border-border bg-surface px-6 py-4 transition-colors dark:border-rustic-700 dark:bg-rustic-900">
          <div>
            <h2 class="font-display text-xl font-bold tracking-wider text-accent">{{ projectId ? 'Edit Project' : 'New Project' }}</h2>
            <p class="mt-1 font-sans text-xs text-content-muted">Manage projects and their services without editing JSON manually.</p>
          </div>
          <ui-icon-button icon="x" label="Close" (click)="close()"></ui-icon-button>
        </div>

        <div class="max-h-[70vh] overflow-y-auto p-6">
          <form (ngSubmit)="save()" class="space-y-6">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label class="mb-2 block font-sans text-sm font-medium text-content dark:text-rustic-300">Project Name</label>
                <input type="text" [(ngModel)]="projectName" name="projectName"
                       class="input-field" placeholder="e.g. My Awesome Project">
              </div>

              <div>
                <label class="mb-2 block font-sans text-sm font-medium text-content dark:text-rustic-300">Project Path</label>
                <input type="text" [(ngModel)]="projectPath" name="projectPath"
                       class="input-field" placeholder="C:/dev/my-project">
              </div>
            </div>

            <div class="border-t border-border pt-6 dark:border-rustic-700">
              <div class="mb-4 flex items-center justify-between">
                <h3 class="font-display text-lg font-bold text-content dark:text-rustic-100">Services</h3>
                <button type="button" class="rounded-md border border-border bg-surface-raised px-2.5 py-1 text-xs font-semibold text-content-muted transition-colors hover:bg-rustic-100 dark:border-rustic-700 dark:bg-rustic-800 dark:text-rustic-200 dark:hover:bg-rustic-700"
                        (click)="addService()">
                  + Add Service
                </button>
              </div>

              <div class="space-y-4" cdkDropList (cdkDropListDropped)="drop($event)">
                @for (service of services; track service.draftKey; let i = $index) {
                  <div cdkDrag class="group relative flex gap-4 rounded-lg border border-border bg-surface p-4 transition-colors dark:border-rustic-700 dark:bg-rustic-900">
                    <div class="flex cursor-grab items-center justify-center text-content-muted hover:text-content active:cursor-grabbing" cdkDragHandle>
                      <lucide-icon name="grip-vertical" [size]="20"></lucide-icon>
                    </div>
                    <div class="flex-1">
                      <button type="button" class="absolute right-2 top-2 p-1 text-content-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                              (click)="removeService(i)">
                        <lucide-icon name="x" [size]="16"></lucide-icon>
                      </button>

                      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label class="mb-1 block font-sans text-xs font-medium text-content-muted">Service Name</label>
                          <input type="text" [(ngModel)]="service.name" [name]="'serviceName' + i"
                                 class="input-field py-1.5 text-sm" placeholder="e.g. api">
                        </div>
                        <div>
                          <label class="mb-1 block font-sans text-xs font-medium text-content-muted">Command</label>
                          <input type="text" [(ngModel)]="service.command" [name]="'serviceCommand' + i"
                                 class="input-field py-1.5 font-mono text-sm" placeholder="e.g. bun run dev">
                        </div>
                        <div>
                          <label class="mb-1 block font-sans text-xs font-medium text-content-muted">Working Directory</label>
                          <input type="text" [(ngModel)]="service.cwd" [name]="'serviceCwd' + i"
                                 class="input-field py-1.5 font-mono text-sm" placeholder="e.g. apps/backend">
                        </div>
                        <div>
                          <label class="mb-1 block font-sans text-xs font-medium text-content-muted">Port (Optional)</label>
                          <input type="number" [(ngModel)]="service.port" [name]="'servicePort' + i"
                                 class="input-field py-1.5 font-mono text-sm" placeholder="e.g. 3000">
                        </div>
                        <label class="flex items-center gap-2 font-sans text-sm text-content dark:text-rustic-300 md:col-span-2">
                          <input type="checkbox" [(ngModel)]="service.autoStart" [name]="'serviceAutoStart' + i"
                                 class="rounded border-border bg-surface-raised text-accent focus:ring-accent dark:border-rustic-600 dark:bg-rustic-800">
                          Auto Start
                        </label>
                        <div class="md:col-span-2">
                          <label class="flex items-center gap-2 font-sans text-sm text-content dark:text-rustic-300">
                            <input type="checkbox" [(ngModel)]="service.healthCheckEnabled" [name]="'hc-en-' + service.draftKey"
                                   class="rounded border-border bg-surface-raised text-accent focus:ring-accent dark:border-rustic-600 dark:bg-rustic-800">
                            Health Check
                          </label>
                          @if (service.healthCheckEnabled) {
                            <div class="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
                              <div>
                                <label class="mb-1 block font-sans text-xs font-medium text-content-muted">Health Check Path</label>
                                <input type="text" [(ngModel)]="service.healthCheckPath" [name]="'hc-path-' + service.draftKey"
                                       class="input-field py-1.5 font-mono text-sm" placeholder="/health">
                              </div>
                              <div>
                                <label class="mb-1 block font-sans text-xs font-medium text-content-muted">Interval (ms)</label>
                                <input type="number" [(ngModel)]="service.healthCheckIntervalMs" [name]="'hc-int-' + service.draftKey"
                                       class="input-field py-1.5 font-mono text-sm" placeholder="10000">
                              </div>
                            </div>
                          }
                        </div>
                        <div class="md:col-span-2">
                          <label class="flex items-center gap-2 font-sans text-sm text-content dark:text-rustic-300">
                            <input type="checkbox" [(ngModel)]="service.httpInspectEnabled" [name]="'http-en-' + service.draftKey"
                                   class="rounded border-border bg-surface-raised text-accent focus:ring-accent dark:border-rustic-600 dark:bg-rustic-800">
                            HTTP Inspect
                          </label>
                          @if (service.httpInspectEnabled) {
                            <div class="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
                              <div>
                                <label class="mb-1 block font-sans text-xs font-medium text-content-muted">Proxy Port</label>
                                <input type="number" [(ngModel)]="service.httpInspectProxyPort" [name]="'http-port-' + service.draftKey"
                                       class="input-field py-1.5 font-mono text-sm" placeholder="e.g. 4000">
                              </div>
                            </div>
                          }
                        </div>
                        <div class="md:col-span-2">
                          <label class="flex items-center gap-2 font-sans text-sm text-content dark:text-rustic-300">
                            <input type="checkbox" [(ngModel)]="service.debugEnabled" [name]="'dbg-en-' + service.draftKey"
                                   class="rounded border-border bg-surface-raised text-accent focus:ring-accent dark:border-rustic-600 dark:bg-rustic-800">
                            Debug
                          </label>
                          @if (service.debugEnabled) {
                            <div class="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
                              <div>
                                <label class="mb-1 block font-sans text-xs font-medium text-content-muted">Debug Port</label>
                                <input type="number" [(ngModel)]="service.debugPort" [name]="'dbg-port-' + service.draftKey"
                                       class="input-field py-1.5 font-mono text-sm" placeholder="e.g. 9229">
                              </div>
                            </div>
                          }
                        </div>
                        <div class="rounded-lg border border-dashed border-border bg-surface-raised/80 px-3 py-3 dark:border-rustic-600 dark:bg-rustic-800/70 md:col-span-2">
                          <div class="flex flex-wrap items-center justify-between gap-3">
                            <label class="flex items-center gap-2 font-sans text-sm text-content dark:text-rustic-300">
                              <input type="checkbox" [(ngModel)]="service.includeInExecution" [name]="'serviceExecution' + i"
                                     class="rounded border-border bg-surface-raised text-accent focus:ring-accent dark:border-rustic-600 dark:bg-rustic-800">
                              Include in project execution order
                            </label>
                          </div>
                          <p class="mt-2 text-xs text-content-muted">
                            The current list order defines the custom project launch sequence for selected services.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                }
              </div>
            </div>

            <div class="border-t border-border pt-6 dark:border-rustic-700">
              <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 class="font-display text-lg font-bold text-content dark:text-rustic-100">Execution Order</h3>
                  <p class="mt-1 font-sans text-xs text-content-muted">
                    Choose which services run in bulk start/restart and optionally wait between one launch and the next.
                  </p>
                </div>
                <div class="w-full md:w-56">
                  <label class="mb-1 block font-sans text-xs font-medium text-content-muted">Delay Between Services (ms)</label>
                  <input type="number" min="0" step="100" [(ngModel)]="executionDelayMs" name="executionDelayMs"
                         class="input-field py-1.5 font-mono text-sm" placeholder="0">
                </div>
              </div>

              <div class="mt-4 rounded-lg border border-border bg-surface px-4 py-3 dark:border-rustic-700 dark:bg-rustic-900">
                <div class="flex items-center justify-between gap-3">
                  <div class="text-xs uppercase tracking-[0.2em] text-content-muted">Launch Preview</div>
                  @if (projectId) {
                    <div class="text-[11px] font-sans"
                         [class.text-content-muted]="executionOrderSaveState === 'idle'"
                         [class.text-info]="executionOrderSaveState === 'saving'"
                         [class.text-accent]="executionOrderSaveState === 'saved'"
                         [class.text-danger]="executionOrderSaveState === 'error'">
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
                      <ui-badge tone="neutral">
                        <span class="font-semibold text-accent">{{ i + 1 }}</span>
                        <span>{{ serviceName }}</span>
                      </ui-badge>
                    }
                  </div>
                } @else {
                  <p class="mt-2 text-sm text-content-muted">No service selected for the custom execution order yet.</p>
                }
              </div>
            </div>

            <div class="flex flex-wrap justify-between gap-3 border-t border-border pt-4 dark:border-rustic-700">
              <div>
                @if (projectId) {
                  <button type="button" class="inline-flex items-center gap-2 rounded-md bg-danger px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-danger/90"
                          (click)="removeProject()">
                    Delete Project
                  </button>
                }
              </div>
              <div class="flex gap-3">
                <button type="button" class="inline-flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3.5 py-2 text-sm font-semibold text-content-muted transition-colors hover:bg-rustic-100 dark:border-rustic-700 dark:bg-rustic-800 dark:text-rustic-200 dark:hover:bg-rustic-700"
                        (click)="close()">
                  Cancel
                </button>
                <button type="submit" class="inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-accent/90">
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
      healthCheckEnabled: service.healthCheck?.enabled ?? false,
      healthCheckPath: service.healthCheck?.path ?? '/',
      healthCheckIntervalMs: service.healthCheck?.intervalMs ?? 10000,
      httpInspectEnabled: service.httpInspect?.enabled ?? false,
      httpInspectProxyPort: service.httpInspect?.proxyPort ?? null,
      debugEnabled: service.debug?.enabled ?? false,
      debugPort: service.debug?.port ?? null,
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
      healthCheckEnabled: false,
      healthCheckPath: '/',
      healthCheckIntervalMs: 10000,
      httpInspectEnabled: false,
      httpInspectProxyPort: null,
      debugEnabled: false,
      debugPort: null,
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

import { Injectable, computed, inject, signal } from '@angular/core';
import {
  BulkOperationResult,
  CreateProjectBody,
  CreateServiceBody,
  KillPortResult,
  ProjectConfig,
  ServiceMetrics as SharedServiceMetrics,
  ServiceState,
  UpdateProjectBody,
  UpdateServiceBody,
} from '@dev-pagghiaro/shared';
import { ProjectDraft } from '../models/config-form.model';
import { ServiceMetrics, ServiceStatus, UiProject } from '../models/project.model';
import { UiService } from './ui.service';

const API_BASE = '/api';

interface ReloadProjectContextResult {
  projectId: string;
  reloadedAt: string;
  restartedServiceIds: string[];
  runningServices: number;
}

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  private readonly projectsSignal = signal<UiProject[]>([]);
  private readonly activeProjectIdSignal = signal<string | null>(null);
  private readonly uiService = inject(UiService);

  readonly projects = this.projectsSignal.asReadonly();
  readonly activeProjectId = this.activeProjectIdSignal.asReadonly();
  readonly activeProject = computed(() => this.projectsSignal().find((project) => project.id === this.activeProjectIdSignal()) ?? null);
  readonly activeServices = computed(() => this.activeProject()?.services ?? []);

  constructor() {
    void this.loadProjects();
    this.startPolling();
  }

  setActiveProject(id: string | null): void {
    this.activeProjectIdSignal.set(id);
  }

  async loadProjects(): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/projects`);
      if (!response.ok) {
        throw new Error('Failed to fetch projects');
      }

      const projects = (await response.json()) as ProjectConfig[];
      const uiProjects: UiProject[] = projects.map((project) => ({
        ...project,
        services: project.services.map((service) => ({
          ...service,
          status: 'stopped' as ServiceStatus,
          metrics: { cpu: 0, ram: 0 },
        })),
      }));

      this.projectsSignal.set(uiProjects);

      const currentActiveProjectId = this.activeProjectIdSignal();
      const nextActiveProjectId = currentActiveProjectId && uiProjects.some((project) => project.id === currentActiveProjectId)
        ? currentActiveProjectId
        : (uiProjects[0]?.id ?? null);
      this.activeProjectIdSignal.set(nextActiveProjectId);

      await Promise.all(
        uiProjects.flatMap((project) =>
          project.services.map((service) => this.fetchServiceState(project.id, service.id))
        )
      );
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  }

  getProjectById(projectId: string | null): UiProject | null {
    if (!projectId) {
      return null;
    }
    return this.projectsSignal().find((project) => project.id === projectId) ?? null;
  }

  updateServiceStatus(projectId: string, serviceId: string, status: ServiceStatus): void {
    this.projectsSignal.update((projects) =>
      projects.map((project) =>
        project.id !== projectId
          ? project
          : {
              ...project,
              services: project.services.map((service) =>
                service.id === serviceId ? { ...service, status } : service
              ),
            }
      )
    );
  }

  updateServiceMetrics(projectId: string, serviceId: string, metrics: ServiceMetrics): void {
    this.projectsSignal.update((projects) =>
      projects.map((project) =>
        project.id !== projectId
          ? project
          : {
              ...project,
              services: project.services.map((service) =>
                service.id === serviceId ? { ...service, metrics } : service
              ),
            }
      )
    );
  }

  async fetchServiceState(projectId: string, serviceId: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/state`);
      if (!response.ok) {
        return;
      }
      const state = (await response.json()) as ServiceState;
      this.updateServiceStatus(projectId, serviceId, state.status);
    } catch (error) {
      console.error(`Error fetching state for service ${serviceId}:`, error);
    }
  }

  async fetchServiceMetrics(projectId: string, serviceId: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/metrics`);
      if (!response.ok) {
        return;
      }
      const metrics = (await response.json()) as SharedServiceMetrics;
      this.updateServiceMetrics(projectId, serviceId, {
        cpu: metrics.cpu,
        ram: metrics.memoryBytes / (1024 * 1024),
      });
    } catch {
      // No metrics yet.
    }
  }

  async startService(projectId: string, serviceId: string): Promise<void> {
    await this.runServiceAction(projectId, serviceId, 'start', 'restarting');
  }

  async stopService(projectId: string, serviceId: string): Promise<void> {
    // Optimistic update: show stopped immediately so the UI doesn't freeze for up to 5s
    this.updateServiceStatus(projectId, serviceId, 'stopped');
    this.updateServiceMetrics(projectId, serviceId, { cpu: 0, ram: 0 });
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/stop`, {
        method: 'POST',
      });
      // 404 means the process was already gone — treat as stopped, not error
      if (!response.ok && response.status !== 404) {
        await this.fetchServiceState(projectId, serviceId);
        return;
      }
      if (response.ok) {
        const state = (await response.json()) as ServiceState;
        this.updateServiceStatus(projectId, serviceId, state.status);
      }
    } catch (error) {
      console.error(`Error stopping service ${serviceId}:`, error);
      await this.fetchServiceState(projectId, serviceId);
    }
  }

  async restartService(projectId: string, serviceId: string): Promise<void> {
    await this.runServiceAction(projectId, serviceId, 'restart', 'restarting');
  }

  async killServicePort(projectId: string, serviceId: string): Promise<KillPortResult | null> {
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/kill-port`, {
        method: 'POST',
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as KillPortResult;
    } catch (error) {
      console.error(`Error killing port process for service ${serviceId}:`, error);
      return null;
    }
  }

  async startAllServices(projectId: string): Promise<void> {
    await this.runBulkOperation(projectId, 'start-all');
  }

  async stopAllServices(projectId: string): Promise<void> {
    // Optimistic: mark everything stopped immediately
    const project = this.getProjectById(projectId);
    for (const service of project?.services ?? []) {
      this.updateServiceStatus(projectId, service.id, 'stopped');
      this.updateServiceMetrics(projectId, service.id, { cpu: 0, ram: 0 });
    }
    await this.runBulkOperation(projectId, 'stop-all');
  }

  async restartAllServices(projectId: string): Promise<void> {
    await this.runBulkOperation(projectId, 'restart-all');
  }

  async reloadProjectContext(projectId: string): Promise<void> {
    try {
      const project = this.getProjectById(projectId);
      if (project) {
        for (const service of project.services) {
          if (service.status === 'running' || service.status === 'restarting') {
            this.updateServiceStatus(projectId, service.id, 'restarting');
          }
        }
      }

      const response = await fetch(`${API_BASE}/projects/${projectId}/reload-context`, {
        method: 'POST',
      });
      if (!response.ok) {
        if (project) {
          await Promise.all(project.services.map((service) => this.fetchServiceState(projectId, service.id)));
        }
        this.uiService.showToast('Reload failed', 'Could not refresh the project context.', 'error');
        return;
      }

      const result = (await response.json()) as ReloadProjectContextResult;

      if (project) {
        await Promise.all(project.services.map((service) => this.fetchServiceState(projectId, service.id)));
      }

      const restartedCount = result.runningServices ?? result.restartedServiceIds.length;
      const projectName = project?.name ?? 'the project';
      this.uiService.showToast(
        'Context reloaded',
        restartedCount === 1
          ? `Reloaded env files for ${projectName} and restarted 1 active service.`
          : `Reloaded env files for ${projectName} and restarted ${restartedCount} active services.`
      );
    } catch (error) {
      console.error(`Error reloading process context for project ${projectId}:`, error);
      const project = this.getProjectById(projectId);
      if (project) {
        await Promise.all(project.services.map((service) => this.fetchServiceState(projectId, service.id)));
      }
      this.uiService.showToast('Reload failed', 'Could not refresh the project context.', 'error');
    }
  }

  async updateProjectExecutionOrder(projectId: string, serviceIds: string[], delayMs: number): Promise<void> {
    await this.updateProject(projectId, {
      executionOrder: {
        serviceIds,
        delayMs,
      },
    });

    this.projectsSignal.update((projects) =>
      projects.map((project) =>
        project.id !== projectId
          ? project
          : {
              ...project,
              executionOrder: {
                serviceIds,
                delayMs,
              },
            }
      )
    );
  }

  async saveProjectDraft(draft: ProjectDraft): Promise<void> {
    const services = draft.services
      .map((service) => ({
        ...service,
        name: service.name.trim(),
        command: service.command.trim(),
        cwd: service.cwd.trim(),
      }))
      .filter((service) => service.name && service.command && service.cwd);

    const executionDelayMs = Math.max(0, Math.floor(draft.executionDelayMs || 0));

    let projectId = draft.projectId;
    if (projectId) {
      await this.updateProject(projectId, {
        name: draft.name.trim(),
        rootPath: draft.rootPath.trim(),
        executionOrder: {
          serviceIds: [],
          delayMs: executionDelayMs,
        },
      });
    } else {
      const createdProject = await this.createProject({
        name: draft.name.trim(),
        rootPath: draft.rootPath.trim(),
        executionOrder: {
          serviceIds: [],
          delayMs: executionDelayMs,
        },
      });
      projectId = createdProject.id;
    }

    const existingProject = this.getProjectById(projectId);
    const existingServices = new Map((existingProject?.services ?? []).map((service) => [service.id, service]));
    const retainedIds = new Set<string>();
    const serviceIdByDraftKey = new Map<string, string>();

    for (const service of services) {
      if (service.id && existingServices.has(service.id)) {
        retainedIds.add(service.id);
        serviceIdByDraftKey.set(service.draftKey, service.id);
        await this.updateService(projectId, service.id, {
          name: service.name,
          command: service.command,
          cwd: service.cwd,
          port: service.port ?? null,
          autoStart: service.autoStart,
          });
        } else {
          const createdService = await this.createService(projectId, {
            name: service.name,
            command: service.command,
            cwd: service.cwd,
            port: service.port ?? null,
            autoStart: service.autoStart,
          });
          retainedIds.add(createdService.id);
          serviceIdByDraftKey.set(service.draftKey, createdService.id);
        }
      }

    for (const service of existingServices.values()) {
      if (!retainedIds.has(service.id)) {
        await this.deleteService(projectId, service.id);
      }
    }

    const executionServiceIds = services
      .filter((service) => service.includeInExecution)
      .map((service) => serviceIdByDraftKey.get(service.draftKey))
      .filter((serviceId): serviceId is string => Boolean(serviceId));

    await this.updateProject(projectId, {
      executionOrder: {
        serviceIds: executionServiceIds,
        delayMs: executionDelayMs,
      },
    });

    await this.loadProjects();
    this.setActiveProject(projectId);
  }

  async deleteProject(projectId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/projects/${projectId}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) {
      throw new Error('Failed to delete project');
    }
    await this.loadProjects();
  }

  private startPolling(): void {
    setInterval(() => {
      for (const project of this.projectsSignal()) {
        for (const service of project.services) {
          if (service.status === 'running' || service.status === 'restarting') {
            void this.fetchServiceState(project.id, service.id);
            void this.fetchServiceMetrics(project.id, service.id);
          }
        }
      }
    }, 2000);
  }

  private async runBulkOperation(projectId: string, operation: 'start-all' | 'stop-all' | 'restart-all'): Promise<void> {
    try {
      const project = this.getProjectById(projectId);
      if (project && (operation === 'start-all' || operation === 'restart-all')) {
        for (const service of project.services) {
          this.updateServiceStatus(projectId, service.id, 'restarting');
        }
      }

      const response = await fetch(`${API_BASE}/projects/${projectId}/${operation}`, { method: 'POST' });
      if (!response.ok) {
        return;
      }
      const result = (await response.json()) as BulkOperationResult;
      for (const state of result.results) {
        this.updateServiceStatus(projectId, state.serviceId, state.status);
      }
    } catch (error) {
      console.error(`Error running bulk operation ${operation} for project ${projectId}:`, error);
    }
  }

  private async runServiceAction(
    projectId: string,
    serviceId: string,
    action: 'start' | 'stop' | 'restart',
    optimisticStatus?: ServiceStatus
  ): Promise<void> {
    try {
      if (optimisticStatus) {
        this.updateServiceStatus(projectId, serviceId, optimisticStatus);
      }
      const response = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}/${action}`, {
        method: 'POST',
      });
      if (!response.ok) {
        this.updateServiceStatus(projectId, serviceId, 'error');
        return;
      }
      const state = (await response.json()) as ServiceState;
      this.updateServiceStatus(projectId, serviceId, state.status);
    } catch (error) {
      console.error(`Error running ${action} for service ${serviceId}:`, error);
      this.updateServiceStatus(projectId, serviceId, 'error');
    }
  }

  private async createProject(body: CreateProjectBody): Promise<ProjectConfig> {
    const response = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error('Failed to create project');
    }
    return (await response.json()) as ProjectConfig;
  }

  private async updateProject(projectId: string, body: UpdateProjectBody): Promise<void> {
    const response = await fetch(`${API_BASE}/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error('Failed to update project');
    }
  }

  private async createService(projectId: string, body: CreateServiceBody): Promise<{ id: string }> {
    const response = await fetch(`${API_BASE}/projects/${projectId}/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error('Failed to create service');
    }
    return (await response.json()) as { id: string };
  }

  async setServiceDebug(projectId: string, serviceId: string, enabled: boolean): Promise<void> {
    await this.updateService(projectId, serviceId, { debug: enabled });
    this.projectsSignal.update((projects) =>
      projects.map((project) => {
        if (project.id !== projectId) return project;
        return {
          ...project,
          services: project.services.map((service) =>
            service.id === serviceId ? { ...service, debug: enabled } : service
          ),
        };
      })
    );
  }

  async setServicePersistDebugWatches(
    projectId: string,
    serviceId: string,
    enabled: boolean
  ): Promise<void> {
    await this.updateService(projectId, serviceId, { persistDebugWatches: enabled });
    this.projectsSignal.update((projects) =>
      projects.map((project) => {
        if (project.id !== projectId) return project;
        return {
          ...project,
          services: project.services.map((service) =>
            service.id === serviceId ? { ...service, persistDebugWatches: enabled } : service
          ),
        };
      })
    );
  }

  private async updateService(projectId: string, serviceId: string, body: UpdateServiceBody): Promise<void> {
    const response = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error('Failed to update service');
    }
  }

  private async deleteService(projectId: string, serviceId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/projects/${projectId}/services/${serviceId}`, {
      method: 'DELETE',
    });
    if (!response.ok && response.status !== 204) {
      throw new Error('Failed to delete service');
    }
  }
}

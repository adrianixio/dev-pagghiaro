export interface EditableServiceDraft {
  draftKey: string;
  id?: string;
  name: string;
  command: string;
  cwd: string;
  port?: number | null;
  autoStart: boolean;
  includeInExecution: boolean;
  healthCheckEnabled: boolean;
  healthCheckPath: string;
  healthCheckIntervalMs: number;
  httpInspectEnabled: boolean;
  httpInspectProxyPort: number | null;
}

export interface ProjectDraft {
  projectId?: string;
  name: string;
  rootPath: string;
  services: EditableServiceDraft[];
  executionDelayMs: number;
}

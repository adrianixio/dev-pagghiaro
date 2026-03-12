export interface EditableServiceDraft {
  draftKey: string;
  id?: string;
  name: string;
  command: string;
  cwd: string;
  port?: number | null;
  autoStart: boolean;
  includeInExecution: boolean;
}

export interface ProjectDraft {
  projectId?: string;
  name: string;
  rootPath: string;
  services: EditableServiceDraft[];
  executionDelayMs: number;
}

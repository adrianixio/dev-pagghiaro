export interface EditableServiceDraft {
  draftKey: string;
  id?: string;
  name: string;
  command: string;
  cwd: string;
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

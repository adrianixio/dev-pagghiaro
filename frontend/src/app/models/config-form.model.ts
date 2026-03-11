export interface EditableServiceDraft {
  id?: string;
  name: string;
  command: string;
  cwd: string;
  autoStart: boolean;
}

export interface ProjectDraft {
  projectId?: string;
  name: string;
  rootPath: string;
  services: EditableServiceDraft[];
}

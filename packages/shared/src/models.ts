export type ServiceStatus = 'stopped' | 'running' | 'error' | 'restarting';

export interface ServiceConfig {
  id: string;
  name: string;
  command: string;
  cwd: string;
  env?: Record<string, string>;
  autoStart?: boolean;
  port?: number | null;
  color?: string;
}

export interface ProjectConfig {
  id: string;
  name: string;
  rootPath: string;
  services: ServiceConfig[];
  executionOrder?: ProjectExecutionOrder;
  createdAt: string;
}

export interface ProjectExecutionOrder {
  serviceIds: string[];
  delayMs?: number;
}

export interface PagghiaroConfig {
  version: '1';
  projects: ProjectConfig[];
}

export interface ServiceMetrics {
  serviceId: string;
  cpu: number;
  memoryBytes: number;
  measuredAt: number;
}

export interface ServiceState {
  serviceId: string;
  projectId: string;
  status: ServiceStatus;
  pid?: number;
  startedAt?: string;
  lastExitCode?: number;
  metrics?: ServiceMetrics;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export type CreateProjectBody = Omit<ProjectConfig, 'id' | 'createdAt' | 'services'>;
export type UpdateProjectBody = Partial<Omit<ProjectConfig, 'id' | 'createdAt' | 'services'>>;

export type CreateServiceBody = Omit<ServiceConfig, 'id'>;
export type UpdateServiceBody = Partial<Omit<ServiceConfig, 'id'>>;

export interface ApiError {
  error: string;
  message: string;
}

export interface BulkOperationResult {
  projectId: string;
  results: ServiceState[];
  succeeded: number;
  failed: number;
}

export interface AppMetadata {
  name: string;
  version: string;
  author?: string;
}

export interface KillPortResult {
  serviceId: string;
  port: number;
  pids: number[];
  killed: number[];
  failed: Array<{ pid: number; reason: string }>;
}

export type WsClientMessage =
  | { type: 'subscribe'; serviceId: string }
  | { type: 'unsubscribe'; serviceId: string }
  | { type: 'input'; serviceId: string; data: string }
  | { type: 'resize'; serviceId: string; cols: number; rows: number }
  | { type: 'clear'; serviceId: string };

export type WsServerMessage =
  | { type: 'log'; serviceId: string; data: string; timestamp: number }
  | { type: 'status'; serviceId: string; status: ServiceStatus; pid?: number }
  | { type: 'metrics'; payload: ServiceMetrics }
  | { type: 'cleared'; serviceId: string; timestamp: number }
  | { type: 'error'; serviceId: string; message: string };

export type LogSeverity = 'info' | 'warn' | 'error';

export interface StructuredLine {
  seq: number;         // monotono per servizio, per ordinamento stabile
  serviceId: string;
  projectId: string;
  timestamp: number;
  raw: string;         // riga con ANSI intatto (rendering)
  text: string;        // riga con ANSI strippato (ricerca/classificazione)
  severity: LogSeverity;
  eventHead: boolean;  // true = prima riga di un evento o riga singola
  kind: 'log' | 'marker';
}

export interface LogQuery {
  serviceIds: string[];   // >1 => merge cross-servizio
  q?: string;
  regex?: boolean;
  severity?: LogSeverity; // soglia minima: >= (info=tutte, error=solo error)
  since?: number;
  limit?: number;
}

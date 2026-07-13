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
  healthCheck?: HealthCheckConfig;
  httpInspect?: HttpInspectConfig;
  debug?: DebugConfig;
  debugWatches?: DebugWatch[];
  persistDebugWatches?: boolean;
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
  health?: ServiceHealth;
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

export type HealthState = 'unknown' | 'up' | 'down';

export interface HealthCheckConfig {
  enabled?: boolean;
  path?: string;
  intervalMs?: number;
}

export interface ServiceHealth {
  state: HealthState;
  checkedAt?: number;
  statusCode?: number;
  detail?: string;
}

export interface EnvVarProvenance {
  key: string;
  value: string;
  source: string;
  shadowed: Array<{ source: string; value: string }>;
}

export interface CommandExpansion {
  raw: string;
  shell: string;
  argv: string[];
}

export interface CwdInfo {
  raw: string;
  resolved: string;
  exists: boolean;
}

export interface PortInfo {
  configured: number;
  inUse: boolean;
  pids: number[];
}

export interface ServiceRuntimeInfo {
  status: ServiceStatus;
  pid?: number;
  startedAt?: string;
  uptimeMs?: number;
  lastExitCode?: number;
}

export interface ServiceIntrospection {
  serviceId: string;
  projectId: string;
  cwd: CwdInfo;
  command: CommandExpansion;
  env: EnvVarProvenance[];
  port: PortInfo | null;
  runtime: ServiceRuntimeInfo;
  health: ServiceHealth;
}

export type HttpExchangeSource = 'proxy' | 'console';

export interface HttpHeader { name: string; value: string; }

export interface HttpCapturedBody {
  text?: string;
  truncated?: boolean;
  binary?: boolean;
  byteLength?: number;
}

export interface HttpRequestRecord {
  method: string;
  path: string;
  headers: HttpHeader[];
  body?: HttpCapturedBody;
}

export interface HttpResponseRecord {
  status: number;
  headers: HttpHeader[];
  body?: HttpCapturedBody;
  durationMs: number;
}

export interface HttpExchange {
  id: string;
  serviceId: string;
  source: HttpExchangeSource;
  startedAt: number;
  request: HttpRequestRecord;
  response?: HttpResponseRecord;
  error?: string;
}

export interface HttpInspectConfig {
  enabled?: boolean;
  proxyPort?: number;
}

export interface DebugConfig {
  enabled?: boolean;
  port?: number;
}

// ─── Debug / variable watch ───────────────────────────────────────────────────

export type DebugLanguage = 'node' | 'bun' | 'python';

export type DebugWatchMode = 'interval' | 'onChange';

export interface DebugWatch {
  id: string;
  serviceId: string;
  expr: string;
  mode: DebugWatchMode;
  intervalMs: number;
  bufferSize: number;
  createdAt: number;
  /**
   * Optional thread filter. Currently honoured only by the Python (DAP)
   * adapter — Node/Bun evaluate against the inspector context. If unset, the
   * adapter targets the main thread.
   */
  threadName?: string;
  /** Friendly display name. Falls back to `expr` when absent. */
  label?: string;
  /**
   * User-supplied group key. When set, overrides the auto-derived first-identifier
   * source so multiple unrelated expressions can be clustered together (e.g.
   * "Request lifecycle"). Honoured by the panel's group-by-source view.
   */
  groupName?: string;
  /**
   * Optional gating expression evaluated alongside `expr`. Sample is pushed
   * only when the condition is truthy. Honoured by the `interval` mode of
   * both adapters; ignored in `onChange` mode for now.
   */
  condition?: string;
}

export interface DebugSample {
  watchId: string;
  t: number;
  value?: unknown;
  error?: string;
  /** Set by the registry when this sample's value differs from the previous one. */
  valueChanged?: boolean;
}

export type DebugAdapterStatus =
  | 'detached'
  | 'attaching'
  | 'attached'
  | 'unsupported'
  | 'error';

export interface DebugSessionState {
  serviceId: string;
  language: DebugLanguage | null;
  status: DebugAdapterStatus;
  message?: string;
  watches: DebugWatch[];
}

export type CreateDebugWatchBody = Pick<DebugWatch, 'expr'> &
  Partial<Pick<DebugWatch, 'mode' | 'intervalMs' | 'bufferSize' | 'threadName' | 'label' | 'condition' | 'groupName'>>;

export interface BulkCreateDebugWatchesBody {
  watches: CreateDebugWatchBody[];
}

export interface BulkCreateDebugWatchesResult {
  added: DebugWatch[];
  failed: Array<{ index: number; expr: string | null; error: string }>;
}

export interface DebugWatchPreset {
  id: string;
  name: string;
  description: string;
  /** Languages this preset is meaningful for. Empty = always available. */
  languages: DebugLanguage[];
  watches: CreateDebugWatchBody[];
}

export type DebugWsClientMessage =
  | { type: 'subscribe'; serviceId: string }
  | { type: 'unsubscribe'; serviceId: string };

export type DebugWsServerMessage =
  | { type: 'session'; payload: DebugSessionState }
  | { type: 'watch-added'; payload: DebugWatch }
  | { type: 'watch-removed'; serviceId: string; watchId: string }
  | { type: 'watch-history'; serviceId: string; watchId: string; samples: DebugSample[] }
  | { type: 'sample'; payload: DebugSample }
  | { type: 'recording-started'; payload: DebugRecordingSummary }
  | { type: 'recording-stopped'; payload: DebugRecordingSummary }
  | { type: 'recording-removed'; serviceId: string; recordingId: string }
  | { type: 'error'; serviceId: string; message: string };

// ─── Debug recordings ─────────────────────────────────────────────────────────

export interface DebugRecordingTrack {
  watch: DebugWatch;
  samples: DebugSample[];
}

export interface DebugRecordingLogEntry {
  t: number;
  data: string;
}

export interface DebugRecordingStatusChange {
  t: number;
  status: ServiceStatus;
  pid?: number;
}

export type DebugRecordingKind = 'manual' | 'auto';

export interface DebugScopeVariable {
  name: string;
  value: string;
  type?: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'function' | 'array' | 'unknown';
}

export interface DebugScopeFrame {
  file: string;
  line: number;
  function: string;
  locals: DebugScopeVariable[];
  closures: DebugScopeVariable[];
}

export interface DebugScopeSnapshot {
  t: number;
  frames: DebugScopeFrame[];
  userGlobals: DebugScopeVariable[];
  error?: string;
}

export interface DebugRecording {
  id: string;
  serviceId: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  kind?: DebugRecordingKind;
  /** Per-watch captured samples — populated live while recording is active. */
  tracks: DebugRecordingTrack[];
  /** Populated for auto recordings. */
  snapshots?: DebugScopeSnapshot[];
  /** Captured stdout/stderr lines (when `includeLogs` was requested at start). */
  logs?: DebugRecordingLogEntry[];
  /** Captured process metrics (when `includeMetrics` was requested). */
  metrics?: ServiceMetrics[];
  /** Captured status transitions (when `includeStatus` was requested). */
  statusChanges?: DebugRecordingStatusChange[];
}

/** Lightweight summary for list / WS push (no sample arrays). */
export interface DebugRecordingSummary {
  id: string;
  serviceId: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  kind?: DebugRecordingKind;
  watchCount: number;
  sampleCount: number;
  snapshotCount?: number;
  logCount?: number;
  metricCount?: number;
  statusCount?: number;
  includeLogs?: boolean;
  includeMetrics?: boolean;
  includeStatus?: boolean;
}

export interface CreateDebugRecordingBody {
  name?: string;
  includeLogs?: boolean;
  includeMetrics?: boolean;
  includeStatus?: boolean;
  kind?: DebugRecordingKind;
  autoIntervalMs?: number;
  autoMaxSnapshots?: number;
  autoFrameDepth?: number;
  includeUserGlobals?: boolean;
  includeClosures?: boolean;
  excludeFrameRegex?: string;
}

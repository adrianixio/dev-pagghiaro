import { Injectable, computed, signal } from '@angular/core';
import type {
  BulkCreateDebugWatchesResult,
  CreateDebugWatchBody,
  DebugRecording,
  DebugRecordingSummary,
  DebugSample,
  DebugSessionState,
  DebugWatch,
  DebugWsServerMessage,
} from '@dev-pagghiaro/shared';

const API_BASE = '/api';
const WS_BASE = '/ws/debug';

export type DebugHistoryExportFormat = 'json' | 'csv';

export interface AutoRecordingOptions {
  name?: string;
  autoIntervalMs?: number;
  autoMaxSnapshots?: number;
  autoFrameDepth?: number;
  includeUserGlobals?: boolean;
  includeClosures?: boolean;
  excludeFrameRegex?: string;
}

export interface DebugWatchUiState {
  paused: boolean;
  pausedHistory: DebugSample[] | null;
  historyExpanded: boolean;
  exportFrom: string;
  exportTo: string;
}

interface ServiceDebugUiState {
  groupBySource: boolean;
  watchOrder: string[];
  watchLocal: Record<string, DebugWatchUiState>;
}

export interface ServiceDebugState {
  session: DebugSessionState;
  history: Record<string, DebugSample[]>;
  ui: ServiceDebugUiState;
  recordings: ServiceRecordingsState;
}

export interface ServiceRecordingsState {
  active: DebugRecordingSummary | null;
  finished: DebugRecordingSummary[];
}

export type DebugPanelRow =
  | { kind: 'header'; key: string; source: string }
  | { kind: 'watch'; key: string; source: string; watch: DebugWatch };

interface WatchRangePatch {
  exportFrom?: string;
  exportTo?: string;
}

interface DebugHistoryExportRequest {
  from: number;
  to: number;
  format: DebugHistoryExportFormat;
}

const createEmptyWatchUiState = (): DebugWatchUiState => ({
  paused: false,
  pausedHistory: null,
  historyExpanded: false,
  exportFrom: '',
  exportTo: '',
});

const createEmptyUiState = (): ServiceDebugUiState => ({
  groupBySource: false,
  watchOrder: [],
  watchLocal: {},
});

const EMPTY_STATE = (serviceId: string): ServiceDebugState => ({
  session: { serviceId, language: null, status: 'detached', watches: [] },
  history: {},
  ui: createEmptyUiState(),
  recordings: { active: null, finished: [] },
});

@Injectable({ providedIn: 'root' })
export class DebugService {
  private readonly statesSignal = signal<Record<string, ServiceDebugState>>({});
  private readonly wsConnections = new Map<string, WebSocket>();

  snapshot(serviceId: string): ServiceDebugState {
    return this.statesSignal()[serviceId] ?? EMPTY_STATE(serviceId);
  }

  state(serviceId: string) {
    return computed(() => this.snapshot(serviceId));
  }

  attach(serviceId: string): void {
    if (this.wsConnections.has(serviceId)) return;

    this.statesSignal.update((all) => ({
      ...all,
      [serviceId]: this.normaliseState(all[serviceId] ?? EMPTY_STATE(serviceId)),
    }));

    const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${globalThis.location.host}${WS_BASE}/${serviceId}`);
    this.wsConnections.set(serviceId, ws);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as DebugWsServerMessage;
        this.applyMessage(serviceId, message);
      } catch (error) {
        console.error('Debug WS parse error:', error);
      }
    };

    ws.onclose = () => {
      this.wsConnections.delete(serviceId);
      this.updateState(serviceId, (current) => ({
        ...current,
        session: {
          ...current.session,
          status: 'detached',
          message: current.session.message,
        },
      }));
    };
  }

  detach(serviceId: string): void {
    const ws = this.wsConnections.get(serviceId);
    if (ws) {
      ws.close();
      this.wsConnections.delete(serviceId);
    }
  }

  async addWatch(serviceId: string, body: CreateDebugWatchBody): Promise<DebugWatch | null> {
    const response = await fetch(`${API_BASE}/services/${serviceId}/debug/watches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error('addWatch failed', await response.text());
      return null;
    }
    return (await response.json()) as DebugWatch;
  }

  async removeWatch(serviceId: string, watchId: string): Promise<void> {
    await fetch(`${API_BASE}/services/${serviceId}/debug/watches/${watchId}`, {
      method: 'DELETE',
    });
  }

  async addWatchesBulk(
    serviceId: string,
    watches: CreateDebugWatchBody[],
  ): Promise<BulkCreateDebugWatchesResult | null> {
    if (watches.length === 0) return { added: [], failed: [] };
    const response = await fetch(`${API_BASE}/services/${serviceId}/debug/watches/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watches }),
    });
    if (!response.ok) {
      console.error('addWatchesBulk failed', await response.text());
      return null;
    }
    return (await response.json()) as BulkCreateDebugWatchesResult;
  }

  /** Strip server-assigned fields so a preset round-trips cleanly. */
  presetFromWatches(watches: DebugWatch[]): CreateDebugWatchBody[] {
    return watches.map((watch) => {
      const body: CreateDebugWatchBody = {
        expr: watch.expr,
        mode: watch.mode,
        intervalMs: watch.intervalMs,
        bufferSize: watch.bufferSize,
      };
      if (watch.threadName) body.threadName = watch.threadName;
      if (watch.label) body.label = watch.label;
      if (watch.condition) body.condition = watch.condition;
      if (watch.groupName) body.groupName = watch.groupName;
      return body;
    });
  }

  async refreshRecordings(serviceId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/services/${serviceId}/debug/recordings`);
    if (!response.ok) return;
    const payload = (await response.json()) as ServiceRecordingsState;
    this.updateState(serviceId, (current) => ({ ...current, recordings: payload }));
  }

  async startRecording(
    serviceId: string,
    options?: { name?: string; includeLogs?: boolean; includeMetrics?: boolean; includeStatus?: boolean; kind?: 'manual' | 'auto'; autoIntervalMs?: number; autoMaxSnapshots?: number; autoFrameDepth?: number; includeUserGlobals?: boolean; includeClosures?: boolean; excludeFrameRegex?: string }
  ): Promise<DebugRecordingSummary | null> {
    const body: Record<string, unknown> = {};
    if (options?.name) body['name'] = options.name;
    if (options?.includeLogs) body['includeLogs'] = true;
    if (options?.includeMetrics) body['includeMetrics'] = true;
    if (options?.includeStatus) body['includeStatus'] = true;
    if (options?.kind) body['kind'] = options.kind;
    if (options?.autoIntervalMs !== undefined) body['autoIntervalMs'] = options.autoIntervalMs;
    if (options?.autoMaxSnapshots !== undefined) body['autoMaxSnapshots'] = options.autoMaxSnapshots;
    if (options?.autoFrameDepth !== undefined) body['autoFrameDepth'] = options.autoFrameDepth;
    if (options?.includeUserGlobals !== undefined) body['includeUserGlobals'] = options.includeUserGlobals;
    if (options?.includeClosures !== undefined) body['includeClosures'] = options.includeClosures;
    if (options?.excludeFrameRegex) body['excludeFrameRegex'] = options.excludeFrameRegex;
    const response = await fetch(`${API_BASE}/services/${serviceId}/debug/recordings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error('startRecording failed', await response.text());
      return null;
    }
    return (await response.json()) as DebugRecordingSummary;
  }

  async startAutoRecording(serviceId: string, options?: AutoRecordingOptions): Promise<DebugRecordingSummary | null> {
    return this.startRecording(serviceId, {
      kind: 'auto',
      name: options?.name,
      autoIntervalMs: options?.autoIntervalMs,
      autoMaxSnapshots: options?.autoMaxSnapshots,
      autoFrameDepth: options?.autoFrameDepth,
      includeUserGlobals: options?.includeUserGlobals,
      includeClosures: options?.includeClosures,
      excludeFrameRegex: options?.excludeFrameRegex,
    });
  }

  async stopRecording(serviceId: string, recordingId: string): Promise<void> {
    await fetch(`${API_BASE}/services/${serviceId}/debug/recordings/${recordingId}/stop`, {
      method: 'POST',
    });
  }

  async deleteRecording(serviceId: string, recordingId: string): Promise<void> {
    await fetch(`${API_BASE}/services/${serviceId}/debug/recordings/${recordingId}`, {
      method: 'DELETE',
    });
  }

  async getRecording(serviceId: string, recordingId: string): Promise<DebugRecording | null> {
    const response = await fetch(`${API_BASE}/services/${serviceId}/debug/recordings/${recordingId}`);
    if (!response.ok) {
      console.error('getRecording failed', await response.text());
      return null;
    }
    return (await response.json()) as DebugRecording;
  }

  async exportRecording(
    serviceId: string,
    recording: DebugRecordingSummary,
    format: DebugHistoryExportFormat,
  ): Promise<{ blob: Blob; filename: string } | null> {
    const url = `${API_BASE}/services/${serviceId}/debug/recordings/${recording.id}?format=${format}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error('exportRecording failed', await response.text());
      return null;
    }
    const safeName = recording.name.replace(/[^A-Za-z0-9_.-]+/g, '_');
    if (format === 'csv') {
      const text = await response.text();
      return { blob: new Blob([text], { type: 'text/csv' }), filename: `${safeName}.csv` };
    }
    const json = await response.json();
    return {
      blob: new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
      filename: `${safeName}.json`,
    };
  }

  viewHistory(serviceId: string, watchId: string): DebugSample[] {
    const state = this.snapshot(serviceId);
    const watchUi = state.ui.watchLocal[watchId];
    if (watchUi?.paused && watchUi.pausedHistory) {
      return watchUi.pausedHistory;
    }
    return state.history[watchId] ?? [];
  }

  watchUiState(serviceId: string, watchId: string): DebugWatchUiState {
    return this.snapshot(serviceId).ui.watchLocal[watchId] ?? createEmptyWatchUiState();
  }

  orderedWatches(serviceId: string): DebugWatch[] {
    const state = this.snapshot(serviceId);
    const byId = new Map(state.session.watches.map((watch) => [watch.id, watch]));
    const ordered: DebugWatch[] = [];

    for (const watchId of state.ui.watchOrder) {
      const watch = byId.get(watchId);
      if (watch) {
        ordered.push(watch);
        byId.delete(watchId);
      }
    }

    ordered.push(...byId.values());
    return ordered;
  }

  orderedWatchIds(serviceId: string): string[] {
    return this.orderedWatches(serviceId).map((watch) => watch.id);
  }

  buildWatchRows(serviceId: string): DebugPanelRow[] {
    const state = this.snapshot(serviceId);
    const ordered = this.orderedWatches(serviceId);
    // When any watch carries an explicit `groupName` we always render the
    // group header so the user's clustering intent is visible without the
    // toggle. The toggle itself still groups every watch by its source.
    const hasExplicitGroup = ordered.some((watch) => Boolean(watch.groupName));

    if (!state.ui.groupBySource && !hasExplicitGroup) {
      return ordered.map((watch) => ({
        kind: 'watch',
        key: `watch:${watch.id}`,
        source: this.deriveSource(watch),
        watch,
      }));
    }

    const grouped = new Map<string, DebugWatch[]>();
    const ungrouped: DebugWatch[] = [];
    for (const watch of ordered) {
      // When grouping is implicit (only because of explicit groupName), keep
      // un-grouped watches in a single tail bucket instead of clustering them
      // by their auto-derived source.
      if (!state.ui.groupBySource && !watch.groupName) {
        ungrouped.push(watch);
        continue;
      }
      const source = this.deriveSource(watch);
      const existing = grouped.get(source) ?? [];
      existing.push(watch);
      grouped.set(source, existing);
    }

    const rows: DebugPanelRow[] = [];
    for (const [source, watches] of grouped.entries()) {
      rows.push({ kind: 'header', key: `header:${source}`, source });
      for (const watch of watches) {
        rows.push({
          kind: 'watch',
          key: `watch:${watch.id}`,
          source,
          watch,
        });
      }
    }
    for (const watch of ungrouped) {
      rows.push({
        kind: 'watch',
        key: `watch:${watch.id}`,
        source: this.deriveSource(watch),
        watch,
      });
    }

    return rows;
  }

  deriveSource(input: DebugWatch | string): string {
    if (typeof input !== 'string') {
      const groupName = input.groupName?.trim();
      if (groupName) return groupName;
      return this.deriveSource(input.expr);
    }
    const trimmed = input.trim();
    const match = trimmed.match(/^([$A-Z_a-z][\w$]*)/);
    return match?.[1] ?? 'expression';
  }

  toggleWatchPaused(serviceId: string, watchId: string): void {
    this.updateState(serviceId, (current) => {
      const existing = current.ui.watchLocal[watchId] ?? createEmptyWatchUiState();
      const paused = !existing.paused;
      return {
        ...current,
        ui: {
          ...current.ui,
          watchLocal: {
            ...current.ui.watchLocal,
            [watchId]: {
              ...existing,
              paused,
              pausedHistory: paused ? [...(current.history[watchId] ?? [])] : null,
            },
          },
        },
      };
    });
  }

  toggleWatchHistory(serviceId: string, watchId: string): void {
    this.updateState(serviceId, (current) => {
      const existing = current.ui.watchLocal[watchId] ?? createEmptyWatchUiState();
      return {
        ...current,
        ui: {
          ...current.ui,
          watchLocal: {
            ...current.ui.watchLocal,
            [watchId]: {
              ...existing,
              historyExpanded: !existing.historyExpanded,
            },
          },
        },
      };
    });
  }

  setGroupBySource(serviceId: string, enabled: boolean): void {
    this.updateState(serviceId, (current) => ({
      ...current,
      ui: {
        ...current.ui,
        groupBySource: enabled,
      },
    }));
  }

  reorderWatches(serviceId: string, nextOrder: string[]): void {
    this.updateState(serviceId, (current) => {
      const liveIds = current.session.watches.map((watch) => watch.id);
      return {
        ...current,
        ui: {
          ...current.ui,
          watchOrder: [
            ...nextOrder.filter((watchId) => liveIds.includes(watchId)),
            ...liveIds.filter((watchId) => !nextOrder.includes(watchId)),
          ],
        },
      };
    });
  }

  setWatchExportRange(serviceId: string, watchId: string, patch: WatchRangePatch): void {
    this.updateState(serviceId, (current) => {
      const existing = current.ui.watchLocal[watchId] ?? createEmptyWatchUiState();
      return {
        ...current,
        ui: {
          ...current.ui,
          watchLocal: {
            ...current.ui.watchLocal,
            [watchId]: {
              ...existing,
              ...patch,
            },
          },
        },
      };
    });
  }

  async exportWatchHistoryRange(
    serviceId: string,
    watchId: string,
    request: DebugHistoryExportRequest,
  ): Promise<Blob> {
    const params = new URLSearchParams({
      from: String(request.from),
      to: String(request.to),
      format: request.format,
    });

    const response = await fetch(
      `${API_BASE}/services/${serviceId}/debug/watches/${watchId}/history?${params.toString()}`,
    );

    if (!response.ok) {
      const message = (await response.text()).trim();
      throw new Error(message || `Failed to export ${request.format.toUpperCase()} history.`);
    }

    return response.blob();
  }

  createWatchJson(serviceId: string, watchId: string): string | null {
    const state = this.snapshot(serviceId);
    const watch = state.session.watches.find((entry) => entry.id === watchId);
    if (!watch) {
      return null;
    }

    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        serviceId,
        source: this.deriveSource(watch.expr),
        watch,
        samples: this.viewHistory(serviceId, watchId),
      },
      null,
      2,
    );
  }

  createSessionExport(
    serviceId: string,
    metadata: {
      projectId: string;
      projectName: string;
      serviceName: string;
      serviceStatus: string;
      serviceCommand: string;
      serviceCwd: string;
    },
  ): string {
    const state = this.snapshot(serviceId);
    const ordered = this.orderedWatches(serviceId);

    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        projectId: metadata.projectId,
        projectName: metadata.projectName,
        service: {
          id: serviceId,
          name: metadata.serviceName,
          status: metadata.serviceStatus,
          command: metadata.serviceCommand,
          cwd: metadata.serviceCwd,
          language: state.session.language,
        },
        session: state.session,
        groupBySource: state.ui.groupBySource,
        watches: ordered.map((watch) => ({
          source: this.deriveSource(watch.expr),
          watch,
          samples: this.viewHistory(serviceId, watch.id),
        })),
      },
      null,
      2,
    );
  }

  private updateState(
    serviceId: string,
    updater: (current: ServiceDebugState) => ServiceDebugState,
  ): void {
    this.statesSignal.update((all) => {
      const current = all[serviceId] ?? EMPTY_STATE(serviceId);
      return {
        ...all,
        [serviceId]: this.normaliseState(updater(current)),
      };
    });
  }

  private applyMessage(serviceId: string, message: DebugWsServerMessage): void {
    this.statesSignal.update((all) => {
      const current = all[serviceId] ?? EMPTY_STATE(serviceId);
      let next = current;

      if (message.type === 'session') {
        const watchIds = new Set(message.payload.watches.map((watch) => watch.id));
        const trimmedHistory: Record<string, DebugSample[]> = {};
        for (const [watchId, samples] of Object.entries(current.history)) {
          if (watchIds.has(watchId)) {
            trimmedHistory[watchId] = samples;
          }
        }
        next = {
          ...current,
          session: message.payload,
          history: trimmedHistory,
        };
      } else if (message.type === 'watch-history') {
        next = {
          ...current,
          history: { ...current.history, [message.watchId]: message.samples },
        };
      } else if (message.type === 'sample') {
        const watchId = message.payload.watchId;
        const watch = current.session.watches.find((entry) => entry.id === watchId);
        const cap = watch?.bufferSize ?? 500;
        const prev = current.history[watchId] ?? [];
        const merged = [...prev, message.payload];
        const trimmed = merged.length > cap ? merged.slice(-cap) : merged;
        next = {
          ...current,
          history: { ...current.history, [watchId]: trimmed },
        };
      } else if (message.type === 'watch-added') {
        const exists = current.session.watches.some((watch) => watch.id === message.payload.id);
        next = exists
          ? current
          : {
              ...current,
              session: {
                ...current.session,
                watches: [...current.session.watches, message.payload],
              },
            };
      } else if (message.type === 'watch-removed') {
        const { [message.watchId]: _removed, ...remaining } = current.history;
        next = {
          ...current,
          session: {
            ...current.session,
            watches: current.session.watches.filter((watch) => watch.id !== message.watchId),
          },
          history: remaining,
        };
      } else if (message.type === 'recording-started') {
        next = {
          ...current,
          recordings: { ...current.recordings, active: message.payload },
        };
      } else if (message.type === 'recording-stopped') {
        next = {
          ...current,
          recordings: {
            active: null,
            finished: [message.payload, ...current.recordings.finished],
          },
        };
      } else if (message.type === 'recording-removed') {
        next = {
          ...current,
          recordings: {
            ...current.recordings,
            finished: current.recordings.finished.filter((r) => r.id !== message.recordingId),
          },
        };
      } else if (message.type === 'error') {
        console.error('Debug error', message.message);
        next = {
          ...current,
          session: {
            ...current.session,
            status: 'error',
            message: message.message,
          },
        };
      }

      return { ...all, [serviceId]: this.normaliseState(next) };
    });
  }

  private normaliseState(state: ServiceDebugState): ServiceDebugState {
    return {
      ...state,
      ui: this.syncUiState(state.ui, state.session.watches, state.history),
    };
  }

  private syncUiState(
    ui: ServiceDebugUiState,
    watches: DebugWatch[],
    history: Record<string, DebugSample[]>,
  ): ServiceDebugUiState {
    const watchIds = watches.map((watch) => watch.id);
    const retainedOrder = ui.watchOrder.filter((watchId) => watchIds.includes(watchId));
    const watchOrder = [...retainedOrder, ...watchIds.filter((watchId) => !retainedOrder.includes(watchId))];
    const watchLocal: Record<string, DebugWatchUiState> = {};

    for (const watch of watches) {
      watchLocal[watch.id] = this.syncSingleWatchUiState(ui.watchLocal[watch.id], history[watch.id] ?? []);
    }

    return {
      ...ui,
      watchOrder,
      watchLocal,
    };
  }

  private syncSingleWatchUiState(
    existing: DebugWatchUiState | undefined,
    samples: DebugSample[],
  ): DebugWatchUiState {
    const next = existing ? { ...existing } : createEmptyWatchUiState();
    const defaults = this.defaultExportRange(samples);

    if (!next.exportFrom && defaults.exportFrom) {
      next.exportFrom = defaults.exportFrom;
    }
    if (!next.exportTo && defaults.exportTo) {
      next.exportTo = defaults.exportTo;
    }
    if (!next.paused) {
      next.pausedHistory = null;
    }

    return next;
  }

  private defaultExportRange(samples: DebugSample[]): Pick<DebugWatchUiState, 'exportFrom' | 'exportTo'> {
    if (samples.length === 0) {
      return { exportFrom: '', exportTo: '' };
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) {
      return { exportFrom: '', exportTo: '' };
    }

    return {
      exportFrom: this.toDatetimeLocal(first.t),
      exportTo: this.toDatetimeLocal(last.t),
    };
  }

  private toDatetimeLocal(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}

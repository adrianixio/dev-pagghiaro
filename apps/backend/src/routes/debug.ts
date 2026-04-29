import type { CreateDebugWatchBody, DebugRecording, DebugSample } from '@dev-pagghiaro/shared';
import { Elysia, t } from 'elysia';
import { findServiceById, updateService } from '../config-store';
import { debugManager } from '../debug/debug-manager';
import { recordingStore } from '../debug/recording-store';
import { watchRegistry } from '../debug/watch-registry';

const CreateWatchSchema = t.Object({
  expr: t.String({ minLength: 1 }),
  mode: t.Optional(t.Union([t.Literal('interval'), t.Literal('onChange')])),
  intervalMs: t.Optional(t.Number()),
  bufferSize: t.Optional(t.Number()),
  threadName: t.Optional(t.String()),
  label: t.Optional(t.String()),
  condition: t.Optional(t.String()),
  groupName: t.Optional(t.String()),
});

const ReorderWatchesSchema = t.Object({
  watchIds: t.Array(t.String({ minLength: 1 }), { minItems: 0 }),
});

const BulkCreateWatchesSchema = t.Object({
  watches: t.Array(CreateWatchSchema, { minItems: 1, maxItems: 50 }),
});

const StartRecordingSchema = t.Object({
  name: t.Optional(t.String()),
  includeLogs: t.Optional(t.Boolean()),
  includeMetrics: t.Optional(t.Boolean()),
  includeStatus: t.Optional(t.Boolean()),
  kind: t.Optional(t.Union([t.Literal('manual'), t.Literal('auto')])),
  autoIntervalMs: t.Optional(t.Number({ minimum: 250, maximum: 10000 })),
  autoMaxSnapshots: t.Optional(t.Number({ minimum: 1, maximum: 500 })),
  autoFrameDepth: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
  includeUserGlobals: t.Optional(t.Boolean()),
  includeClosures: t.Optional(t.Boolean()),
  excludeFrameRegex: t.Optional(t.String()),
});

function recordingToCsv(recording: DebugRecording): string {
  if ((recording.kind ?? 'manual') === 'auto') {
    const rows: string[] = ['t,frame_file,frame_line,scope,name,type,value'];
    for (const snapshot of recording.snapshots ?? []) {
      for (const frame of snapshot.frames) {
        for (const local of frame.locals) {
          const val = local.value.replaceAll('"', '""');
          rows.push(`${snapshot.t},"${frame.file}",${frame.line},"locals","${local.name}","${local.type ?? 'unknown'}","${val}"`);
        }
        for (const closure of frame.closures) {
          const val = closure.value.replaceAll('"', '""');
          rows.push(`${snapshot.t},"${frame.file}",${frame.line},"closures","${closure.name}","${closure.type ?? 'unknown'}","${val}"`);
        }
      }
      for (const globalVar of snapshot.userGlobals) {
        const val = globalVar.value.replaceAll('"', '""');
        rows.push(`${snapshot.t},"<globals>",0,"globals","${globalVar.name}","${globalVar.type ?? 'unknown'}","${val}"`);
      }
    }
    return rows.join('\n');
  }
  const rows: string[] = ['watch_id,watch_label,timestamp,value'];
  for (const track of recording.tracks) {
    const labelRaw = track.watch.label ?? track.watch.expr;
    const labelEscaped = String(labelRaw).replaceAll('"', '""');
    for (const sample of track.samples) {
      const rawValue = sample.error ?? sample.value ?? '';
      const valueStr = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
      const valueEscaped = valueStr.replaceAll('"', '""');
      rows.push(`${track.watch.id},"${labelEscaped}",${sample.t},"${valueEscaped}"`);
    }
  }
  return rows.join('\n');
}

const BASE = '/api/services/:serviceId/debug';

type ExportFormat = 'json' | 'csv';

interface ServiceContext {
  projectId: string;
  serviceId: string;
  persistDebugWatches: boolean;
}

function parseOptionalTimestamp(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeExportFormat(value: unknown): ExportFormat | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return value === 'csv' || value === 'json' ? value : undefined;
}

function toCsv(samples: DebugSample[]): string {
  const rows = samples.map((sample) => {
    const rawValue = sample.error ?? sample.value ?? '';
    const value = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
    const escaped = value.replaceAll('"', '""');
    return `${sample.t},"${escaped}"`;
  });
  return ['timestamp,value', ...rows].join('\n');
}

async function getServiceContext(serviceId: string): Promise<ServiceContext | null> {
  const resolved = await findServiceById(serviceId);
  if (!resolved) return null;

  watchRegistry.restoreWatches(serviceId, resolved.service.debugWatches ?? []);

  return {
    projectId: resolved.projectId,
    serviceId,
    persistDebugWatches: Boolean(resolved.service.persistDebugWatches),
  };
}

async function persistWatchList(context: ServiceContext): Promise<void> {
  if (!context.persistDebugWatches) return;
  await updateService(context.projectId, context.serviceId, {
    debugWatches: watchRegistry.listWatches(context.serviceId),
  });
}

export const debugRouter = new Elysia()
  .get(`${BASE}/session`, async ({ params, set }) => {
    const context = await getServiceContext(params.serviceId);
    if (!context) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }
    return watchRegistry.getSession(params.serviceId);
  })
  .get(`${BASE}/watches`, async ({ params, set }) => {
    const context = await getServiceContext(params.serviceId);
    if (!context) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }
    return watchRegistry.listWatches(params.serviceId);
  })
  .post(
    `${BASE}/watches`,
    async ({ params, body, set }) => {
      const context = await getServiceContext(params.serviceId);
      if (!context) {
        set.status = 404;
        return { error: 'NOT_FOUND', message: 'Service not found' };
      }

      try {
        const watch = watchRegistry.addWatch(params.serviceId, body as CreateDebugWatchBody);
        await persistWatchList(context);
        return watch;
      } catch (err) {
        set.status = 400;
        const message = err instanceof Error ? err.message : 'Invalid watch';
        return { error: 'INVALID_WATCH', message };
      }
    },
    { body: CreateWatchSchema }
  )
  .post(
    `${BASE}/watches/reorder`,
    async ({ params, body, set }) => {
      const context = await getServiceContext(params.serviceId);
      if (!context) {
        set.status = 404;
        return { error: 'NOT_FOUND', message: 'Service not found' };
      }

      const reordered = watchRegistry.reorderWatches(params.serviceId, body.watchIds);
      if (reordered === null) {
        set.status = 400;
        return { error: 'INVALID_ORDER', message: 'Watch order must contain each watch exactly once' };
      }

      await persistWatchList(context);
      return reordered;
    },
    { body: ReorderWatchesSchema }
  )
  .post(
    `${BASE}/watches/bulk`,
    async ({ params, body, set }) => {
      const context = await getServiceContext(params.serviceId);
      if (!context) {
        set.status = 404;
        return { error: 'NOT_FOUND', message: 'Service not found' };
      }

      const added = [];
      const failed = [] as Array<{ index: number; expr: string | null; error: string }>;
      for (let i = 0; i < body.watches.length; i++) {
        const item = body.watches[i] as CreateDebugWatchBody;
        try {
          const watch = watchRegistry.addWatch(params.serviceId, item);
          added.push(watch);
        } catch (err) {
          failed.push({
            index: i,
            expr: item?.expr ?? null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (added.length > 0) {
        await persistWatchList(context);
      }
      return { added, failed };
    },
    { body: BulkCreateWatchesSchema }
  )
  .delete(`${BASE}/watches/:watchId`, async ({ params, set }) => {
    const context = await getServiceContext(params.serviceId);
    if (!context) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }

    const removed = watchRegistry.removeWatch(params.serviceId, params.watchId);
    if (!removed) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Watch not found' };
    }

    await persistWatchList(context);
    return { ok: true };
  })
  .get(`${BASE}/watches/:watchId/history`, async ({ params, query, set }) => {
    const context = await getServiceContext(params.serviceId);
    if (!context) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }

    const from = parseOptionalTimestamp(query.from);
    const to = parseOptionalTimestamp(query.to);
    const format = normalizeExportFormat(query.format);

    if (Number.isNaN(from) || Number.isNaN(to)) {
      set.status = 400;
      return { error: 'INVALID_RANGE', message: 'from/to must be valid timestamps' };
    }

    if (from !== undefined && to !== undefined && from > to) {
      set.status = 400;
      return { error: 'INVALID_RANGE', message: 'from must be less than or equal to to' };
    }

    if (query.format !== undefined && format === undefined) {
      set.status = 400;
      return { error: 'INVALID_FORMAT', message: 'format must be json or csv' };
    }

    const samples = watchRegistry.getHistory(params.serviceId, params.watchId, { from, to });
    const explicitExport = from !== undefined || to !== undefined || format !== undefined;
    if (explicitExport && samples.length === 0) {
      set.status = 400;
      return { error: 'EMPTY_RANGE', message: 'No samples found in selected range' };
    }

    if (format === 'csv') {
      set.headers['content-type'] = 'text/csv; charset=utf-8';
      set.headers['content-disposition'] = `attachment; filename="${params.watchId}-history.csv"`;
      return toCsv(samples);
    }

    if (format === 'json') {
      set.headers['content-disposition'] = `attachment; filename="${params.watchId}-history.json"`;
    }

    return samples;
  })
  .get(`${BASE}/recordings`, async ({ params, set }) => {
    const context = await getServiceContext(params.serviceId);
    if (!context) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }
    return {
      active: recordingStore.getActive(params.serviceId),
      finished: recordingStore.listRecordings(params.serviceId),
    };
  })
  .post(
    `${BASE}/recordings`,
    async ({ params, body, set }) => {
      const context = await getServiceContext(params.serviceId);
      if (!context) {
        set.status = 404;
        return { error: 'NOT_FOUND', message: 'Service not found' };
      }
      try {
        const adapter = debugManager.getActiveAdapter(params.serviceId);
        return recordingStore.startRecording(params.serviceId, body.name, {
          kind: body.kind,
          includeLogs: body.includeLogs,
          includeMetrics: body.includeMetrics,
          includeStatus: body.includeStatus,
          autoIntervalMs: body.autoIntervalMs,
          autoMaxSnapshots: body.autoMaxSnapshots,
          autoFrameDepth: body.autoFrameDepth,
          includeUserGlobals: body.includeUserGlobals,
          includeClosures: body.includeClosures,
          excludeFrameRegex: body.excludeFrameRegex,
          snapshotScope: adapter?.snapshotScope?.bind(adapter),
        });
      } catch (err) {
        set.status = 409;
        const message = err instanceof Error ? err.message : 'Cannot start recording';
        return { error: 'RECORDING_CONFLICT', message };
      }
    },
    { body: StartRecordingSchema }
  )
  .post(`${BASE}/recordings/:recordingId/stop`, async ({ params, set }) => {
    const context = await getServiceContext(params.serviceId);
    if (!context) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }
    const summary = recordingStore.stopRecording(params.serviceId, params.recordingId);
    if (!summary) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'No active recording with that id' };
    }
    return summary;
  })
  .delete(`${BASE}/recordings/:recordingId`, async ({ params, set }) => {
    const context = await getServiceContext(params.serviceId);
    if (!context) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }
    const removed = recordingStore.removeRecording(params.serviceId, params.recordingId);
    if (!removed) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Recording not found' };
    }
    return { ok: true };
  })
  .get(`${BASE}/recordings/:recordingId`, async ({ params, query, set }) => {
    const context = await getServiceContext(params.serviceId);
    if (!context) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Service not found' };
    }
    const recording = recordingStore.getRecording(params.serviceId, params.recordingId);
    if (!recording) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Recording not found' };
    }
    const format = normalizeExportFormat(query.format);
    if (query.format !== undefined && format === undefined) {
      set.status = 400;
      return { error: 'INVALID_FORMAT', message: 'format must be json or csv' };
    }
    if (format === 'csv') {
      set.headers['content-type'] = 'text/csv; charset=utf-8';
      set.headers['content-disposition'] = `attachment; filename="${recording.id}-recording.csv"`;
      return recordingToCsv(recording);
    }
    if (format === 'json') {
      set.headers['content-disposition'] = `attachment; filename="${recording.id}-recording.json"`;
    }
    return recording;
  });

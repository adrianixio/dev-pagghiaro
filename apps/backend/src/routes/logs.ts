import { Elysia, t } from 'elysia';
import type { LogQuery, LogSeverity } from '@dev-pagghiaro/shared';
import { getProject } from '../config-store';
import { logStore } from '../log-store';

const LogsQuerySchema = t.Object({
  services: t.Optional(t.String()),
  q: t.Optional(t.String()),
  regex: t.Optional(t.String()),
  severity: t.Optional(
    t.Union([t.Literal('info'), t.Literal('warn'), t.Literal('error')]),
  ),
  since: t.Optional(t.String()),
  limit: t.Optional(t.String()),
});

export function buildLogQuery(
  params: {
    services?: string;
    q?: string;
    useRegex: boolean;
    severity?: LogSeverity;
    since?: string;
    limit?: string;
  },
  allServiceIds: string[],
): LogQuery {
  const serviceIds = params.services
    ? params.services.split(',').map((s) => s.trim()).filter(Boolean)
    : allServiceIds;

  const since = params.since !== undefined ? Number(params.since) : NaN;
  const limit = params.limit !== undefined ? Number(params.limit) : NaN;

  return {
    serviceIds,
    regex: params.useRegex,
    ...(params.q ? { q: params.q } : {}),
    ...(params.severity ? { severity: params.severity } : {}),
    ...(Number.isFinite(since) ? { since } : {}),
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
  };
}

export const logsRouter = new Elysia().get(
  '/api/projects/:projectId/logs',
  async ({ params, query, set }) => {
    const useRegex = query.regex === 'true' || query.regex === '1';

    // Validazione regex PRIMA della lookup del progetto: 400 testabile senza config.
    if (query.q && useRegex) {
      try {
        new RegExp(query.q);
      } catch {
        set.status = 400;
        return { error: 'BAD_REQUEST', message: 'Invalid regular expression' };
      }
    }

    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Project not found' };
    }

    const logQuery = buildLogQuery(
      {
        useRegex,
        ...(query.services ? { services: query.services } : {}),
        ...(query.q ? { q: query.q } : {}),
        ...(query.severity ? { severity: query.severity as LogSeverity } : {}),
        ...(query.since ? { since: query.since } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      },
      project.services.map((s) => s.id),
    );
    return logStore.query(logQuery);
  },
  { query: LogsQuerySchema },
);

import type { LogQuery, LogSeverity, StructuredLine } from '@dev-pagghiaro/shared';
import { logBus } from './log-bus';
import { createLineAssembler } from './log-line-assembler';
import { createSeverityClassifier, SEVERITY_RANK } from './log-severity';

const MAX_LINES = Math.max(500, Number(process.env['PAGGHIARO_LOG_LINES'] ?? 5000));
const DEFAULT_LIMIT = 2000;

interface ServiceLog {
  projectId: string;
  lines: StructuredLine[];
  seq: number;
  assembler: ReturnType<typeof createLineAssembler>;
  classifier: ReturnType<typeof createSeverityClassifier>;
  unsub: Array<() => void>;
}

const logs = new Map<string, ServiceLog>();

function push(entry: ServiceLog, line: StructuredLine): void {
  entry.lines.push(line);
  if (entry.lines.length > MAX_LINES) {
    entry.lines.shift();
  }
}

export const logStore = {
  attach(serviceId: string, projectId: string): void {
    if (logs.has(serviceId)) return;

    const entry: ServiceLog = {
      projectId,
      lines: [],
      seq: 0,
      assembler: createLineAssembler(),
      classifier: createSeverityClassifier(),
      unsub: [],
    };
    logs.set(serviceId, entry);

    const unsubLog = logBus.subscribeLog(serviceId, (busEntry) => {
      for (const asm of entry.assembler.push(busEntry.data)) {
        const { severity, continuesEvent } = entry.classifier.classify(asm.text);
        entry.seq += 1;
        push(entry, {
          seq: entry.seq,
          serviceId,
          projectId,
          timestamp: busEntry.timestamp,
          raw: asm.raw,
          text: asm.text,
          severity,
          eventHead: !continuesEvent,
          kind: 'log',
        });
      }
    });

    const unsubStatus = logBus.subscribeStatus(serviceId, (status) => {
      if (status !== 'error' && status !== 'restarting' && status !== 'stopped') return;
      entry.seq += 1;
      const label = `── ${status} ──`;
      push(entry, {
        seq: entry.seq,
        serviceId,
        projectId,
        timestamp: Date.now(),
        raw: label,
        text: label,
        severity: status === 'error' ? 'error' : 'info',
        eventHead: true,
        kind: 'marker',
      });
    });

    const unsubClear = logBus.subscribeClear(serviceId, () => {
      entry.lines = [];
    });

    entry.unsub.push(unsubLog, unsubStatus, unsubClear);
  },

  query(query: LogQuery): StructuredLine[] {
    const ids = query.serviceIds.length > 0 ? query.serviceIds : [...logs.keys()];
    const minRank = query.severity ? SEVERITY_RANK[query.severity] : 0;

    let matcher: (text: string) => boolean = () => true;
    if (query.q) {
      if (query.regex) {
        const re = new RegExp(query.q, 'i'); // il chiamante (route) deve validare
        matcher = (t) => re.test(t);
      } else {
        const needle = query.q.toLowerCase();
        matcher = (t) => t.toLowerCase().includes(needle);
      }
    }

    const collected: StructuredLine[] = [];
    for (const id of ids) {
      const entry = logs.get(id);
      if (!entry) continue;
      for (const line of entry.lines) {
        if (SEVERITY_RANK[line.severity] < minRank) continue;
        if (query.since !== undefined && line.timestamp < query.since) continue;
        if (!matcher(line.text)) continue;
        collected.push(line);
      }
    }

    collected.sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq);
    const limit = query.limit ?? DEFAULT_LIMIT;
    return collected.length > limit ? collected.slice(collected.length - limit) : collected;
  },

  reset(): void {
    for (const entry of logs.values()) {
      for (const unsub of entry.unsub) unsub();
    }
    logs.clear();
  },
};

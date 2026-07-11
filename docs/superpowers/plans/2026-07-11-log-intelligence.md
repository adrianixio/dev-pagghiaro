# Log Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere a DevPagghiaro una vista "Logs" con ricerca/filtro, highlight errori (JS+Python), timeline unificata multi-servizio e marker crash/restart, senza toccare il terminale live.

**Architecture:** I chunk grezzi del PTY continuano ad andare a `log-bus` → WS → xterm (invariato). Un nuovo `logStore` si iscrive allo stesso `log-bus` e produce, tramite due funzioni pure (`log-line-assembler`, `log-severity`), righe strutturate tenute in un ring per-servizio. Un endpoint REST `GET /api/projects/:id/logs` interroga il ring; il frontend Angular mostra un pannello aperto dalla command palette.

**Tech Stack:** Backend Bun + Elysia, test con `bun:test` (file `*.test.ts` colocati). Frontend Angular 18 standalone + signals, `fetch` verso `/api`, test Jasmine/Karma (`ng test`, file `*.spec.ts`). Tipi condivisi in `packages/shared`.

## Global Constraints

- **NON modificare** `apps/backend/src/log-bus.ts`: i nuovi componenti si iscrivono come ulteriori listener.
- Il **terminale live resta invariato**: la vista Logs è additiva.
- **Nessuna persistenza su disco** in questa fase (solo ring in memoria).
- Ring **5000 righe/servizio di default**, override via env `PAGGHIARO_LOG_LINES`.
- Highlight deve riconoscere stacktrace **JS/Node** e traceback **Python**.
- **Timeline cross-servizio** inclusa (merge ordinato per timestamp).
- **Punto d'ingresso UI: solo command palette** (comando `open-logs`).
- Backend: eseguire i test con `cd apps/backend && bun test`. Frontend: `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless`.

---

### Task 1: Tipi condivisi

**Files:**
- Modify: `packages/shared/src/models.ts` (append in fondo)
- Verify: `packages/shared/src/index.ts` (deve già fare `export * from './models'`)

**Interfaces:**
- Produces: `LogSeverity`, `StructuredLine`, `LogQuery` — consumati da tutte le task successive.

- [ ] **Step 1: Aggiungere i tipi in `packages/shared/src/models.ts`**

```ts
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
```

- [ ] **Step 2: Verificare il re-export**

Aprire `packages/shared/src/index.ts`. Se non contiene `export * from './models';`, aggiungerlo.

- [ ] **Step 3: Typecheck**

Run: `cd apps/backend && bun run build`
Expected: build OK, nessun errore sui nuovi tipi.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/models.ts packages/shared/src/index.ts
git commit -m "feat(shared): add log intelligence types"
```

---

### Task 2: Line assembler (funzione pura)

**Files:**
- Create: `apps/backend/src/log-line-assembler.ts`
- Test: `apps/backend/src/log-line-assembler.test.ts`

**Interfaces:**
- Produces: `stripAnsi(input: string): string`; `createLineAssembler(): { push(chunk: string): AssembledLine[]; flush(): AssembledLine[] }`; `interface AssembledLine { raw: string; text: string }`.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
// apps/backend/src/log-line-assembler.test.ts
import { test, expect } from 'bun:test';
import { createLineAssembler, stripAnsi } from './log-line-assembler';

test('emits a completed line on newline', () => {
  const a = createLineAssembler();
  expect(a.push('hello\n')).toEqual([{ raw: 'hello', text: 'hello' }]);
});

test('buffers partial lines across chunks', () => {
  const a = createLineAssembler();
  expect(a.push('hel')).toEqual([]);
  expect(a.push('lo\n')).toEqual([{ raw: 'hello', text: 'hello' }]);
});

test('handles CRLF without leaking the carriage return', () => {
  const a = createLineAssembler();
  expect(a.push('a\r\nb\n')).toEqual([
    { raw: 'a', text: 'a' },
    { raw: 'b', text: 'b' },
  ]);
});

test('bare CR overwrites the current line (progress bars)', () => {
  const a = createLineAssembler();
  expect(a.push('progress 1\rprogress 2\n')).toEqual([
    { raw: 'progress 2', text: 'progress 2' },
  ]);
});

test('keeps ANSI in raw but strips it in text', () => {
  const a = createLineAssembler();
  const [line] = a.push('[31merr[0m\n');
  expect(line!.text).toBe('err');
  expect(line!.raw).toContain('[31m');
});

test('flush emits the trailing partial line', () => {
  const a = createLineAssembler();
  expect(a.push('tail')).toEqual([]);
  expect(a.flush()).toEqual([{ raw: 'tail', text: 'tail' }]);
});

test('stripAnsi removes escape sequences', () => {
  expect(stripAnsi('[1;32mok[0m')).toBe('ok');
});
```

- [ ] **Step 2: Eseguire i test per verificarne il fallimento**

Run: `cd apps/backend && bun test log-line-assembler`
Expected: FAIL (`Cannot find module './log-line-assembler'`).

- [ ] **Step 3: Implementare**

```ts
// apps/backend/src/log-line-assembler.ts

// Copre CSI/escape ANSI comuni (colori, cursor moves).
const ANSI_PATTERN =
  /[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

export interface AssembledLine {
  raw: string;
  text: string;
}

export function createLineAssembler(): {
  push(chunk: string): AssembledLine[];
  flush(): AssembledLine[];
} {
  let current = '';
  let pendingCR = false;

  const makeLine = (raw: string): AssembledLine => ({ raw, text: stripAnsi(raw) });

  return {
    push(chunk: string): AssembledLine[] {
      const lines: AssembledLine[] = [];
      for (const ch of chunk) {
        if (ch === '\n') {
          pendingCR = false;
          lines.push(makeLine(current));
          current = '';
        } else if (ch === '\r') {
          pendingCR = true;
        } else {
          if (pendingCR) {
            current = '';
            pendingCR = false;
          }
          current += ch;
        }
      }
      return lines;
    },
    flush(): AssembledLine[] {
      if (current.length === 0) return [];
      const line = makeLine(current);
      current = '';
      pendingCR = false;
      return [line];
    },
  };
}
```

- [ ] **Step 4: Eseguire i test**

Run: `cd apps/backend && bun test log-line-assembler`
Expected: PASS (7 test).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/log-line-assembler.ts apps/backend/src/log-line-assembler.test.ts
git commit -m "feat(backend): add PTY line assembler with ANSI handling"
```

---

### Task 3: Classificatore severità (funzione pura)

**Files:**
- Create: `apps/backend/src/log-severity.ts`
- Test: `apps/backend/src/log-severity.test.ts`

**Interfaces:**
- Consumes: `LogSeverity` da `@dev-pagghiaro/shared`.
- Produces: `SEVERITY_RANK: Record<LogSeverity, number>`; `createSeverityClassifier(): { classify(text: string): { severity: LogSeverity; continuesEvent: boolean } }`.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
// apps/backend/src/log-severity.test.ts
import { test, expect } from 'bun:test';
import { createSeverityClassifier, SEVERITY_RANK } from './log-severity';

test('info by default', () => {
  const c = createSeverityClassifier();
  expect(c.classify('Listening on port 3000')).toEqual({ severity: 'info', continuesEvent: false });
});

test('warnings detected', () => {
  const c = createSeverityClassifier();
  expect(c.classify('warning: deprecated API')).toEqual({ severity: 'warn', continuesEvent: false });
});

test('JS error header opens a stack, at-frames continue it', () => {
  const c = createSeverityClassifier();
  expect(c.classify('Error: boom')).toEqual({ severity: 'error', continuesEvent: false });
  expect(c.classify('    at foo (a.js:1:1)')).toEqual({ severity: 'error', continuesEvent: true });
});

test('Python traceback groups until the error line', () => {
  const c = createSeverityClassifier();
  expect(c.classify('Traceback (most recent call last):')).toEqual({ severity: 'error', continuesEvent: false });
  expect(c.classify('  File "x.py", line 2, in <module>')).toEqual({ severity: 'error', continuesEvent: true });
  expect(c.classify('ValueError: bad')).toEqual({ severity: 'error', continuesEvent: false });
});

test('severity rank ordering', () => {
  expect(SEVERITY_RANK.info).toBeLessThan(SEVERITY_RANK.warn);
  expect(SEVERITY_RANK.warn).toBeLessThan(SEVERITY_RANK.error);
});
```

- [ ] **Step 2: Eseguire i test per verificarne il fallimento**

Run: `cd apps/backend && bun test log-severity`
Expected: FAIL (`Cannot find module './log-severity'`).

- [ ] **Step 3: Implementare**

```ts
// apps/backend/src/log-severity.ts
import type { LogSeverity } from '@dev-pagghiaro/shared';

export const SEVERITY_RANK: Record<LogSeverity, number> = { info: 0, warn: 1, error: 2 };

const PY_TRACEBACK_HEADER = /^Traceback \(most recent call last\):/;
const ERROR_TYPE = /^[A-Za-z_][\w.]*(Error|Exception):/;
const JS_AT_FRAME = /^\s+at\s+/;
const ERROR_TOKEN = /\b(error|fatal|panic)\b/i;
const WARN_TOKEN = /\b(warn|warning|deprecated)\b/i;

export function createSeverityClassifier(): {
  classify(text: string): { severity: LogSeverity; continuesEvent: boolean };
} {
  let inStack = false;

  return {
    classify(text: string): { severity: LogSeverity; continuesEvent: boolean } {
      const trimmed = text.replace(/^\s+/, '');
      const indented = /^\s+/.test(text) && text.trim() !== '';

      // Un header di traceback Python apre un evento.
      if (PY_TRACEBACK_HEADER.test(trimmed)) {
        inStack = true;
        return { severity: 'error', continuesEvent: false };
      }

      // Righe indentate mentre un evento è aperto = continuazione (frame/codice).
      if (inStack && indented) {
        return { severity: 'error', continuesEvent: true };
      }

      // Una riga non indentata chiude l'eventuale stack aperto.
      inStack = false;

      const isError = ERROR_TYPE.test(trimmed) || JS_AT_FRAME.test(text) || ERROR_TOKEN.test(text);
      if (isError) {
        // Un header "…Error:" apre uno stack JS per agganciare i frame "    at …".
        if (/error:/i.test(trimmed)) {
          inStack = true;
        }
        return { severity: 'error', continuesEvent: false };
      }

      if (WARN_TOKEN.test(text)) {
        return { severity: 'warn', continuesEvent: false };
      }

      return { severity: 'info', continuesEvent: false };
    },
  };
}
```

- [ ] **Step 4: Eseguire i test**

Run: `cd apps/backend && bun test log-severity`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/log-severity.ts apps/backend/src/log-severity.test.ts
git commit -m "feat(backend): add JS+Python severity classifier"
```

---

### Task 4: Log store (orchestratore + ring + query)

**Files:**
- Create: `apps/backend/src/log-store.ts`
- Test: `apps/backend/src/log-store.test.ts`

**Interfaces:**
- Consumes: `logBus` (`subscribeLog(id, (entry:{data,timestamp})=>void)`, `subscribeStatus(id, (status)=>void)`, `subscribeClear(id, ()=>void)`, `emit`, `emitStatus`) da `./log-bus`; `createLineAssembler` da `./log-line-assembler`; `createSeverityClassifier`, `SEVERITY_RANK` da `./log-severity`; `LogQuery`, `StructuredLine` da `@dev-pagghiaro/shared`.
- Produces: `logStore.attach(serviceId: string, projectId: string): void`; `logStore.query(query: LogQuery): StructuredLine[]`; `logStore.reset(): void` (helper di test).

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
// apps/backend/src/log-store.test.ts
import { test, expect, beforeEach } from 'bun:test';
import { logBus } from './log-bus';
import { logStore } from './log-store';

beforeEach(() => {
  logStore.reset();
});

test('ingests bus chunks as structured lines', () => {
  logStore.attach('s1', 'p1');
  logBus.emit('s1', 'hello world\n');
  const lines = logStore.query({ serviceIds: ['s1'] });
  expect(lines.length).toBe(1);
  expect(lines[0]!.text).toBe('hello world');
  expect(lines[0]!.severity).toBe('info');
  expect(lines[0]!.kind).toBe('log');
});

test('filters by severity threshold', () => {
  logStore.attach('s1', 'p1');
  logBus.emit('s1', 'starting up\nError: boom\n');
  const errors = logStore.query({ serviceIds: ['s1'], severity: 'error' });
  expect(errors.length).toBe(1);
  expect(errors[0]!.text).toBe('Error: boom');
});

test('substring query matches text', () => {
  logStore.attach('s1', 'p1');
  logBus.emit('s1', 'alpha\nbeta\n');
  const hits = logStore.query({ serviceIds: ['s1'], q: 'bet' });
  expect(hits.map((l) => l.text)).toEqual(['beta']);
});

test('records a marker on error status', () => {
  logStore.attach('s1', 'p1');
  logBus.emitStatus('s1', 'error');
  const lines = logStore.query({ serviceIds: ['s1'] });
  expect(lines.some((l) => l.kind === 'marker' && l.severity === 'error')).toBe(true);
});

test('merges lines from multiple services', () => {
  logStore.attach('s1', 'p1');
  logStore.attach('s2', 'p1');
  logBus.emit('s1', 'first\n');
  logBus.emit('s2', 'second\n');
  const texts = logStore.query({ serviceIds: ['s1', 's2'] }).map((l) => l.text);
  expect(texts).toContain('first');
  expect(texts).toContain('second');
});

test('empty serviceIds queries all attached services', () => {
  logStore.attach('s1', 'p1');
  logBus.emit('s1', 'x\n');
  expect(logStore.query({ serviceIds: [] }).length).toBe(1);
});
```

- [ ] **Step 2: Eseguire i test per verificarne il fallimento**

Run: `cd apps/backend && bun test log-store`
Expected: FAIL (`Cannot find module './log-store'`).

- [ ] **Step 3: Implementare**

```ts
// apps/backend/src/log-store.ts
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
```

- [ ] **Step 4: Eseguire i test**

Run: `cd apps/backend && bun test log-store`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/log-store.ts apps/backend/src/log-store.test.ts
git commit -m "feat(backend): add structured log store with ring + query"
```

---

### Task 5: Route REST di query

**Files:**
- Create: `apps/backend/src/routes/logs.ts`
- Test: `apps/backend/src/routes/logs.test.ts`

**Interfaces:**
- Consumes: `getProject` da `../config-store`; `logStore.query` da `../log-store`; `LogQuery`, `LogSeverity` da `@dev-pagghiaro/shared`.
- Produces: `logsRouter` (Elysia plugin) che gestisce `GET /api/projects/:projectId/logs`.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
// apps/backend/src/routes/logs.test.ts
import { test, expect } from 'bun:test';
import { logsRouter } from './logs';

test('returns 400 on invalid regex (before touching config)', async () => {
  const res = await logsRouter.handle(
    new Request('http://localhost/api/projects/none/logs?q=%5B&regex=true'),
  );
  expect(res.status).toBe(400);
});

test('returns 404 for unknown project', async () => {
  const res = await logsRouter.handle(
    new Request('http://localhost/api/projects/does-not-exist-xyz/logs'),
  );
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Eseguire i test per verificarne il fallimento**

Run: `cd apps/backend && bun test routes/logs`
Expected: FAIL (`Cannot find module './logs'`).

- [ ] **Step 3: Implementare**

```ts
// apps/backend/src/routes/logs.ts
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
        return { error: 'BAD_REGEX', message: 'Invalid regular expression' };
      }
    }

    const project = await getProject(params.projectId);
    if (!project) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Project not found' };
    }

    const serviceIds = query.services
      ? query.services.split(',').map((s) => s.trim()).filter(Boolean)
      : project.services.map((s) => s.id);

    const logQuery: LogQuery = {
      serviceIds,
      regex: useRegex,
      ...(query.q ? { q: query.q } : {}),
      ...(query.severity ? { severity: query.severity as LogSeverity } : {}),
      ...(query.since ? { since: Number(query.since) } : {}),
      ...(query.limit ? { limit: Number(query.limit) } : {}),
    };

    return logStore.query(logQuery);
  },
  { query: LogsQuerySchema },
);
```

- [ ] **Step 4: Eseguire i test**

Run: `cd apps/backend && bun test routes/logs`
Expected: PASS (2 test).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/logs.ts apps/backend/src/routes/logs.test.ts
git commit -m "feat(backend): add logs query route"
```

---

### Task 6: Wiring ingestione + registrazione route

**Files:**
- Modify: `apps/backend/src/process-manager.ts` (import + prima riga di `start()`)
- Modify: `apps/backend/src/index.ts` (import + `.use(logsRouter)`)

**Interfaces:**
- Consumes: `logStore.attach` da `./log-store`; `logsRouter` da `./routes/logs`.

- [ ] **Step 1: Agganciare l'ingestione in `process-manager.ts`**

In cima al file, dopo gli altri import:

```ts
import { logStore } from "./log-store";
```

Dentro `start(...)`, come **prima istruzione** del metodo (prima del check di idempotenza), così assembler/classifier/subscription esistono prima di qualsiasi `logBus.emit`/`emitStatus`:

```ts
    logStore.attach(service.id, projectId);
```

(`attach` è idempotente: sui restart non ri-sottoscrive e conserva lo storico in memoria.)

- [ ] **Step 2: Registrare la route in `index.ts`**

Aggiungere l'import accanto agli altri router:

```ts
import { logsRouter } from './routes/logs';
```

E nella catena Elysia, dopo `.use(wsLogsRouter)`:

```ts
  .use(logsRouter)
```

- [ ] **Step 3: Verifica: la suite resta verde**

Run: `cd apps/backend && bun test`
Expected: PASS (tutti i test, inclusi quelli nuovi).

- [ ] **Step 4: Verifica manuale end-to-end**

```bash
# dalla root del repo
bun run dev:backend
```
In un altro terminale, creato almeno un progetto+servizio e avviatolo dalla UI (o via API), poi:
```bash
curl "http://localhost:3001/api/projects/<PROJECT_ID>/logs?limit=20"
```
Expected: JSON array di `StructuredLine` con `text`, `severity`, `kind`. Avviando un servizio che stampa un errore, `severity: "error"` compare sulle righe giuste.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/process-manager.ts apps/backend/src/index.ts
git commit -m "feat(backend): wire log ingestion and register logs route"
```

---

### Task 7: Servizio frontend + helper puri

**Files:**
- Create: `frontend/src/app/services/logs.service.ts`
- Test: `frontend/src/app/services/logs.service.spec.ts`

**Interfaces:**
- Consumes: `LogQuery`, `StructuredLine` da `@dev-pagghiaro/shared`.
- Produces: `buildLogsQueryString(params: Partial<LogQuery>): string`; `nextErrorIndex(lines: StructuredLine[], from: number, dir: 1 | -1): number`; classe `LogsService` con `fetchLogs(projectId: string, params: Partial<LogQuery>): Promise<StructuredLine[]>`.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
// frontend/src/app/services/logs.service.spec.ts
import { buildLogsQueryString, nextErrorIndex } from './logs.service';

describe('buildLogsQueryString', () => {
  it('serializes ids and flags', () => {
    const qs = buildLogsQueryString({ serviceIds: ['a', 'b'], q: 'boom', regex: true, severity: 'error' });
    expect(qs).toContain('services=a%2Cb');
    expect(qs).toContain('q=boom');
    expect(qs).toContain('regex=true');
    expect(qs).toContain('severity=error');
  });

  it('returns empty string with no params', () => {
    expect(buildLogsQueryString({})).toBe('');
  });
});

describe('nextErrorIndex', () => {
  const lines: any[] = [
    { eventHead: true, severity: 'info' },
    { eventHead: true, severity: 'error' },
    { eventHead: false, severity: 'error' },
    { eventHead: true, severity: 'error' },
  ];

  it('finds the next error head forward', () => {
    expect(nextErrorIndex(lines, 0, 1)).toBe(1);
    expect(nextErrorIndex(lines, 1, 1)).toBe(3);
  });

  it('finds the previous error head backward', () => {
    expect(nextErrorIndex(lines, 3, -1)).toBe(1);
  });

  it('stays put when none found', () => {
    expect(nextErrorIndex(lines, 3, 1)).toBe(3);
  });
});
```

- [ ] **Step 2: Eseguire i test per verificarne il fallimento**

Run: `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL (modulo `./logs.service` assente).

- [ ] **Step 3: Implementare**

```ts
// frontend/src/app/services/logs.service.ts
import { Injectable } from '@angular/core';
import type { LogQuery, StructuredLine } from '@dev-pagghiaro/shared';

const API_BASE = '/api';

export function buildLogsQueryString(params: Partial<LogQuery>): string {
  const sp = new URLSearchParams();
  if (params.serviceIds && params.serviceIds.length > 0) sp.set('services', params.serviceIds.join(','));
  if (params.q) sp.set('q', params.q);
  if (params.regex) sp.set('regex', 'true');
  if (params.severity) sp.set('severity', params.severity);
  if (params.since !== undefined) sp.set('since', String(params.since));
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function nextErrorIndex(lines: StructuredLine[], from: number, dir: 1 | -1): number {
  const n = lines.length;
  for (let step = 1; step <= n; step += 1) {
    const i = from + dir * step;
    if (i < 0 || i >= n) break;
    const line = lines[i];
    if (line && line.eventHead && line.severity === 'error') return i;
  }
  return from;
}

@Injectable({ providedIn: 'root' })
export class LogsService {
  async fetchLogs(projectId: string, params: Partial<LogQuery>): Promise<StructuredLine[]> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/logs${buildLogsQueryString(params)}`);
    if (!res.ok) return [];
    return (await res.json()) as StructuredLine[];
  }
}
```

- [ ] **Step 4: Eseguire i test**

Run: `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS (i nuovi spec inclusi).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/services/logs.service.ts frontend/src/app/services/logs.service.spec.ts
git commit -m "feat(frontend): add logs service and pure query/nav helpers"
```

---

### Task 8: UiService (apertura pannello) + componente Logs + render nello shell

**Files:**
- Modify: `frontend/src/app/services/ui.service.ts`
- Create: `frontend/src/app/logs/logs-panel.component.ts`
- Modify: `frontend/src/app/layout/app-shell.component.ts` (import + render condizionale)

**Interfaces:**
- Consumes: `LogsService`, `nextErrorIndex` da `../services/logs.service`; `ProjectService` da `../services/project.service`; `UiService`.
- Produces: `UiService.logsOpen()`, `UiService.logsProjectId()`, `UiService.openLogs(projectId)`, `UiService.closeLogs()`; componente standalone `LogsPanelComponent` (`selector: 'app-logs-panel'`).

- [ ] **Step 1: Estendere `UiService` col pattern dei modali (come `openConfig`)**

Aggiungere i signal privati accanto a `configOpenSignal`:

```ts
  private readonly logsOpenSignal = signal(false);
  private readonly logsProjectIdSignal = signal<string | null>(null);
```

Le readonly accanto a `configOpen`:

```ts
  readonly logsOpen = this.logsOpenSignal.asReadonly();
  readonly logsProjectId = this.logsProjectIdSignal.asReadonly();
```

I metodi accanto a `openConfig`/`closeConfig`:

```ts
  openLogs(projectId: string): void {
    this.logsProjectIdSignal.set(projectId);
    this.logsOpenSignal.set(true);
  }

  closeLogs(): void {
    this.logsOpenSignal.set(false);
  }
```

- [ ] **Step 2: Creare il componente pannello Logs (funzionale minimale)**

```ts
// frontend/src/app/logs/logs-panel.component.ts
import { Component, computed, inject, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { LogQuery, LogSeverity, StructuredLine } from '@dev-pagghiaro/shared';
import { LogsService, nextErrorIndex } from '../services/logs.service';
import { ProjectService } from '../services/project.service';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-logs-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="fixed inset-0 z-50 flex flex-col bg-black/60" (click)="ui.closeLogs()">
      <div class="m-auto flex h-[85vh] w-[90vw] max-w-5xl flex-col rounded-lg bg-white shadow-xl dark:bg-neutral-900" (click)="$event.stopPropagation()">
        <!-- Toolbar -->
        <div class="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-700">
          <input class="min-w-40 flex-1 rounded border px-2 py-1 text-sm dark:bg-neutral-800"
                 placeholder="Cerca..." [(ngModel)]="qModel" (ngModelChange)="refresh()" />
          <label class="flex items-center gap-1 text-sm"><input type="checkbox" [(ngModel)]="regex" (ngModelChange)="refresh()" /> regex</label>
          <select class="rounded border px-2 py-1 text-sm dark:bg-neutral-800" [(ngModel)]="severity" (ngModelChange)="refresh()">
            <option value="">tutte</option>
            <option value="warn">warn+</option>
            <option value="error">solo error</option>
          </select>
          <button class="rounded border px-2 py-1 text-sm" (click)="jump(-1)">↑ err</button>
          <button class="rounded border px-2 py-1 text-sm" (click)="jump(1)">↓ err</button>
          <button class="ml-auto rounded border px-2 py-1 text-sm" (click)="ui.closeLogs()">Chiudi</button>
        </div>
        <!-- Lines -->
        <div class="flex-1 overflow-auto p-2 font-mono text-xs leading-relaxed">
          @for (line of lines(); track line.seq + ':' + line.serviceId; let i = $index) {
            <div [attr.data-idx]="i" [class]="rowClass(line)">
              <span class="mr-2 opacity-60">{{ shortId(line.serviceId) }}</span>{{ line.text }}
            </div>
          }
          @if (lines().length === 0) {
            <div class="p-4 text-center opacity-60">Nessun log</div>
          }
        </div>
      </div>
    </div>
  `,
})
export class LogsPanelComponent {
  readonly ui = inject(UiService);
  private readonly logsService = inject(LogsService);
  private readonly projectService = inject(ProjectService);

  // Campi semplici bindati con [(ngModel)] (i signal non supportano ngModel).
  qModel = '';
  regex = false;
  severity: '' | LogSeverity = '';

  private readonly linesSignal = signal<StructuredLine[]>([]);
  readonly lines = this.linesSignal.asReadonly();
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursor = -1;

  constructor() {
    // Ricarica quando il pannello si apre e avvia il polling; ferma alla chiusura.
    effect(() => {
      if (this.ui.logsOpen()) {
        void this.refresh();
        this.timer ??= setInterval(() => void this.refresh(), 1000);
      } else if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    });
  }

  private currentProjectId(): string | null {
    return this.ui.logsProjectId() ?? this.projectService.activeProject()?.id ?? null;
  }

  async refresh(): Promise<void> {
    const projectId = this.currentProjectId();
    if (!projectId) return;
    const params: Partial<LogQuery> = { serviceIds: [], regex: this.regex, limit: 2000 };
    if (this.qModel) params.q = this.qModel;
    if (this.severity) params.severity = this.severity;
    this.linesSignal.set(await this.logsService.fetchLogs(projectId, params));
  }

  jump(dir: 1 | -1): void {
    const idx = nextErrorIndex(this.lines(), this.cursor, dir);
    if (idx === this.cursor) return;
    this.cursor = idx;
    const el = document.querySelector(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: 'center' });
  }

  shortId(id: string): string { return id.slice(0, 6); }

  rowClass(line: StructuredLine): string {
    if (line.kind === 'marker') return 'text-amber-600 dark:text-amber-400';
    if (line.severity === 'error') return 'text-red-600 dark:text-red-400';
    if (line.severity === 'warn') return 'text-yellow-600 dark:text-yellow-400';
    return 'text-neutral-800 dark:text-neutral-200';
  }
}
```

> **Nota per l'implementatore:** `FormsModule` è necessario per `[(ngModel)]`. Rifinire lo stile riusando i componenti `ui-*` esistenti è opzionale e non richiesto per la Fase 1.

- [ ] **Step 3: Renderizzare il pannello in `app-shell.component.ts`**

Aggiungere l'import:

```ts
import { LogsPanelComponent } from '../logs/logs-panel.component';
```

Aggiungere `LogsPanelComponent` all'array `imports` del `@Component`. Nel template dello shell, accanto al render condizionale del config, aggiungere:

```html
@if (ui.logsOpen()) { <app-logs-panel /> }
```

- [ ] **Step 4: Verifica build**

Run: `cd frontend && bun run build`
Expected: build OK, nessun errore di template/type.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/services/ui.service.ts frontend/src/app/logs/logs-panel.component.ts frontend/src/app/layout/app-shell.component.ts
git commit -m "feat(frontend): add logs panel and UiService open/close"
```

---

### Task 9: Comando "Open logs" nella command palette

**Files:**
- Modify: `frontend/src/app/services/command-registry.ts`
- Modify: `frontend/src/app/services/command-registry.spec.ts`
- Modify: `frontend/src/app/layout/app-shell.component.ts` (dep `openLogs`)

**Interfaces:**
- Consumes: `UiService.openLogs` (Task 8).
- Produces: comando con `id: 'open-logs'` quando esiste un progetto attivo.

- [ ] **Step 1: Aggiornare lo spec (test che fallisce)**

In `command-registry.spec.ts`, aggiungere `openLogs: () => {},` all'oggetto `deps`, e dentro l'`it(...)` esistente aggiungere l'asserzione:

```ts
    expect(cmds.some((c) => c.id === 'open-logs')).toBeTrue();
```

- [ ] **Step 2: Eseguire i test per verificarne il fallimento**

Run: `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL (`open-logs` non presente; e/o TS error se `openLogs` non è nel tipo).

- [ ] **Step 3: Implementare in `command-registry.ts`**

Aggiungere alla `interface CommandDeps` (accanto a `openTerminal`):

```ts
  openLogs: (projectId: string) => void;
```

Dentro il blocco `if (active) { ... }`, insieme agli altri comandi di progetto (es. dopo `reload-context`):

```ts
      { id: 'open-logs', title: 'Open logs', icon: 'scroll-text', action: () => d.openLogs(active.id) },
```

- [ ] **Step 4: Cablare la dep in `app-shell.component.ts`**

Nell'oggetto passato a `buildCommands({ ... })`, accanto a `openTerminal`:

```ts
        openLogs: (p) => this.ui.openLogs(p),
```

- [ ] **Step 5: Eseguire i test**

Run: `cd frontend && bun run test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 6: Verifica manuale**

```bash
bun run dev:backend   # in un terminale
bun run dev:frontend  # in un altro
```
Aprire la UI, `Ctrl/Cmd+K` → "Open logs" → il pannello si apre, mostra i log del progetto attivo, ricerca/filtri e i pulsanti ↑/↓ err navigano tra gli errori.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/services/command-registry.ts frontend/src/app/services/command-registry.spec.ts frontend/src/app/layout/app-shell.component.ts
git commit -m "feat(frontend): add Open logs command to palette"
```

---

## Self-Review

**Spec coverage:**
- Line-assembler ANSI-aware → Task 2 ✓
- Classificazione severità JS+Python + eventi multi-linea → Task 3 ✓
- Store ring 5–10k + marker crash/restart + query + merge cross-servizio → Task 4 ✓
- Endpoint REST query → Task 5 ✓
- Ingestione avviata prima dell'auto-start (attach in `start()`) + registrazione route → Task 6 ✓
- Tipi condivisi → Task 1 ✓
- Pannello frontend (search, regex, severità, multi-servizio via `serviceIds: []`, colore per severità, jump-to-error, follow-tail via polling 1s) → Task 7+8 ✓
- Ingresso command palette → Task 9 ✓
- Persistenza su disco esclusa → nessuna task, corretto ✓

**Note/limiti conservati consapevolmente:**
- Il "colore per servizio" dello spec è reso qui come **colore per severità** + prefisso id servizio nella timeline unificata; usare il campo `color` per-servizio è un raffinamento estetico rimandabile (YAGNI in F1). *Se lo vuoi nella F1, dillo e aggiungo mezzo task.*
- Il componente Angular non ha uno spec Karma dedicato (come `floating-terminal`): la logica testabile è isolata negli helper puri di Task 7; il componente è verificato manualmente.

**Placeholder scan:** nessun TODO/TBD/segnaposto nel codice di implementazione.

**Type consistency:** `LogSeverity`/`StructuredLine`/`LogQuery` usati coerentemente in Task 1→9; `logStore.attach`/`query`/`reset`, `buildLogsQueryString`/`nextErrorIndex` coerenti tra definizione (Task 4/7) e uso (Task 6/8).

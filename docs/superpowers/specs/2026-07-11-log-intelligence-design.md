# Design — Log intelligence (Fase 1 del debug integrato)

Data: 2026-07-11
Stato: approvato (design), in attesa di piano di implementazione

## Contesto: una roadmap, non una singola feature

Il "debug delle app servite dentro pagghiaro" è stato decomposto in quattro
sottosistemi indipendenti, da progettare e implementare uno alla volta (ognuno
con il proprio spec → piano → implementazione):

1. **Log intelligence** — ricerca/filtro, highlight errori, timeline
   multi-servizio, marker crash/restart. *(questo spec)*
2. **Introspezione runtime** — env risolto, cwd, comando espanso, health-check.
3. **Ispezione HTTP** — proxy sulle porte dei servizi per catturare req/resp.
4. **Attach debugger** — Node `--inspect` (9229) e Python `debugpy` come primi
   cittadini; altri runtime best-effort.

Ordine scelto (economico/generico → costoso/specifico): 1 → 2 → 3 → 4. La Fase 1
è anche fondamento delle successive (i marker crash servono all'introspezione, la
timeline serve all'HTTP).

Stack reale target: processi **nativi ed eterogenei** — Node/TS, Python, altri
runtime. Niente Docker. Questo impone che l'highlight riconosca sia stacktrace
JS/Node sia traceback Python.

## Problema

La ritenzione dei log oggi è deliberatamente minimale (`apps/backend/src/log-bus.ts`):

- **Ring buffer da 500 "entry" per servizio, in memoria.** Ma un'entry è un
  **chunk grezzo del PTY**, non una riga: può contenere righe parziali, più righe,
  e sequenze di escape ANSI.
- **Si perde a ogni restart** del backend e viene troncato in fretta sotto carico.
- **Nessuna struttura**: niente concetto di riga, severità, o timestamp per riga.

"Log intelligence" (cercare, filtrare, evidenziare errori, timeline multi-servizio)
richiede dati **orientati alla riga e ANSI-aware**, mentre il modello dati attuale
è "chunk grezzi da dare in pasto a xterm". Serve una rappresentazione strutturata
in parallelo, senza smontare quella live.

## Obiettivi

- Ricerca testuale (con toggle **regex**) sui log storici di uno o più servizi.
- Filtro per **severità** (error / warn / info) e per servizio.
- **Highlight** degli errori e raggruppamento degli stacktrace multi-linea in un
  unico evento, per **JS/Node** e **Python**.
- Navigazione **jump to next/prev error**.
- **Timeline unificata cross-servizio**: righe di più servizi ordinate per
  timestamp, colorate per servizio (riuso del campo `color` già in config).
- **Marker crash/restart** inline nello stream, derivati dai cambi di stato.
- Il **terminale live resta invariato**: la nuova vista "Logs" è distinta e
  additiva.

## Fuori scope (esplicitamente escluso in Fase 1)

- **Persistenza su disco / sopravvivenza al restart del backend.** Il gancio è
  predisposto (dietro flag) ma disattivo: rimandato alla futura Fase B. Confermato
  con l'utente.
- Export/download dei log.
- Indice full-text: a ~5–10k righe/servizio uno scan lineare è sufficiente.
- Configurazione per-servizio della dimensione del buffer oltre a un default
  globale configurabile.
- Sottosistemi 2–4 della roadmap.

## Architettura

Principio: i pezzi "sporchi e insidiosi" (assemblaggio righe, ANSI, `\r`) sono
funzioni **pure e isolate**, testabili senza processi reali. Lo store si limita a
orchestrare. `log-bus.ts` **non viene modificato**: i nuovi componenti si iscrivono
come ulteriori listener.

### Componente 1 — `apps/backend/src/log-line-assembler.ts` (nuovo)

Il pezzo più insidioso, isolato come funzione pura e stateful per-servizio.

Trasforma la sequenza di chunk grezzi del PTY in righe complete:

```ts
export interface AssembledLine {
  raw: string;   // riga con ANSI intatto, per il rendering colorato
  text: string;  // riga con ANSI strippato, per ricerca/classificazione
}

export function createLineAssembler(): {
  // Accetta un chunk grezzo, ritorna 0..N righe completate.
  push(chunk: string): AssembledLine[];
  // Svuota l'eventuale riga parziale residua (a fine processo).
  flush(): AssembledLine[];
};
```

Casi che deve gestire (guidano i test):

- righe spezzate tra più chunk (buffer della riga parziale);
- `\n` e `\r\n`;
- overwrite da `\r` senza newline (spinner/progress bar): la riga logica viene
  sovrascritta, non duplicata;
- strip ANSI **solo** per `text`, preservando `raw`.

### Componente 2 — `apps/backend/src/log-severity.ts` (nuovo)

Classificazione per-riga e raggruppamento eventi multi-linea. Pura e stateful
per-servizio (uno stacktrace attraversa più righe).

```ts
export type LogSeverity = 'error' | 'warn' | 'info';

export function createSeverityClassifier(): {
  // Classifica la riga e indica se continua l'evento (stacktrace) precedente.
  classify(text: string): { severity: LogSeverity; continuesEvent: boolean };
};
```

Euristiche:

- **error**: `Error:`, `fatal`, `panic`, exit non-zero; continuazione JS
  (`    at ...`); traceback Python (`Traceback (most recent call last):`,
  `  File "...", line N`, riga finale `XxxError: ...`).
- **warn**: `warn`/`warning`, `deprecated`.
- **info**: default.

`continuesEvent = true` marca le righe che appartengono allo stacktrace aperto,
così la UI le raggruppa sotto la riga di testa e il jump-to-error salta all'inizio
dell'evento, non a ogni singola riga.

### Componente 3 — `apps/backend/src/log-store.ts` (nuovo)

Orchestratore. Per ogni servizio mantiene un **ring strutturato** di righe.

```ts
export interface StructuredLine {
  seq: number;         // monotono per servizio, per ordinamento stabile
  serviceId: string;
  projectId: string;
  timestamp: number;
  raw: string;
  text: string;
  severity: LogSeverity;
  eventHead: boolean;  // true = prima riga di un evento (o riga singola)
  kind: 'log' | 'marker';   // marker = crash/restart/stop
}

export interface LogQuery {
  serviceIds: string[];   // >1 => merge cross-servizio (timeline unificata)
  q?: string;
  regex?: boolean;
  severity?: LogSeverity; // soglia: >= (info tutte, warn warn+error, error solo)
  since?: number;
  limit?: number;         // default e cap definiti in implementazione
}

export const logStore = {
  query(query: LogQuery): StructuredLine[];
};
```

Comportamento:

- si iscrive a `logBus.subscribeLog` per ogni servizio; ogni chunk passa in
  assembler → classifier → ring;
- si iscrive a `logBus.subscribeStatus`: su `error`/`restarting`/`stopped` inserisce
  una riga `kind: 'marker'` con timestamp, così i confini di sessione sono
  visibili sulla timeline;
- su `logBus` "clear" (già esistente) svuota il ring del servizio;
- ring **~5–10k righe/servizio**, default globale configurabile via env
  (es. `PAGGHIARO_LOG_LINES`);
- `query` con più `serviceIds` fa il **merge ordinato per (timestamp, seq)**.
- **Gancio persistenza (disattivo in F1):** l'ingestione è l'unico punto in cui
  in futuro si scriverà su disco; l'interfaccia dello store non cambierà quando
  la Fase B verrà aggiunta.

### Componente 4 — `apps/backend/src/routes/logs.ts` (nuovo)

Endpoint REST di query storica (il tail live resta sul WS esistente, invariato):

```
GET /api/projects/:projectId/logs
    ?services=<id,id>&q=&regex=&severity=&since=&limit=
```

- valida i parametri con lo schema `t.*` di Elysia (come le altre route);
- 404 se il progetto non esiste;
- default `services` = tutti i servizi del progetto (timeline unificata di default);
- ritorna `StructuredLine[]` già filtrate e ordinate.

### Componente 5 — `packages/shared/src/models.ts`

Aggiunta dei tipi condivisi `LogSeverity`, `StructuredLine`, `LogQuery` (riusati
da backend e frontend). Nessuna modifica ai tipi esistenti.

### Componente 6 — Frontend: pannello "Logs"

- `frontend/src/app/services/logs.service.ts` (nuovo): chiama l'endpoint di query
  e mantiene il tail live agganciandosi al `terminal.service`/WS già esistente.
- `frontend/src/app/logs/logs-panel.component.ts` (nuovo): vista distinta dal
  `floating-terminal`, con:
  - search box + toggle regex;
  - chip filtro severità;
  - multiselect servizi (vista unificata);
  - righe colorate per servizio (campo `color`);
  - **jump next/prev error** (naviga tra le righe `eventHead` con severità error);
  - marker crash/restart resi inline;
  - toggle "follow tail".
- **Punto d'ingresso: command palette.** Si registra un comando (es. "Apri log")
  nel `command-registry` esistente che apre il pannello Logs. Nessun altro entry
  point in Fase 1.

## Flusso dati

```
PTY chunk ──▶ logBus.emit ──┬─▶ (invariato) WS live ──▶ xterm terminale live
                            │
                            └─▶ logStore  ──▶ assembler ──▶ classifier ──▶ ring
                                              (righe strutturate per servizio)

logBus.emitStatus ─────────────▶ logStore  ──▶ marker crash/restart nel ring

Frontend pannello Logs ──GET /api/.../logs──▶ logStore.query ──▶ StructuredLine[]
```

La vista live e la vista intelligence condividono la **stessa sorgente**
(`logBus`) ma due rappresentazioni: chunk grezzi per xterm, righe strutturate per
la query. Nessuna modifica al canale WS o ai tipi esistenti.

## Gestione errori

- Assembler e classifier non lanciano: input malformati (ANSI incompleto, byte
  spuri) degradano a testo grezzo, mai a crash dell'ingestione.
- `query` con `regex` non valida ⇒ 400 con messaggio, invece di 500.
- Se un servizio non ha ancora un ring (mai partito), `query` ritorna lista vuota,
  non 404 (il progetto esiste, il servizio semplicemente non ha log).
- Il ring ha un tetto rigido: nessuna crescita illimitata della memoria anche con
  servizi molto verbosi.

## Testing (TDD)

- **Assembler** (pure): chunk parziali riuniti; `\n` e `\r\n`; overwrite da `\r`
  (una sola riga logica); ANSI strippato in `text` e preservato in `raw`; `flush`
  della riga residua.
- **Classifier** (pure, con fixture reali): stacktrace Node (`Error:` + `at`);
  traceback Python multi-linea con `eventHead` sulla prima riga; warn vs info;
  righe di continuazione marcate `continuesEvent`.
- **Store**: ring rispetta il tetto (drop dei più vecchi); marker inseriti sui
  cambi di stato; `clear` svuota; `query` con soglia severità e con `q`/regex.
- **Merge cross-servizio**: righe di due servizi ordinate per `(timestamp, seq)`.
- **Route**: 404 progetto assente; 400 regex invalida; default = tutti i servizi.

## File toccati

- `apps/backend/src/log-line-assembler.ts` — nuovo (+ test)
- `apps/backend/src/log-severity.ts` — nuovo (+ test)
- `apps/backend/src/log-store.ts` — nuovo (+ test)
- `apps/backend/src/routes/logs.ts` — nuovo (+ test)
- `apps/backend/src/index.ts` — registrazione di `logsRouter` e avvio dell'ingestione
- `packages/shared/src/models.ts` — nuovi tipi `LogSeverity`/`StructuredLine`/`LogQuery`
- `frontend/src/app/services/logs.service.ts` — nuovo
- `frontend/src/app/logs/logs-panel.component.ts` — nuovo
- `frontend/src/app/services/command-registry.ts` — registrazione comando "Apri log"

## Dipendenza da tenere d'occhio

L'ingestione (`logStore` iscritto a `logBus`) deve partire **all'avvio del
backend**, prima/insieme all'auto-start dei servizi, altrimenti i primi log
dell'auto-start non finiscono nel ring. Va agganciata in `index.ts` prima del
blocco `autoStartProjectServices`.

# Design — Diagnostica servizio: introspezione runtime + health-check (Fase 2 del debug)

Data: 2026-07-11
Stato: approvato (design), in attesa di piano di implementazione

## Contesto

Fase 2 della roadmap di debug integrato (Fase 1 = log intelligence, già in `main`).
Le fasi restanti: 3 = ispezione HTTP, 4 = attach debugger. Questa fase copre due
sotto-parti coese di **diagnostica per-servizio**, decise con l'utente:

- **2a — Introspezione statica**: perché un servizio non parte / con cosa gira
  davvero (cwd, comando espanso, env risolto con provenienza, porta, runtime).
- **2b — Health-check base**: è davvero su e risponde? (probe HTTP sulla porta).

Stack target invariato: processi nativi eterogenei (Node/TS, Python, altro).

## Problema

Quando un servizio non parte o "sembra su ma non risponde", oggi l'unico segnale è
l'output nel terminale. Dati che pagghiaro **già calcola** per lanciare il processo
non sono mai mostrati: il cwd risolto (e se esiste), l'`argv` reale passato alla
shell, l'env risolto dai file `.env*` e da `service.env` (e quale layer vince), se
la porta è occupata. Inoltre "running" indica solo che il processo esiste, non che
risponda.

## Decisioni (fissate con l'utente)

- Scope: **2a + 2b (health-check base)** insieme, in un'unica feature coesa.
- **Valori env mostrati in chiaro.** Rischio accettato: i valori (inclusi segreti)
  transitano in chiaro nella response di un endpoint non autenticato e sono visibili
  nel browser. Coerente con la postura locale/non-autenticata dell'app. Il
  mascheramento è esplicitamente **fuori scope**.
- Health "up" = **qualsiasi risposta HTTP** (anche 404/500); "down" = connessione
  rifiutata/timeout; "unknown" = disabilitato / senza porta / non ancora sondato /
  non in esecuzione.
- Entry point UI: **comando in command palette + pulsante sulla riga servizio +
  pallino di salute inline** (tutti e tre).
- Provenienza env: includere anche la **lista dei layer shadowed** (sovrascritti).

## Obiettivi

- Endpoint di introspezione per-servizio che espone cwd/comando/env/porta/runtime/health.
- `cwd`: raw, risolto, **e se esiste**.
- `command`: raw + shell + `argv` reale (stessa espansione usata per lo spawn).
- `env`: per ogni variabile, valore effettivo + **layer vincente** + **layer shadowed**;
  scope ai soli layer configurati (`.env*` di project/service + `service.env`).
- `port`: configurata, **occupata?**, PID in ascolto (read-only, non uccide nulla).
- `runtime`: status, pid, startedAt, uptime, lastExitCode.
- Health-check HTTP opzionale per-servizio, con stato up/down/unknown pollato via
  l'endpoint `states` esistente (nessuna modifica al WS).
- UI: pannello diagnostico + pallino salute inline + comando palette + pulsante riga.

## Fuori scope (Fase 2)

- Mascheramento/redaction dei segreti (escluso su scelta utente).
- Health-check non-HTTP (TCP puro, comando con exit-code), storico/grafici di salute,
  alert/notifiche.
- Introspezione dell'intera `process.env` ereditata dal padre (rumore): si mostra
  solo l'env configurato dall'utente.
- Fasi 3–4 della roadmap.

## Architettura

Principio, come in Fase 1: la logica "sporca" isolata in funzioni pure e testabili;
riuso di codice esistente estraendone le parti già presenti (una sola fonte di
verità); **`log-bus.ts` non modificato**; **nessuna modifica al protocollo WS**.

### Tipi condivisi — `packages/shared/src/models.ts`

```ts
export type HealthState = 'unknown' | 'up' | 'down';

export interface HealthCheckConfig {
  enabled?: boolean;
  path?: string;        // default '/'
  intervalMs?: number;  // default 10000
}

export interface ServiceHealth {
  state: HealthState;
  checkedAt?: number;
  statusCode?: number;  // presente quando è arrivata una risposta HTTP
  detail?: string;      // es. 'ECONNREFUSED', 'timeout'
}

export interface EnvVarProvenance {
  key: string;
  value: string;
  source: string;                                  // layer vincente
  shadowed: Array<{ source: string; value: string }>;  // layer sovrascritti, in ordine
}

export interface CommandExpansion { raw: string; shell: string; argv: string[]; }
export interface CwdInfo { raw: string; resolved: string; exists: boolean; }
export interface PortInfo { configured: number; inUse: boolean; pids: number[]; }
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
```
Aggiunte a tipi esistenti: `ServiceConfig.healthCheck?: HealthCheckConfig`;
`ServiceState.health?: ServiceHealth`. Nomi delle sorgenti env (label stringa):
`project/.env`, `project/.env.local`, `project/.env.<mode>`, `project/.env.<mode>.local`,
gli stessi con prefisso `service/` quando il service-root differisce dal project-root,
e `service.env` per l'env inline nel config.

### Riuso/refactor (estrazione, nessun cambio di comportamento)

- `apps/backend/src/pty-adapter.ts`: **esportare** `resolveShellArgs(command): [string, ...string[]]`
  (oggi privata). L'introspezione la usa per produrre `command.argv`/`shell`, così
  spawn e diagnostica condividono un'unica espansione.
- `apps/backend/src/port-processes.ts`: **esportare** `findListeningPids(port): Promise<number[]>`
  (oggi privata, read-only, non uccide). L'introspezione la usa per `port.inUse`/`pids`.
- `apps/backend/src/process-context.ts`: **aggiungere** `describeServiceEnv(projectRootPath, service): Promise<EnvVarProvenance[]>`.
  Rilegge i layer nello stesso ordine di `buildServiceProcessContext` ma **etichettati**,
  ripiegandoli in una mappa che tiene il valore vincente e accumula i shadowed.
  `buildServiceProcessContext` resta invariata (fonte di verità del merge effettivo).

### Componente — `apps/backend/src/health-monitor.ts` (nuovo)

Modellato su `metricsCollector` (track/untrack + stato in memoria).

```ts
export function classifyProbe(result:
  | { ok: true; status: number }
  | { ok: false; detail: string }
): ServiceHealth;   // funzione PURA: ok→{state:'up',statusCode}, !ok→{state:'down',detail}

export const healthMonitor = {
  track(serviceId: string, opts: { port: number; path: string; intervalMs: number }): void;
  untrack(serviceId: string): void;
  getHealth(serviceId: string): ServiceHealth;   // 'unknown' se non tracciato
};
```
- `track` avvia un `setInterval(intervalMs)` che fa `GET http://127.0.0.1:<port><path>`
  con timeout (`AbortController`, ~3000ms); il risultato passa per `classifyProbe`
  e aggiorna lo stato in memoria. Idempotente (track ripetuto non duplica il timer).
- `untrack` ferma il timer e rimuove lo stato (torna implicitamente 'unknown').

### Componente — `apps/backend/src/service-introspection.ts` (nuovo)

Compone il bundle `ServiceIntrospection` da: `describeServiceEnv`, `resolveShellArgs`,
`resolveCwd`+`existsSync`, `findListeningPids`, `processManager.getState`,
`healthMonitor.getHealth`, `startedAt`→`uptimeMs`. Funzione pura di assemblaggio dove
possibile; gli accessi a FS/PID sono isolati.

### Route

- **Nuova** `apps/backend/src/routes/introspection.ts`:
  `GET /api/projects/:projectId/services/:serviceId/introspect` → 404 se progetto o
  servizio assente, altrimenti il bundle. Registrata in `index.ts` con `.use(...)`.
- **Modifica** `apps/backend/src/routes/services.ts`, endpoint
  `GET /api/projects/:projectId/services/:serviceId/state`: arricchire il
  `ServiceState` restituito con `health: healthMonitor.getHealth(serviceId)`. È
  l'endpoint che il frontend polla realmente ogni 2s (`startPolling` →
  `fetchServiceState`), quindi la salute vi transita senza nuovo canale.

### Wiring runtime — `apps/backend/src/process-manager.ts`

- In `start()`: se `service.healthCheck?.enabled === true` **e** `service.port != null`,
  chiamare `healthMonitor.track(service.id, { port, path: healthCheck.path ?? '/',
  intervalMs: healthCheck.intervalMs ?? 10000 })` dopo lo spawn riuscito.
- In `stop()`: `healthMonitor.untrack(serviceId)` accanto a `metricsCollector.untrack`.

### Validazione config — `apps/backend/src/config-store.ts`

`isServiceConfig` accetta `healthCheck` opzionale: se presente, oggetto con
`enabled?boolean`, `path?string`, `intervalMs?number` finito ≥ 0.

### Frontend

- `frontend/src/app/services/introspection.service.ts` (nuovo): `fetchIntrospection(projectId, serviceId)` via `fetch` (stile `logs.service`).
- `UiService`: `introspectTarget` (signal `{projectId,serviceId}|null`) + `openIntrospect(projectId, serviceId)`/`closeIntrospect()`, sul pattern dei modali esistenti.
- `frontend/src/app/diagnostics/introspection-panel.component.ts` (nuovo): sezioni
  cwd (con badge se non esiste) / comando (`argv`) / env (tabella key–value–source,
  badge sui shadowed espandibili) / porta (occupata? PID) / runtime / health corrente.
- **Pallino salute inline**: `service-row.component.ts` mostra un dot da `service.health`
  (unknown=grigio, up=verde, down=rosso); il modello UI del servizio (`project.model` +
  mapping in `project.service.ts`) trasporta `health` dal polling `states`.
- **Pulsante riga**: `service-row.component.ts` aggiunge un `ui-icon-button` (es. icona
  `stethoscope`/`activity`) con `@Output() inspect`, cablato in `service-list.component.ts`
  a `ui.openIntrospect(project.id, service.id)`.
- **Comando palette**: `command-registry.ts` aggiunge `inspectService` a `CommandDeps`
  e un comando per servizio `{ id: 'inspect:<sid>', title: 'Inspect <name>' }`; wiring
  in `app-shell.component.ts`. Pannello reso nello shell dietro `@if (ui.introspectTarget())`.
- `config-form.component.ts`: 3 controlli per `healthCheck` (enable / path / intervalMs).

## Flusso dati

```
Introspezione (on-demand):
  UI (palette | pulsante riga) → openIntrospect → panel
    → GET /api/projects/:p/services/:s/introspect
    → service-introspection compone da: describeServiceEnv, resolveShellArgs,
      resolveCwd+existsSync, findListeningPids, processManager.getState, healthMonitor
    → ServiceIntrospection

Health (continuo):
  processManager.start() → healthMonitor.track (se enabled+port)
    → setInterval: GET 127.0.0.1:port/path → classifyProbe → stato in memoria
  frontend polling (2s) → GET /.../services/:s/state (arricchito con health) → pallino riga
  processManager.stop() → healthMonitor.untrack
```
Terminale live e canale WS invariati. Nessun nuovo canale realtime: la salute viaggia
sul polling `states` già esistente.

## Gestione errori

- `describeServiceEnv`: file mancanti ignorati (come oggi); parse robusto già esistente.
- `resolveShellArgs`/introspezione non lanciano: un cwd inesistente non è un errore
  dell'endpoint, è un dato (`exists:false`).
- `findListeningPids`: su fallimento dei comandi di sistema torna `[]` (già così);
  `inUse = pids.length > 0`.
- Probe health: qualsiasi rejection/timeout → `{state:'down', detail}`; mai eccezioni
  non gestite nel timer (try/catch interno). Timer sempre fermato in `untrack`.
- Route: 404 se progetto/servizio assente; nessun 500 per dati diagnostici mancanti.

## Testing (TDD)

- **Puri/unità (bun:test)**:
  - `resolveShellArgs` estratta: forma Unix (`/bin/sh -c cmd`) e Windows (`cmd.exe /d /s /c cmd`).
  - `describeServiceEnv`: layering con fixture — var definita in `.env` e sovrascritta
    in `.env.local` e in `service.env` → `source` vincente = `service.env`, `shadowed`
    elenca gli altri due in ordine; var solo in `.env` → nessun shadowed.
  - `classifyProbe`: `{ok:true,status:404}`→up/statusCode 404; `{ok:false,'ECONNREFUSED'}`→down/detail.
  - `findListeningPids` read-only: non uccide (verifica che un processo su una porta
    resti vivo dopo la query).
- **Route (bun:test via `.handle()`)**: introspect 404 progetto/servizio assente;
  `GET .../:serviceId/state` include `health` nel corpo.
- **Health-monitor**: `track` idempotente (no doppio timer); `untrack` ferma il timer e
  riporta a 'unknown'. (Probing reale isolato dietro l'iniezione della fetch dove serve.)
- **Frontend (Jasmine)**: mapping `health` nel modello servizio; classe/colore del dot
  per stato; `buildCommands` include `inspect:<sid>`.

## File toccati

- `packages/shared/src/models.ts` — nuovi tipi + `ServiceConfig.healthCheck?` + `ServiceState.health?`
- `apps/backend/src/pty-adapter.ts` — esporta `resolveShellArgs`
- `apps/backend/src/port-processes.ts` — esporta `findListeningPids`
- `apps/backend/src/process-context.ts` — aggiunge `describeServiceEnv`
- `apps/backend/src/health-monitor.ts` — nuovo (+ test)
- `apps/backend/src/service-introspection.ts` — nuovo (+ test)
- `apps/backend/src/routes/introspection.ts` — nuovo (+ test)
- `apps/backend/src/routes/services.ts` — `GET .../:serviceId/state` arricchito con health
- `apps/backend/src/process-manager.ts` — track/untrack health nel ciclo start/stop
- `apps/backend/src/config-store.ts` — validazione `healthCheck`
- `apps/backend/src/index.ts` — registra `introspectionRouter`
- `frontend/src/app/services/introspection.service.ts` — nuovo
- `frontend/src/app/services/ui.service.ts` — openIntrospect/closeIntrospect
- `frontend/src/app/diagnostics/introspection-panel.component.ts` — nuovo
- `frontend/src/app/dashboard/service-row.component.ts` — dot salute + pulsante inspect
- `frontend/src/app/dashboard/service-list.component.ts` — cabla inspect
- `frontend/src/app/models/project.model.ts` + `services/project.service.ts` — `health` nel modello + mapping
- `frontend/src/app/services/command-registry.ts` (+ spec) + `layout/app-shell.component.ts` — comando + render pannello
- `frontend/src/app/components/config-form/config-form.component.ts` — controlli healthCheck

## Dipendenza da tenere d'occhio

`describeServiceEnv` deve rispecchiare **esattamente** l'ordine di precedenza di
`buildServiceProcessContext` (projectEnv → serviceEnv → `service.env`), altrimenti la
provenienza mostrata divergerebbe dall'env reale del processo. I due vanno tenuti
allineati (idealmente `buildServiceProcessContext` potrebbe in futuro derivare dal
risultato di `describeServiceEnv`, ma per questa fase restano due percorsi che
condividono `loadEnvDirectory`/l'ordine dei file).

# Design — Attach debugger: inspect enablement + connection surfacing (Fase 4 del debug)

Data: 2026-07-11
Stato: approvato (design), in attesa di piano di implementazione

## Contesto

Fase 4 (ultima) della roadmap di debug integrato (Fasi 1-3 in `main`: log
intelligence, service diagnostics, HTTP inspector). Pagghiaro **non incorpora un
debugger** (breakpoint/step vivono in DevTools/VS Code): il ruolo realistico è
**abilitare la modalità inspect di un servizio e mostrare come/dove agganciare** il
debugger esistente dell'utente. Deciso con l'utente: Node-first via
`NODE_OPTIONS=--inspect`, Python best-effort (solo snippet/porta), più un
**break-in SIGUSR1** su Unix per un Node già in esecuzione.

## Decisioni (fissate con l'utente)

- **Node**: all'avvio, se il servizio ha `debug.enabled`, iniettare/appendere
  `NODE_OPTIONS=--inspect=127.0.0.1:<port>` nell'env (richiede riavvio del servizio).
- **Porta debug** default `debug.port ?? 9229`; servizi debuggati in parallelo
  richiedono porte distinte (avvertenza, non enforcement).
- **Break-in** (`SIGUSR1`) su Unix apre l'inspector sul **default 9229** (documentato;
  ignora un `debug.port` custom a meno che l'inspector non sia già stato avviato con
  quella porta). Su Windows non supportato (niente SIGUSR1).
- **Python**: best-effort — la UI mostra porta + snippet
  `python -m debugpy --listen 127.0.0.1:<port> --wait-for-client <script>`; nessuna
  auto-iniezione.
- Entry point UI: **comando palette + pulsante sulla riga servizio** (icona `bug`).
- La UI **non** può aprire link `devtools://`/`chrome://` (bloccati dal browser):
  mostra endpoint `ws://` + porta con copy, e istruzioni per `chrome://inspect` / VS
  Code attach.

## Problema

Per debuggare un servizio serve avviarlo in modalità inspect e conoscere l'endpoint a
cui agganciarsi — passaggi manuali e facili da sbagliare. Pagghiaro conosce comando,
env, pid e porta: può abilitare l'inspect (Node) e sondare l'endpoint dell'inspector
per mostrarlo.

## Obiettivi

- Config `debug` per-servizio; iniezione `NODE_OPTIONS=--inspect` all'avvio (Node).
- Endpoint che riporta `{ enabled, port, platform, breakInSupported, listening, wsUrl }`
  sondando `http://127.0.0.1:<port>/json/list` dell'inspector Node quando attivo.
- Endpoint break-in (`SIGUSR1`, Unix) per aprire l'inspector su 9229 senza riavvio.
- Pannello debug: stato + ws-endpoint copiabile + istruzioni chrome/VS Code + break-in
  (Unix) + snippet debugpy (Python).
- Editing `debug` nel config-form.
- `log-bus.ts` intatto; nessuna modifica al WS del terminale.

## Fuori scope (Fase 4)

- Debugger incorporato (breakpoint/step nella UI).
- Auto-iniezione `debugpy` per Python; attach a runtime non-Node.
- Multi-target del `/json/list` (si usa il primo target).
- Apertura automatica di DevTools/VS Code (impossibile da una pagina web).

## Architettura

Principio come nelle fasi precedenti: logica pura isolata/testabile; riuso dei
pattern esistenti; `log-bus.ts` intatto. L'iniezione di `NODE_OPTIONS` passa
attraverso `pty-adapter` senza problemi (filtra solo le var con prefisso `PAGGHIARO_`).

### Tipi condivisi — `packages/shared/src/models.ts`

```ts
export interface DebugConfig {
  enabled?: boolean;
  port?: number;
}

export interface DebugInfo {
  enabled: boolean;
  port: number;
  platform: string;          // process.platform
  breakInSupported: boolean; // platform !== 'win32'
  listening: boolean;        // inspector risponde su /json/list
  wsUrl?: string;            // webSocketDebuggerUrl del primo target
}
// ServiceConfig gains: debug?: DebugConfig
```

### Componente — `apps/backend/src/debug-options.ts` (nuovo, puro)

```ts
export const DEBUG_DEFAULT_PORT = 9229;

// Appende --inspect all'eventuale NODE_OPTIONS esistente senza clobberarlo.
export function buildDebugNodeOptions(existing: string | undefined, port: number): string;
```
`buildDebugNodeOptions(undefined, 9229)` → `--inspect=127.0.0.1:9229`;
`buildDebugNodeOptions('--max-old-space-size=256', 9230)` →
`--max-old-space-size=256 --inspect=127.0.0.1:9230`. Pura, testabile.

### Componente — `apps/backend/src/debug-inspector.ts` (nuovo)

```ts
// Sonda l'inspector Node; ritorna il webSocketDebuggerUrl del primo target o null.
export async function fetchInspectorWsUrl(port: number): Promise<string | null>;
```
`GET http://127.0.0.1:<port>/json/list` con timeout (~1500ms, AbortController); su
non-ok / errore / lista vuota → `null`. Isolata per testabilità (fake server nei test).

### Wiring — `apps/backend/src/process-manager.ts`

In `start()`, dopo `buildServiceProcessContext(...)` e PRIMA di `spawnPty`, se
`service.debug?.enabled === true`:
```ts
processContext['NODE_OPTIONS'] = buildDebugNodeOptions(processContext['NODE_OPTIONS'], service.debug.port ?? DEBUG_DEFAULT_PORT);
```
Nessun'altra modifica al ciclo di vita (l'inspector muore col processo).

### Route — `apps/backend/src/routes/debug.ts` (nuovo)

- `GET /api/projects/:projectId/services/:serviceId/debug` → 404 se progetto/servizio
  assente; altrimenti compone `DebugInfo`: `enabled` dal config, `port = debug.port ?? 9229`,
  `platform`, `breakInSupported = process.platform !== 'win32'`. Se `enabled` **e** il
  servizio è in esecuzione (`processManager.getState(serviceId)?.status === 'running'`),
  `wsUrl = await fetchInspectorWsUrl(port)` e `listening = wsUrl != null`; altrimenti
  `listening = false`.
- `POST /api/projects/:projectId/services/:serviceId/debug/break-in` → 404 se assente;
  se `process.platform === 'win32'` → 400 "Break-in not supported on Windows"; se il
  servizio non è in esecuzione (nessun pid) → 400; altrimenti
  `process.kill(pid, 'SIGUSR1')` (pid da `processManager.getState`), ritorna
  `{ ok: true, port: 9229 }`. Errori del kill → 400 con messaggio.
Registrata in `index.ts`.

### Config — `config-store.ts` + `routes/services.ts`

- `isServiceConfig`: accetta `debug` opzionale (`enabled?boolean`, `port?` numero finito ≥0).
- `CreateServiceSchema`/`UpdateServiceSchema`: campo `debug` opzionale; pass-through nel create handler.

### Frontend

- `frontend/src/app/services/debug.service.ts` (nuovo): `fetchDebugInfo(p,s)`, `breakIn(p,s)` via `fetch`.
- `UiService`: `debugTarget` signal (`{projectId,serviceId}|null`) + `openDebug`/`closeDebug`.
- `frontend/src/app/debug/debug-panel.component.ts` (nuovo): stato (enabled/port/listening),
  **ws-endpoint copiabile**, istruzioni chrome://inspect + snippet VS Code `launch.json`,
  pulsante **Break in** (mostrato solo se `breakInSupported`), snippet debugpy per Python.
  Polling leggero mentre aperto (stop in `ngOnDestroy`).
- `service-row.component.ts`: pulsante `@Output() debug` (icona `bug`).
- `service-list.component.ts`: cabla `(debug)="ui.openDebug(project.id, service.id)"`.
- `command-registry.ts` (+ spec) + `app-shell.component.ts`: comando `debug:<sid>` "Debug: <name>" + render pannello dietro `@if (ui.debugTarget())`.
- `config-form.component.ts` + `config-form.model.ts` + `project.service.ts` (`saveProjectDraft`): controlli `debug` (enable + port) con round-trip (mirror di `healthCheck`/`httpInspect`).
- `app.config.ts`: registrare l'icona `Bug`.

## Flusso dati

```
Enable: config debug.enabled → processManager.start injects NODE_OPTIONS=--inspect
  → (riavvio) Node apre l'inspector su 127.0.0.1:<port>
Info: UI → GET /debug → (se enabled+running) fetchInspectorWsUrl(/json/list) → { listening, wsUrl, ... }
Break-in (Unix): UI → POST /debug/break-in → process.kill(pid,'SIGUSR1') → inspector su 9229
```
Nessun nuovo canale realtime: il pannello polla `/debug` via REST.

## Gestione errori

- `fetchInspectorWsUrl`: qualsiasi errore/timeout/non-ok → `null` (mai lancia); `listening:false`.
- Break-in: Windows → 400; nessun pid → 400; kill fallito (ESRCH/EPERM) → 400 con messaggio; mai 500.
- Route: 404 se progetto/servizio assente.
- Iniezione NODE_OPTIONS: se il servizio non è Node, la var è innocua (ignorata da altri runtime).

## Testing (TDD)

- **Puro (bun:test)**: `buildDebugNodeOptions` — undefined→flag; esistente→append; stringa vuota→flag.
- **Inspector**: `fetchInspectorWsUrl` con un fake `Bun.serve` che espone `/json/list`
  con `[{webSocketDebuggerUrl}]` → ritorna l'url; porta irraggiungibile → null; lista vuota → null.
- **Route (via .handle())**: `GET /debug` 404 progetto assente; break-in su Windows → 400
  (test condizionato a `process.platform`); su Unix con servizio non in esecuzione → 400.
- **Config**: `isServiceConfig` accetta/rifiuta `debug`.
- **Frontend (Jasmine)**: `buildCommands` include `debug:<sid>`.

## File toccati

- `packages/shared/src/models.ts` — `DebugConfig`/`DebugInfo` + `ServiceConfig.debug?`
- `apps/backend/src/debug-options.ts` — nuovo (+ test)
- `apps/backend/src/debug-inspector.ts` — nuovo (+ test)
- `apps/backend/src/process-manager.ts` — iniezione NODE_OPTIONS all'avvio
- `apps/backend/src/routes/debug.ts` — nuovo (+ test)
- `apps/backend/src/config-store.ts` — validazione `debug`
- `apps/backend/src/routes/services.ts` — schemi Create/Update + pass-through
- `apps/backend/src/index.ts` — registra `debugRouter`
- `frontend/src/app/services/debug.service.ts` — nuovo
- `frontend/src/app/services/ui.service.ts` — open/close
- `frontend/src/app/debug/debug-panel.component.ts` — nuovo
- `frontend/src/app/dashboard/service-row.component.ts` — pulsante debug
- `frontend/src/app/dashboard/service-list.component.ts` — cabla debug
- `frontend/src/app/services/command-registry.ts` (+ spec) + `layout/app-shell.component.ts` — comando + render
- `frontend/src/app/components/config-form/config-form.component.ts` + `models/config-form.model.ts` + `services/project.service.ts` — editing `debug`
- `frontend/src/app/app.config.ts` — icona `Bug`

## Nota di sicurezza (coerente con la postura accettata)

L'inspector Node in ascolto è un **canale di esecuzione di codice remoto**: chiunque
possa raggiungere `127.0.0.1:<port>` può controllare il processo. Vincolato a
`127.0.0.1` e attivo solo per servizi con `debug.enabled` (opt-in). Stessa postura
locale-only già accettata; nessun hardening in questa fase. Vedi la nota di sicurezza
complessiva del progetto.

# Design — HTTP inspector: reverse proxy + request console (Fase 3 del debug)

Data: 2026-07-11
Stato: approvato (design), in attesa di piano di implementazione

## Contesto

Fase 3 della roadmap di debug integrato (Fase 1 = log intelligence, Fase 2 =
diagnostica servizio, entrambe in `main`). Resta la Fase 4 (attach debugger).
Questa fase è una feature coesa di **ispezione HTTP** con due sorgenti di scambi
req/resp, decise con l'utente: (a) un **reverse proxy** che cattura il traffico
reale, e (b) una **console di richieste** (mini-Postman) per richieste manuali.

## Decisioni (fissate con l'utente)

- Perimetro proxy nel primo taglio: **HTTP-only**; **WebSocket/upgrade inoltrati in
  modo trasparente ma NON registrati** (l'app continua a funzionare); **niente
  terminazione HTTPS** (dev server locali in chiaro).
- **Porta proxy** = `httpInspect.proxyPort` se impostata, altrimenti
  `service.port + 10000`.
- **Ring 200 scambi/servizio**, **body cap 64 KB** (oltre → troncato; body binari
  per content-type → non catturati/marcati).
- **Console indipendente dal proxy**: invia diretta a `http://127.0.0.1:<port>`,
  funziona anche a proxy spento.
- Entry point UI: **comando palette + pulsante sulla riga servizio**.

## Problema

Durante lo sviluppo non c'è modo, dentro pagghiaro, di vedere cosa un servizio
riceve/risponde su HTTP. Oggi si esce verso strumenti esterni (curl, Postman,
DevTools). Pagghiaro conosce già porta e stato di ogni servizio: può frapporsi
(proxy) o inviare richieste (console) e mostrare gli scambi.

## Obiettivi

- Store per-servizio degli scambi HTTP (ring 200) con modello unificato.
- Reverse proxy per-servizio (opt-in via config) su una porta dedicata, che inoltra
  a `127.0.0.1:<service.port>` e registra ogni scambio HTTP (metodo, path, headers,
  status, timing, body con cap); WS inoltrato non registrato.
- Console: comporre/inviare una richiesta al servizio e registrarne lo scambio.
- Pannello inspector: lista scambi (metodo/path/status/durata, colore per status) +
  dettaglio (headers e body di req/resp) + form console.
- Nessuna modifica a `log-bus.ts`, nessuna modifica al protocollo WS del terminale.

## Fuori scope (Fase 3)

- HTTPS/TLS, cattura dei frame WebSocket, streaming/SSE passthrough (il proxy
  bufferizza e non fa streaming), replay/edit-and-resend, persistenza su disco,
  filtri/ricerca avanzati, autenticazione (invariata: come tutta l'app — vedi la
  nota di sicurezza).
- Fase 4 della roadmap.

## Architettura

Principio come nelle fasi precedenti: logica "sporca" isolata in funzioni pure;
riuso dei pattern esistenti (store come `log-store`; ciclo di vita come
`healthMonitor`/`metricsCollector`); `log-bus.ts` intatto.

### Tipi condivisi — `packages/shared/src/models.ts`

```ts
export type HttpExchangeSource = 'proxy' | 'console';

export interface HttpHeader { name: string; value: string; }

export interface HttpCapturedBody {
  text?: string;         // presente se catturato (testo)
  truncated?: boolean;   // true se oltre il cap
  binary?: boolean;      // true se non catturato perché binario
  byteLength?: number;   // dimensione reale osservata
}

export interface HttpRequestRecord {
  method: string;
  path: string;                 // path + query, es. "/api/users?id=1"
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
  response?: HttpResponseRecord;  // assente se error
  error?: string;                 // forward/console fallito
}

export interface HttpInspectConfig {
  enabled?: boolean;
  proxyPort?: number;
}
// ServiceConfig gains: httpInspect?: HttpInspectConfig
```

### Componente — `apps/backend/src/http-body.ts` (nuovo, puro)

```ts
export const HTTP_BODY_CAP_BYTES = 64 * 1024;

// Decide come registrare un body dato il content-type e i byte grezzi.
export function captureBody(contentType: string | null, bytes: Uint8Array): HttpCapturedBody | undefined;
```
- `bytes` vuoto → `undefined`.
- content-type "testuale" (text/*, application/json, x-www-form-urlencoded, xml,
  javascript, ecc.) → `text` (decodificato), troncato a `HTTP_BODY_CAP_BYTES` con
  `truncated: true`, sempre `byteLength`.
- altrimenti → `{ binary: true, byteLength }` (nessun testo).
Funzione pura, testabile.

### Componente — `apps/backend/src/http-capture-store.ts` (nuovo)

Ring per-servizio, modellato su `log-store`/`metricsCollector`.
```ts
export const httpCaptureStore = {
  add(exchange: HttpExchange): void;                 // ring cap 200/servizio
  query(serviceId: string): HttpExchange[];          // ordine cronologico
  clear(serviceId: string): void;
  reset(): void;                                     // helper di test
};
```

### Componente — `apps/backend/src/http-proxy.ts` (nuovo)

Ciclo di vita come `healthMonitor` (start/stop, stato in memoria dei server).
```ts
export const proxyManager = {
  start(serviceId: string, opts: { proxyPort: number; targetPort: number }): void; // idempotente
  stop(serviceId: string): void;
  getProxyPort(serviceId: string): number | undefined;
};
```
- `start` apre `Bun.serve({ port: proxyPort, fetch, websocket })`:
  - **HTTP**: legge il body della richiesta in un buffer (una volta), costruisce un
    `HttpRequestRecord` (via `captureBody`), inoltra a
    `http://127.0.0.1:<targetPort><path>` con metodo/headers/body (rimuovendo gli
    header hop-by-hop), misura la durata, legge il body della risposta in buffer,
    costruisce `HttpResponseRecord`, `httpCaptureStore.add(...)`, e ritorna una
    `Response` fedele (status/headers/body) al client. Su errore di forward →
    scambio con `error`, e `502` al client.
  - **WebSocket/upgrade**: se l'header `upgrade: websocket` è presente, `server.upgrade`
    e in `websocket.open` apre un client `new WebSocket("ws://127.0.0.1:<targetPort><path>")`,
    fa da bridge bidirezionale (message↔message, close↔close). **Nessuna
    registrazione.** Se il bridge non è instaurabile, chiude pulito.
- `stop` chiude il `Bun.serve` (`server.stop(true)`) e rimuove lo stato.
- Idempotente: `start` due volte per lo stesso servizio non riapre.

Nota: streaming/SSE non è supportato (buffering) — fuori scope dichiarato.

### Componente — `apps/backend/src/http-console.ts` (nuovo)

```ts
export async function sendConsoleRequest(
  serviceId: string,
  targetPort: number,
  input: { method: string; path: string; headers: HttpHeader[]; body?: string }
): Promise<HttpExchange>;
```
Esegue `fetch("http://127.0.0.1:<targetPort><path>", ...)`, cattura req/resp con gli
stessi helper del proxy, `source: 'console'`, `httpCaptureStore.add(...)`, ritorna lo
scambio (con `error` se il fetch fallisce). Non dipende dal proxy.

### Route — `apps/backend/src/routes/http-inspect.ts` (nuovo)

- `GET  /api/projects/:projectId/services/:serviceId/http` → `httpCaptureStore.query(serviceId)` (404 se progetto/servizio assente).
- `POST /api/projects/:projectId/services/:serviceId/http/send` → valida il corpo (method/path/headers?/body?), risolve la porta del servizio (404 se assente, 400 se il servizio non ha `port`), chiama `sendConsoleRequest`, ritorna lo scambio.
- `DELETE /api/projects/:projectId/services/:serviceId/http` → `clear`, 204.
Registrata in `index.ts`.

### Wiring — `apps/backend/src/process-manager.ts`

- In `start()` (dopo spawn riuscito), se `service.httpInspect?.enabled === true && service.port != null`:
  `proxyManager.start(service.id, { proxyPort: service.httpInspect.proxyPort ?? service.port + 10000, targetPort: service.port })`.
- In `stop()` e nell'handler `pty.exited`: `proxyManager.stop(service.id)` (accanto a `healthMonitor.untrack`).

### Config — `apps/backend/src/config-store.ts` + `routes/services.ts`

- `isServiceConfig`: accetta `httpInspect` opzionale (`enabled?boolean`, `proxyPort?` numero finito ≥ 0).
- `CreateServiceSchema`/`UpdateServiceSchema`: campo `httpInspect` opzionale; pass-through nel create handler.

### Frontend

- `frontend/src/app/services/http-inspector.service.ts` (nuovo): `fetchExchanges(p,s)`, `send(p,s,input)`, `clear(p,s)` via `fetch`.
- `UiService`: `httpInspectTarget` signal (`{projectId,serviceId}|null`) + `openHttpInspect`/`closeHttpInspect` (pattern dei modali).
- `frontend/src/app/http/http-inspector-panel.component.ts` (nuovo): lista scambi
  (metodo, path, status colorato, durata) a sinistra, dettaglio (headers + body req/resp)
  a destra, e un form console in alto (method select, path input, headers, body,
  bottone Send). Polling leggero mentre aperto (stop in `ngOnDestroy`, come il logs-panel).
  Mostra la porta proxy quando attiva.
- `service-row.component.ts`: pulsante `@Output() httpInspect` (icona `arrow-left-right`).
- `service-list.component.ts`: cabla `(httpInspect)="ui.openHttpInspect(project.id, service.id)"`.
- `command-registry.ts` (+ spec) + `app-shell.component.ts`: comando `http:<sid>` "HTTP inspector: <name>" + render pannello dietro `@if (ui.httpInspectTarget())`.
- `config-form.component.ts` + `config-form.model.ts` + `project.service.ts` (`saveProjectDraft`): controlli `httpInspect` (enable + proxyPort) con round-trip.
- `app.config.ts`: registrare l'icona `ArrowLeftRight` se non presente.

## Flusso dati

```
Proxy (traffico reale):
  client → Bun.serve(proxyPort) → [capture req] → fetch 127.0.0.1:targetPort → [capture resp]
    → httpCaptureStore.add(source:'proxy') → Response al client
  WS: client ⇄ Bun.serve ⇄ WebSocket(127.0.0.1:targetPort)  (bridge, non registrato)

Console:
  UI form → POST /http/send → sendConsoleRequest → fetch 127.0.0.1:targetPort
    → httpCaptureStore.add(source:'console') → exchange in risposta

Inspector panel → GET /http (polling) → lista scambi (proxy + console)

Lifecycle: processManager.start → proxyManager.start (se enabled+port); stop/exit → proxyManager.stop
```
Nessun nuovo canale realtime: la lista scambi è pollata via REST.

## Gestione errori

- `captureBody`/store: mai lanciano; body assente → `undefined`.
- Proxy: errore di forward → scambio con `error` + `502` al client; il `Bun.serve`
  non deve crashare su una singola richiesta (try/catch per-richiesta).
- WS bridge: qualsiasi errore chiude entrambe le socket senza propagare.
- `stop` idempotente; nessun server proxy lasciato aperto dopo stop/exit del servizio.
- Route console: `fetch` fallito → scambio con `error` (200 con l'exchange, non 500),
  così la UI lo mostra.
- Collisione porta proxy (già in uso): il proxy logga e non parte; non blocca lo start
  del servizio.

## Testing (TDD)

- **Puri (bun:test)**: `captureBody` — vuoto→undefined; JSON/text→text+byteLength;
  oltre cap→troncato; binario (es. image/png)→`{binary,byteLength}`. Header hop-by-hop
  filter (funzione pura di sanitizzazione headers).
- **Store**: ring cap 200 (drop dei più vecchi); `query` cronologico; `clear`; `reset`.
- **Proxy (integrazione)**: avvia un `Bun.serve` target di prova; `proxyManager.start`
  su una porta proxy; una GET e una POST attraverso il proxy → il client riceve la
  risposta del target E lo store registra lo scambio con status/body corretti; `stop`
  chiude il proxy (porta libera). (WS bridge: test best-effort di connessione+echo se
  fattibile, altrimenti verificato manualmente.)
- **Console**: `sendConsoleRequest` verso un target di prova registra lo scambio;
  target irraggiungibile → scambio con `error`.
- **Route (via .handle())**: `GET /http` 404 progetto assente; `/http/send` 400 se il
  servizio non ha porta.
- **Config**: `isServiceConfig` accetta/rifiuta `httpInspect`.
- **Frontend (Jasmine)**: `buildCommands` include `http:<sid>`; classe/colore per
  status; mapping base.

## File toccati

- `packages/shared/src/models.ts` — tipi HTTP + `ServiceConfig.httpInspect?`
- `apps/backend/src/http-body.ts` — nuovo (+ test)
- `apps/backend/src/http-capture-store.ts` — nuovo (+ test)
- `apps/backend/src/http-proxy.ts` — nuovo (+ test integrazione)
- `apps/backend/src/http-console.ts` — nuovo (+ test)
- `apps/backend/src/routes/http-inspect.ts` — nuovo (+ test)
- `apps/backend/src/process-manager.ts` — start/stop proxy nel ciclo di vita
- `apps/backend/src/config-store.ts` — validazione `httpInspect`
- `apps/backend/src/routes/services.ts` — schemi Create/Update + pass-through
- `apps/backend/src/index.ts` — registra `httpInspectRouter`
- `frontend/src/app/services/http-inspector.service.ts` — nuovo
- `frontend/src/app/services/ui.service.ts` — open/close
- `frontend/src/app/http/http-inspector-panel.component.ts` — nuovo
- `frontend/src/app/dashboard/service-row.component.ts` — pulsante httpInspect
- `frontend/src/app/dashboard/service-list.component.ts` — cabla httpInspect
- `frontend/src/app/services/command-registry.ts` (+ spec) + `layout/app-shell.component.ts` — comando + render
- `frontend/src/app/components/config-form/config-form.component.ts` + `models/config-form.model.ts` + `services/project.service.ts` — editing `httpInspect`
- `frontend/src/app/app.config.ts` — icona `ArrowLeftRight`

## Nota di sicurezza (coerente con la decisione già presa)

Il reverse proxy apre una **porta aggiuntiva** in ascolto (default `port+10000`) che
inoltra al servizio, e cattura req/resp (potenzialmente con dati sensibili) in memoria,
esposti dall'endpoint `/http` non autenticato con CORS `*`. È la stessa postura
locale-only già accettata dall'utente per le fasi precedenti; nessun hardening in
questa fase, ma il proxy va in ascolto solo se il servizio abilita esplicitamente
`httpInspect.enabled` (opt-in), il che limita la superficie.

## Dipendenza da tenere d'occhio

Il body della richiesta e della risposta va letto **una sola volta** in un buffer e
riusato sia per la cattura sia per l'inoltro/ritorno (le stream di Request/Response si
consumano). Sbagliare questo rompe l'inoltro o la cattura. Il WS bridge è il punto più
rischioso: se instabile, ripiegare su "upgrade non supportato" è preferibile a un proxy
che crasha — ma l'obiettivo è il pass-through funzionante non registrato.

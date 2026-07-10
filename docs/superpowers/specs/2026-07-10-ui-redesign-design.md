# Design — Ridisegno UI (layout + UX overhaul)

Data: 2026-07-10
Stato: approvato (design), in attesa di piano di implementazione

## Contesto

Il frontend è **Angular 18 standalone + Tailwind 3** (dark mode via classe), con
`@xterm/xterm` + `@xterm/addon-fit` per i terminali, `lucide-angular` per le
icone e `@angular/cdk` già tra le dipendenze. La UI attuale ha: sidebar progetti,
dashboard a griglia di card servizi, pannello terminali fisso in basso
(alto 256px, scroll orizzontale), command palette (⌘K), modale config, toast.
Tema "rustico/country" (palette terrosa, serif Bitter, verde campagna) coerente
col nome *pagghiaro* (casale siciliano).

Componenti esistenti: `app.component`, `dashboard`, `sidebar`, `service-card`,
`terminal`, `command-palette`, `config-form`. Servizi: `project.service`,
`terminal.service`, `ui.service`, `command-palette.service`,
`app-metadata.service`.

## Problema

Overhaul di **layout + UX** deciso con l'utente. Quattro aree da risolvere:

1. **Terminali scomodi** — pannello fisso in basso, stretto, con scroll
   orizzontale quando ci sono più terminali; niente tab, ridimensionamento,
   fullscreen o finestre separate.
2. **Dashboard dispersiva** — griglia di card poco densa; stato, metriche ed
   execution plan sparsi e poco scansionabili.
3. **Navigazione poco chiara** — sidebar/azioni globali/palette non abbastanza
   immediate o coerenti.
4. **Estetica datata/incoerente** — spaziature e gerarchia da svecchiare,
   mantenendo però l'identità.

## Decisioni prese (con l'utente)

- **Portata:** ridisegno layout + UX. **Stack invariato:** Angular 18 + Tailwind
  (no cambio framework).
- **Layout:** **A · "IDE Workbench"** — rail icone + sidebar; dashboard come
  **lista densa** di servizi; **pannello terminali agganciato in basso a tab**,
  con split e pop-out flottante.
- **Terminali:** ibrido **tab (default) + split (affiancati) + flottanti**
  (finestre trascinabili/ridimensionabili sopra la dashboard).
- **Estetica:** **"Casale"** — crema/beige, verde oliva (#719337), **titoli
  serif Bitter**, testo Source Sans 3, mono JetBrains; arioso, ombre morbide,
  dark mode mantenuta.
- **Dashboard:** lista densa con **riga espandibile** per i dettagli (non più
  card).
- **Piano:** un unico spec e **un unico piano** con task raggruppati nei 5
  blocchi elencati sotto.

## Fuori scope

- Cambio di framework/librerie o riscrittura del backend.
- Nuove funzionalità di dominio non già presenti (il redesign espone le stesse
  capacità: start/stop/restart, kill-port, reload-context, log/terminale, config,
  metriche, execution plan).
- Persistenza server-side dello stato di layout (posizioni finestre, altezza
  pannello): resta **lato client** (in-sessione/localStorage), non nel backend.

## Design system "Casale"

Raffinamento dei token in `tailwind.config.js` (si estende la scala `rustic` e
`country` esistenti; non si rinominano i colori base per non rompere il codice,
si aggiungono alias/uso semantico e si consolidano radii/ombre/spaziature).

- **Colori semantici (uso, mappati sui token esistenti):** `surface`
  (rustic-50 / dark rustic-900), `surface-raised` (white / dark rustic-800),
  `border` (rustic-200 / dark rustic-700), `text` (rustic-900 / dark rustic-100),
  `text-muted` (rustic-500 / dark rustic-400), `accent` = country-green #719337,
  `danger` = country-red, `warning` = country-yellow, `info` = country-blue.
- **Tipografia:** Bitter (display/titoli di sezione), Source Sans 3 (corpo),
  JetBrains Mono (comandi/porte/terminale). I font sono già dichiarati in
  `fontFamily`; vanno effettivamente caricati (self-host o `@font-face`) — vedi
  Testing/rischi.
- **Forma:** card `rounded-lg`, controlli `rounded-md`, bordi 1px, ombra
  `shadow-sm` morbida; spaziatura su scala 4/6/8.
- **Primitive UI** (nuovi componenti standalone, cartella `ui/`), per centralizzare
  la coerenza:
  - `ui-button` — varianti `primary | secondary | ghost | danger`, dimensioni
    `sm | md`, slot icona.
  - `ui-icon-button` — bottone quadrato solo-icona con tooltip.
  - `ui-status-dot` — pallino di stato per `ServiceStatus`
    (`running`→accent, `stopped`→muted, `error`→danger, `restarting`→warning,
    pulsante quando restarting).
  - `ui-badge` — pill (porta, conteggi, tag).
  - `ui-panel` — contenitore card con header opzionale.
  - `ui-tooltip` — direttiva/tooltip leggero (o CDK Overlay).

Le primitive non contengono logica di dominio: ricevono input e emettono eventi.

## Architettura dei componenti

Nuova organizzazione sotto `src/app/`:

- `ui/` — primitive (sopra).
- `layout/`
  - `app-shell` — griglia `[rail | sidebar] | main`; ospita toolbar, dashboard,
    pannello terminali, e gli overlay (palette, config, toast, finestre
    flottanti). Sostituisce l'attuale template di `app.component`.
  - `icon-rail` — rail verticale: logo, nav, toggle tema, trigger palette.
  - `sidebar` — selettore progetti + albero servizi del progetto attivo;
    overlay su mobile (riusa il comportamento esistente in `ui.service`).
  - `toolbar` — nome progetto + rootPath, azioni globali (Start/Stop/Restart
    all, Reload context), stat (servizi/attivi), hint ⌘K, stepper execution plan
    compatto.
- `dashboard/`
  - `service-list` — contenitore lista.
  - `service-row` — riga densa: status dot, nome, comando (mono troncato), badge
    porta, CPU/MEM inline (sparkline + valore), uptime, azioni rapide
    (start/stop/restart, apri terminale, kill-port, menu "···"); espandibile.
  - `service-detail` — contenuto espanso (comando completo, env, metriche).
  - `execution-plan` — stepper compatto (usato nella toolbar/sotto-header).
  - `empty-state` — nessun progetto selezionato.
- `terminal/`
  - `terminal-manager.service` — stato dei terminali aperti e delle modalità.
  - `terminal-panel` — pannello agganciato in basso: tab bar, handle di resize,
    area terminali (single/split), pulsanti split/maximize/pop-out/close.
  - `terminal-tab` — singola tab (status dot + nome + chiudi).
  - `terminal-view` — wrapper xterm + fit (riusa l'integrazione attuale di
    `terminal.component`).
  - `floating-terminal` — finestra flottante (CDK Drag) che ospita un
    `terminal-view`, con header (titolo, ri-aggancia, maximize, chiudi).

Servizi esistenti: mantenuti ed estesi.
- `terminal.service` → confluisce/estende in `terminal-manager.service`
  (aggiunge modalità e posizioni; preserva WS/log/xterm).
- `ui.service` → aggiunge stato di layout: sidebar aperta/chiusa (già presente),
  **altezza del pannello terminali**, **tema**, e (via manager) le posizioni
  delle finestre flottanti. Persistite in `localStorage`.
- `project.service`, `command-palette.service`, `app-metadata.service`: invariati
  nelle API; adattati ai nuovi componenti.

## Sistema terminali (dettaglio)

`terminal-manager.service` mantiene una collezione di **terminali aperti**, ognuno
con:

- `serviceId`, riferimento all'istanza xterm/stream (riuso plumbing attuale),
- `mode`: `'docked' | 'floating'`,
- per i docked: appartenenza al set di tab e se è nello **split** attivo,
- per i flottanti: `{ x, y, width, height, maximized }`.

Operazioni: `open(serviceId)` (apre/mette a fuoco una tab docked), `close(id)`,
`activate(id)` (tab attiva), `toggleSplit(id)` (affianca fino a 2 terminali nel
pannello docked), `float(id)` (pop-out in finestra), `dock(id)` (ri-aggancia),
`toggleMaximize(id)`, `setPanelHeight(px)`.

- **Pannello agganciato:** tab bar in alto; **drag handle** sul bordo superiore
  per regolare l'altezza (min/max, persistita); area che mostra la tab attiva o
  2 terminali affiancati in modalità split; toolbar con split/maximize/pop-out/
  chiudi. Se non ci sono terminali aperti, il pannello è nascosto.
- **Flottanti:** finestre con **CDK Drag** trascinabili e ridimensionabili
  (handle d'angolo), z-index gestito (click porta in primo piano), posizione e
  dimensione memorizzate; pulsanti header per ri-agganciare, massimizzare,
  chiudere.
- **Resize xterm:** ad ogni cambio di dimensione (resize pannello, split,
  float/maximize) si invoca `FitAddon.fit()` e si propaga il resize al PTY
  tramite il canale WS esistente.

## Navigazione & interazioni

- **Command palette (⌘K):** filtro fuzzy su progetti, servizi **e azioni**
  (start/stop/restart un servizio o tutti, apri terminale, kill-port,
  reload-context, toggle tema). Riusa `command-palette.service` estendendone le
  sorgenti.
- **Scorciatoie minime:** ⌘K/Ctrl+K apre palette, Esc chiude overlay/sidebar
  mobile; opzionale: cambio tab terminale con Alt+numero.
- **Config form & toast:** riportati alle primitive del design system.
- **Responsive:** sidebar a overlay su mobile (comportamento esistente); su
  schermi stretti il pannello terminali resta a tab (no split), le finestre
  flottanti restano possibili ma con dimensioni minime.

## Flusso dati

Invariato lato dominio: i componenti consumano i signal/observable dei service
esistenti (`project.service` per progetti/servizi/stati, WS per log e metriche).
Nessun nuovo endpoint backend. Le novità sono tutte di presentazione e di stato
UI lato client (layout, modalità terminali), gestite in `ui.service` /
`terminal-manager.service` e persistite in `localStorage`.

## Gestione errori / stati

- Stati servizio (`stopped/running/error/restarting`) resi in modo coerente via
  `ui-status-dot` (incl. `error`, ora prodotto correttamente dal backend dopo il
  lavoro precedente sul tree-kill).
- Empty-state quando nessun progetto è selezionato.
- Terminali: se un servizio esce, la tab/finestra resta (mostra l'output finale)
  finché l'utente non la chiude; lo status dot riflette lo stato.
- Toast per esiti di azioni (già presente), riportato al design system.

## Testing

Karma/Jasmine (già configurato). Si testano soprattutto le **unità con stato e
logica**, non il pixel-layout:

- `terminal-manager.service`: transizioni di modalità (open/activate/close,
  toggleSplit ≤2, float/dock, maximize, setPanelHeight con clamp) e persistenza.
- `command-palette.service`: filtro/fuzzy e generazione azioni per un set di
  progetti/servizi.
- `ui.service`: stato tema/altezza pannello + persistenza localStorage.
- `service-row`: wiring delle azioni (emette gli eventi giusti) e resa dello
  stato (status dot per ogni `ServiceStatus`).
- `ui-button`/primitive: resa varianti e propagazione eventi.

Verifica manuale (build `ng build` + run reale): navigazione, apertura/chiusura/
split/float dei terminali, resize xterm, dark mode, responsive.

## Rischi e note

- **Font:** i family Bitter/Source Sans 3/JetBrains Mono sono dichiarati ma
  vanno effettivamente forniti (self-host `@font-face` o pacchetti locali) per
  evitare fallback incoerenti; niente CDN esterni se non desiderato.
- **Migrazione componenti:** i vecchi componenti (`service-card`, vecchio
  `dashboard`/`terminal`/`app.component` template) vengono sostituiti; si procede
  per blocchi mantenendo l'app compilabile ad ogni passo.
- **Resize/PTY:** assicurarsi che ogni cambio dimensione propaghi il resize al
  PTY (canale WS esistente) per non desincronizzare le colonne.

## Suddivisione in blocchi (per il piano)

Un unico piano, task raggruppati e sequenziali (condividono il design system):

1. **Design system** — token Tailwind + font + primitive `ui/`.
2. **App shell + navigazione** — `app-shell`, `icon-rail`, `sidebar`, `toolbar`
   cablati ai service esistenti.
3. **Dashboard** — `service-list`/`service-row`/`service-detail` +
   `execution-plan` + empty-state.
4. **Sistema terminali** — `terminal-manager` + `terminal-panel` (tab) → split →
   `floating-terminal`.
5. **Polish** — command palette, config form, toast, dark mode, responsive,
   rifiniture.

## File principali toccati/creati

- `frontend/tailwind.config.js` — token/raffinamento.
- `frontend/src/styles.css`, `@font-face`/asset font.
- `frontend/src/app/ui/*` — nuove primitive.
- `frontend/src/app/layout/*` — shell, rail, sidebar, toolbar.
- `frontend/src/app/dashboard/*` — lista, riga, dettaglio, execution-plan.
- `frontend/src/app/terminal/*` — manager, panel, tab, view, floating.
- `frontend/src/app/app.component.ts` — ridotto a montare `app-shell`.
- `frontend/src/app/services/ui.service.ts`,
  `frontend/src/app/services/terminal.service.ts` — estesi.
- Rimozione dei componenti sostituiti (`service-card`, vecchi template) a fine
  migrazione.

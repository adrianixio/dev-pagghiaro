# Design — Terminazione affidabile dei processi (tree-kill) e shutdown pulito

Data: 2026-07-10
Stato: approvato (design), in attesa di piano di implementazione

## Problema

DevPagghiaro lancia ogni servizio tramite una shell:
`cmd.exe /d /s /c <comando>` su Windows, `/bin/sh -c <comando>` su Unix
(vedi `apps/backend/src/pty-adapter.ts`).

Allo stop/restart, `child.kill()` termina **solo la shell**, non i processi che
essa ha generato (es. `npm run dev` → `node` → `vite`/`nodemon`). Questi
sopravvivono come orfani e continuano a occupare la porta.

Conseguenze osservate (priorità dell'utente):

1. **Processi orfani / porte occupate** — dopo stop o restart restano processi
   vivi che tengono la porta; serve `kill-port` o kill manuale. La macchinita
   `killProcessesListeningOnPort` è di fatto un workaround per questo.
2. **Shutdown del server lascia figli vivi** — chiudendo DevPagghiaro (Ctrl+C)
   i servizi lanciati restano attivi in background.

Entrambi hanno la **stessa radice**: si uccide la shell, non l'albero.

Difetto correlato risolto lungo il percorso (necessario per la correttezza
dello stop, non un obiettivo separato):

3. **Falso stato "error" dopo lo stop** — l'handler di uscita in
   `process-manager.ts` imposta `status = "error"` quando l'exit code ≠ 0, ma
   SIGTERM/SIGKILL producono exit code non-zero. Fermare un servizio quindi lo
   mostra come errore. L'ultimo `emitStatus` inviato alla UI è "error".

## Obiettivi

- Stop e restart terminano l'**intero albero** di processi, non solo la shell.
- Lo shutdown del server (SIGINT/SIGTERM/SIGBREAK) non lascia figli vivi.
- Politica di terminazione: **graceful, poi forza** (segnale dolce → attesa
  configurabile ~5s → kill forzato dell'albero se ancora vivo).
- Uno stop intenzionale riporta sempre `"stopped"`, mai `"error"`.

## Fuori scope (esplicitamente escluso)

- Configurazione per-servizio del grace period o della modalità di kill.
- Guardia anti-doppioni / mutex per operazioni concorrenti sullo stesso servizio
  (rimane un possibile miglioramento futuro).
- Modifiche al frontend Angular (l'unico effetto UI è il fix dello stato
  "stopped", che passa dai canali già esistenti).

## Architettura

### Componente 1 — `apps/backend/src/process-tree.ts` (nuovo)

Il pezzo mancante: terminazione dell'intero albero data la radice `pid`.

API:

```ts
// Segnale dolce a tutto l'albero. Non attende.
export function terminateTree(pid: number): Promise<void>;

// Kill forzato dell'intero albero. Ritorna true se, alla fine, l'albero è morto.
export function forceKillTree(pid: number): Promise<boolean>;

// True se il processo radice è ancora vivo.
export function isTreeAlive(pid: number): boolean;
```

Strategia per piattaforma:

- **Windows**
  - dolce: `taskkill /PID <pid> /T`
  - forzato: `taskkill /PID <pid> /T /F`
  - `/T` termina l'albero risalendo via PPID. La logica di invocazione di
    `taskkill` esiste già in `port-processes.ts` e viene riusata/estratta.
- **Unix**
  - La shell è lanciata come *process-group leader* (vedi Componente 2), quindi
    `pid` è anche il PGID.
  - dolce: `process.kill(-pid, 'SIGTERM')`
  - forzato: `process.kill(-pid, 'SIGKILL')`
  - il segno negativo indirizza l'intero gruppo (tutti i discendenti).
  - Fallback: se `process.kill(-pid, …)` fallisce con `ESRCH`/`EPERM` (radice
    non leader di gruppo), ripiega su `process.kill(pid, …)` sul solo PID.

`isPidAlive` (oggi privata in `port-processes.ts`) viene condivisa/estratta per
riuso.

### Componente 2 — `apps/backend/src/pty-adapter.ts`

Rendere l'albero effettivamente uccidibile come gruppo.

- **Unix**: aggiungere `detached: true` alle opzioni di spawn, così il PID della
  shell diventa leader del proprio process-group (prerequisito del group-kill).
  - **Da verificare in implementazione (TDD):** compatibilità di
    `detached: true` con `pty: true` sotto Bun. Se in conflitto, il PTY di Bun
    tipicamente crea già una nuova sessione: in quel caso il group-kill funziona
    senza `detached`, oppure si adotta il fallback a enumerazione discendenti via
    `ps -o pid,ppid`. La scelta finale è guidata dai test.
- **Windows**: nessuna modifica allo spawn; `taskkill /T` risale l'albero via
  PPID indipendentemente dai gruppi.

Il metodo `kill()` di `PtyHandle` resta per la chiusura del singolo processo /
stdin, ma la terminazione dell'albero è responsabilità del process-manager via
`process-tree.ts`.

### Componente 3 — `apps/backend/src/process-manager.ts`

Riscrittura di `stop()` con sequenza robusta e verificata:

```
1. segna il servizio come "stopping" (flag interno per intenzionalità)
2. terminateTree(pid)                         ← graceful
3. attende race(pty.exited, GRACE_MS ~5000)
4. se isTreeAlive(pid) → forceKillTree(pid)   ← forza
5. se c'è una porta configurata ancora occupata
   → killProcessesListeningOnPort(port)       ← ultima rete di sicurezza
6. untrack metriche, rimuove dalla mappa processi
7. stato = "stopped", pid = null, emitStatus("stopped")
```

Fix del falso "error" (Problema 3): l'handler `pty.exited.then(...)` registrato
in `start()` consulta il flag "stopping". Se lo stop è intenzionale, imposta
`status = "stopped"` (con `lastExitCode` valorizzato) invece di derivare "error"
dall'exit code. Il flag viene azzerato al termine dello stop e a ogni nuovo
`start()`.

`restart()` resta `stop()` poi `start()`; eredita il nuovo comportamento.

### Componente 4 — `apps/backend/src/index.ts`

`shutdown()` chiama già `processManager.stopAll()`, che ora esegue il tree-kill
per ogni servizio → lo shutdown è risolto di conseguenza.

Aggiunta: **timeout globale di sicurezza** intorno a `stopAll()` (es. grace +
piccolo margine) così `shutdown()` non può mai restare appeso; scaduto il
timeout si procede comunque a `process.exit`.

## Flusso dati

Invariato rispetto a oggi: gli stati passano da `process-manager` →
`log-bus.emitStatus` → route WS → frontend. Nessun nuovo canale, nessun nuovo
tipo condiviso. Il tree-kill è interamente lato backend.

## Gestione errori

- `terminateTree`/`forceKillTree` non lanciano: intercettano `ESRCH` (processo
  già morto) come successo e riportano i fallimenti reali nel log del servizio
  via `logBus.emit`.
- Se dopo il force-kill e il fallback su porta l'albero risulta ancora vivo, lo
  stato passa a `"error"` con un messaggio esplicativo nel log (caso limite:
  processo non terminabile per permessi).
- Lo shutdown non fallisce mai in modo bloccante grazie al timeout globale.

## Testing (TDD)

- **Albero reale**: shell che avvia un figlio che avvia un nipote "sleeper"
  longevo. Dopo `stop()`: il nipote deve risultare morto (`isTreeAlive`/`kill 0`).
- **Stato**: `stop()` di un servizio in esecuzione porta lo stato a `"stopped"`
  e non emette mai `"error"`.
- **Fallback porta**: con una porta configurata, se il tree-kill non libera la
  porta, la rete di sicurezza `killProcessesListeningOnPort` viene invocata.
- **Shutdown**: `stopAll()` termina tutti gli alberi entro il timeout.
- Test condizionati per piattaforma dove il meccanismo differisce
  (Windows `taskkill` vs Unix process-group).

## File toccati

- `apps/backend/src/process-tree.ts` — nuovo
- `apps/backend/src/pty-adapter.ts` — spawn come group leader (Unix)
- `apps/backend/src/process-manager.ts` — `stop()` robusto + fix stato
- `apps/backend/src/port-processes.ts` — estrazione/condivisione di
  `isPidAlive` e dell'invocazione `taskkill`
- `apps/backend/src/index.ts` — timeout di shutdown
- test di accompagnamento nei file corrispondenti

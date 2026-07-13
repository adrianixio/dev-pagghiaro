# BACKEND KNOWLEDGE BASE

## OVERVIEW
Bun + Elysia API service for project/service CRUD, process lifecycle control, metrics, and live terminal/log streaming.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App bootstrap | `src/index.ts` | Mounts routers, static serving, startup flow |
| Project API | `src/routes/projects.ts` | CRUD, bulk actions, reload-context |
| Service API | `src/routes/services.ts` | CRUD, start/stop/restart, metrics, clear logs |
| WebSocket logs | `src/routes/ws-logs.ts` | `/ws/logs/:serviceId` bridge |
| Config persistence | `src/config-store.ts` | Reads/writes `pagghiaro.json` |
| Process lifecycle | `src/process-manager.ts` | PTY spawn/stop/restart, port cleanup |
| Env resolution | `src/process-context.ts` | `.env*` merge + Python venv detection |

## STRUCTURE
```
apps/backend/
├── src/
│   ├── index.ts
│   ├── routes/
│   │   ├── projects.ts
│   │   ├── services.ts
│   │   └── ws-logs.ts
│   ├── config-store.ts
│   ├── process-manager.ts
│   └── process-context.ts
└── package.json
```

## CONVENTIONS
- Runtime is Bun-only; package has `type: module`.
- Routes use full absolute paths in Elysia instead of prefix shorthand.
- `projects.ts` registers literal sub-routes before `/:projectId` to avoid param swallowing.
- Persistent state lives in `pagghiaro.json`; route handlers go through `config-store.ts`.
- Service processes run inside PTYs; terminal input/resize flows through the WS route.
- Process environment merges project `.env*`, service `.env*`, detected Python venv vars, then explicit service env.

## BUILD / RUN
```bash
# From repo root
bun run dev:backend
bun run build:backend
bun run build:release
```

## ANTI-PATTERNS
- Do not bypass `config-store.ts` when changing persisted project/service data.
- Do not add prefixed routes that can shadow `/api/projects/:projectId/states`-style literals.
- Do not assume backend standalone build output is what the CLI runs; release build writes the launcher artifact.
- Do not hardcode service cwd as relative-to-repo; runtime resolves relative to each project's `rootPath`.

## NOTES
- `PAGGHIARO_PORT`, `PAGGHIARO_CONFIG_PATH`, and `PAGGHIARO_STATIC_DIR` drive runtime behavior.
- CLI startup imports `dist/backend/index.js`; `scripts/build-release.ts` is the canonical artifact producer.
- `src/index.ts` also serves the built Angular UI when `STATIC_DIR` exists.

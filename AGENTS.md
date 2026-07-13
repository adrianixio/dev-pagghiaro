# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-14  
**Commit:** b6ace8c  
**Branch:** main

## OVERVIEW
Bun-based TypeScript monorepo for DevPagghiaro: a local dev-environment orchestrator with a Bun/Elysia backend, Angular 18 standalone frontend, shared contracts package, and a CLI that boots prebuilt release artifacts.

## STRUCTURE
```
./
├── apps/
│   ├── backend/            # Bun API + process orchestration service
│   └── frontend/           # Angular 17 placeholder package
├── frontend/               # Main Angular 18 standalone UI
├── packages/
│   └── shared/             # Shared contracts used by API + UI
├── bin/                    # CLI launcher (`dev-pagghiaro`)
├── scripts/                # Release/build pipeline
├── dist/                   # Release artifacts consumed by CLI start
├── pagghiaro.json          # Persisted project/service config
└── AGENTS.md               # Root knowledge base
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| CLI startup flow | `bin/dev-pagghiaro.js` | Verifies `dist/backend/index.js` + `dist/frontend/browser` |
| Release artifact generation | `scripts/build-release.ts` | Canonical producer for launcher artifacts |
| Backend bootstrap | `apps/backend/src/index.ts` | Mounts routers, static serving, startup autostart |
| Backend API details | `apps/backend/AGENTS.md` | Routes, config-store, process manager |
| Main frontend bootstrap | `frontend/src/main.ts` | Angular standalone bootstrap |
| Frontend architecture | `frontend/AGENTS.md` | Services, components, tests, WS/API usage |
| Shared contracts | `packages/shared/src/models.ts` | Config, service state, WS message unions |
| Shared package notes | `packages/shared/AGENTS.md` | Contract ownership and compatibility rules |
| Persisted runtime config | `pagghiaro.json` | Real project/service execution config sample |
| Legacy/secondary frontend | `apps/frontend/` | Angular 17 scaffold; not the primary shipped UI |

## CODE MAP
```text
Entry points
- bin/dev-pagghiaro.js                CLI launcher
- scripts/build-release.ts            Release build orchestrator
- apps/backend/src/index.ts           Backend service entry
- frontend/src/main.ts                Standalone Angular app entry
- packages/shared/src/index.ts        Shared exports surface

High-signal modules
- apps/backend/src/routes/projects.ts Project CRUD + bulk lifecycle API
- apps/backend/src/routes/services.ts Service CRUD + lifecycle API
- apps/backend/src/routes/ws-logs.ts  WebSocket log/metrics bridge
- apps/backend/src/config-store.ts    pagghiaro.json persistence + validation
- frontend/src/app/services/project.service.ts   UI facade over REST actions
- frontend/src/app/services/terminal.service.ts  WS terminal/log state
- packages/shared/src/models.ts       Cross-workspace contract source of truth
```

## CONVENTIONS
- **Runtime/tooling:** Bun-first repo; root workflows use `bun run` / `bun build`.
- **Workspace layout:** root workspaces are `apps/*`, `packages/*`, and standalone `frontend`.
- **TypeScript baseline:** strict, ES2022, bundler module resolution across backend/shared/frontend configs.
- **Release startup model:** CLI runs only against root `dist/` artifacts, not app-local dev builds.
- **Backend routing:** Elysia routes use full absolute paths; literal sub-routes are registered before param routes.
- **Frontend architecture:** Angular standalone bootstrap + signal-heavy local state; shared contracts imported from `@dev-pagghiaro/shared`.
- **Config persistence:** `pagghiaro.json` is the persisted source of truth for projects/services and execution order.

## ANTI-PATTERNS (THIS PROJECT)
- **DO NOT** run `bun run start` before `bun run build:release`.
- **DO NOT** assume Node/npm is the default runtime; Bun is the expected toolchain.
- **DO NOT** duplicate API contract types across frontend/backend; update `packages/shared` instead.
- **DO NOT** treat `apps/frontend/` as the main UI without an explicit migration/alignment plan.
- **DO NOT** forget that root `package.json` is currently publishable (`"private": false`); treat releases carefully.

## UNIQUE STYLES
- CLI launcher loads compiled backend via dynamic import and injects runtime env vars.
- Release pipeline consolidates backend bundle and copied Angular browser assets into one root `dist/` tree.
- Backend simultaneously serves API routes, WebSocket log streams, and built frontend assets.
- Process execution model is project-root aware: service `cwd` values resolve relative to each configured project root.

## COMMANDS
```bash
# Development
bun run dev:backend
bun run dev:frontend

# Builds
bun run build:shared
bun run build:frontend
bun run build:backend
bun run build:release

# Launcher
bun run start
bun run start -- --port 4010 --config ./pagghiaro.json --no-open
```

## NOTES
- `scripts/build-release.ts` currently aligns with the CLI: it writes `dist/backend/index.js` and `dist/frontend/browser`.
- `apps/backend/package.json` still builds to `apps/backend/dist` when run directly; that is not the launcher artifact path.
- Testing exists mainly in the Angular 18 frontend (`frontend/src/app/app.component.spec.ts`); backend/shared have no comparable suite yet.
- No CI workflow files were found under `.github/workflows/`.
- Child knowledge bases exist where the code density and domain boundaries justify them: backend, main frontend, shared package.

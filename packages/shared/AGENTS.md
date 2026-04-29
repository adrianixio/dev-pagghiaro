# SHARED PACKAGE KNOWLEDGE BASE

## OVERVIEW
Thin TypeScript contract package shared by backend and frontend workspaces.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public exports | `src/index.ts` | Re-export surface |
| Data contracts | `src/models.ts` | Config, runtime state, WS, API payloads |
| Build config | `tsconfig.json` | Declaration output to `dist/` |
| Package surface | `package.json` | `exports`, `main`, `types` all point to `src/index.ts` |

## CONVENTIONS
- This package is contracts-only: interfaces, types, payload shapes.
- Backend and frontend both import from `@dev-pagghiaro/shared`; compatibility matters more than clever abstractions.
- `PagghiaroConfig`, `ProjectConfig`, and `ServiceConfig` are the persisted core model.
- WS message unions in `models.ts` are the source of truth for terminal/log protocol.

## BUILD / RUN
```bash
# From repo root
bun run build:shared
```

## ANTI-PATTERNS
- Do not add runtime-only helpers that pull in Bun or Angular dependencies.
- Do not fork backend/frontend copies of these contracts.
- Do not make breaking shape changes without updating both API and UI consumers.

## NOTES
- `tsconfig.json` emits declarations to `dist/`, but the package exports still point at source during workspace development.
- Best candidate sections to update together: config shapes, service state, metrics, websocket messages.

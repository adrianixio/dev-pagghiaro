# FRONTEND KNOWLEDGE BASE

## OVERVIEW
Angular 18 standalone UI for browsing projects, controlling services, editing config, and streaming terminals/logs from the backend API.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App bootstrap | `src/main.ts` | `bootstrapApplication(AppComponent, appConfig)` |
| App providers | `src/app/app.config.ts` | Router + Lucide setup |
| Root layout | `src/app/app.component.ts` | Composes sidebar, dashboard, terminal, command palette |
| Project state/actions | `src/app/services/project.service.ts` | REST polling, mutations, execution order |
| Terminal state | `src/app/services/terminal.service.ts` | WebSocket + xterm integration |
| UI state | `src/app/services/ui.service.ts` | Sidebar, mobile, toast, config modal |
| Main dashboard | `src/app/components/dashboard/dashboard.component.ts` | Project summary and execution plan |
| Shared view models | `src/app/models/*.ts` | UI-facing config/project models |
| Unit test pattern | `src/app/app.component.spec.ts` | Jasmine + TestBed for standalone app |

## STRUCTURE
```
frontend/
├── src/main.ts
├── src/app/
│   ├── components/
│   ├── services/
│   ├── models/
│   ├── app.config.ts
│   └── app.component.ts
├── angular.json
└── package.json
```

## CONVENTIONS
- Standalone Angular app: no NgModule root, uses `bootstrapApplication`.
- State is mostly local Angular signals/computed values, not global RxJS stores.
- API calls target `/api`; terminal streaming uses `/ws/logs/:serviceId`.
- Component templates use the Angular control-flow syntax (`@if`, `@for`).
- Styling is utility-heavy and design-token driven (`rustic-*`, `country-*`).
- Shared contracts come from `@dev-pagghiaro/shared`; frontend models adapt them for UI needs.

## BUILD / RUN
```bash
# From repo root
bun run dev:frontend
bun run build:frontend
bun run build:release

# From frontend/
ng serve --proxy-config proxy.conf.json
ng test
```

## ANTI-PATTERNS
- Do not add an NgModule-based root alongside the standalone bootstrap.
- Do not duplicate API contract types locally when `@dev-pagghiaro/shared` already defines them.
- Do not bypass `ProjectService` / `TerminalService` for project lifecycle or terminal state.
- Do not assume this app matches `apps/frontend/`; that package is Angular 17 placeholder code.

## NOTES
- Angular build output path is `frontend/dist/frontend`; release pipeline copies browser assets into root `dist/frontend/browser`.
- `app.component.spec.ts` mocks `fetch`; follow that pattern for shallow app-level tests.
- Biggest hotspots are `project.service.ts`, `terminal.service.ts`, and config-form/dashboard components.

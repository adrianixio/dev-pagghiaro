# DevPagghiaro Frontend

Angular 17 application — scaffold placeholder.

## Setup

```bash
# From repo root
bun install
ng new frontend --directory . --skip-install --routing --style scss
bun install
```

## API assumptions

- Backend runs on `http://localhost:3001`
- REST base: `http://localhost:3001/api`
- WebSocket logs: `ws://localhost:3001/ws/logs/:serviceId`

See `packages/shared/src/models.ts` for all shared types.

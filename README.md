# DevPagghiaro

DevPagghiaro is a local microservice orchestrator built with Bun, Elysia, Angular, and xterm.js. It lets you manage grouped terminal-based services from a single web UI backed by `pagghiaro.json`.

## Features

- project and service management persisted in `pagghiaro.json`
- start, stop, and restart controls for single services or whole projects
- live terminal streaming with xterm.js
- per-service CPU and memory monitoring
- keyboard-first command palette
- single-process packaged runtime for Bun

## Local development

```bash
bun install
bun run dev:backend
bun run dev:frontend
```

Then open `http://localhost:4200`.

## Local packaged runtime

Build the distributable package:

```bash
bun run build:release
```

Run it:

```bash
bun run start
```

Or call the CLI directly:

```bash
bun run ./bin/dev-pagghiaro.js --port 3001 --config ./pagghiaro.json
```

## Intended published usage

After publishing to npm, the target workflow is:

```bash
bunx dev-pagghiaro@latest
```

With options:

```bash
bunx dev-pagghiaro@latest --port 4010 --config ./pagghiaro.json --no-open
```

## CLI options

```text
--port <number>   Port for the local web UI and API
--config <path>   Path to pagghiaro.json
--no-open         Do not open the browser automatically
-h, --help        Show help
```

## Publish checklist

```bash
bun run build:release
npm pack
npm publish
```

The package publish step relies on `prepack`, so the built backend and frontend assets are included automatically in the npm tarball.

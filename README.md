# DevPagghiaro

DevPagghiaro is a local development orchestrator for terminal-based services. It provides a single web dashboard for launching, grouping, monitoring, and controlling the processes that make up a local development environment, with configuration persisted in `pagghiaro.json`.

Inspired by the Sicilian idea of a *pagghiaro* as a practical refuge for essential tools, DevPagghiaro acts as a central operational refuge for local development workflows. Instead of managing multiple terminal tabs for frontend apps, backend APIs, workers, and support processes, you control them from one interface.

## Why DevPagghiaro

Modern local development often depends on several long-running processes at the same time. A typical setup may include a frontend dev server, a backend API, background workers, and project-specific support commands. The default workflow is usually a collection of terminal tabs, repeated startup steps, and constant context switching.

DevPagghiaro reduces that operational overhead by turning those commands into structured, reusable project groups. It keeps service definitions, launch order, runtime visibility, and terminal access in one place so the local environment is easier to start, inspect, and recover.

## What It Does

- stores projects and services in `pagghiaro.json`
- starts, stops, and restarts individual services or full project groups
- streams live process output through integrated xterm.js terminals
- forwards terminal input and resize events to running processes
- shows per-service CPU and memory usage in real time
- supports custom execution order and optional delay between service launches
- includes a keyboard-first command palette for quick project and service actions
- exposes a local web UI powered by Bun, Elysia, and Angular

## Usage

```bash
bunx @adrianixio/dev-pagghiaro@latest
```

With options:

```bash
bunx @adrianixio/dev-pagghiaro@latest --port 4010 --config ./pagghiaro.json --no-open
```

## CLI options

```text
--port <number>   Port for the local web UI and API
--config <path>   Path to pagghiaro.json
--no-open         Do not open the browser automatically
-h, --help        Show help
```

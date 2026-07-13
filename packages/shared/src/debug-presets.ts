/**
 * Built-in starter watch sets, surfaced in the panel as a "Templates"
 * dropdown. Each preset is filtered against the current adapter language so
 * the user only sees ones that will plausibly evaluate.
 *
 * Presets are intentionally low-magic — every expression is a plain
 * read-only access on globals or thread-local state, so they work whether or
 * not the user has wrapped their app in a particular framework.
 */

import type { DebugWatchPreset } from './models';

export const DEBUG_WATCH_PRESETS: DebugWatchPreset[] = [
  {
    id: 'node-process-basics',
    name: 'Node · process basics',
    description: 'Uptime, memory, and event-loop sanity checks for any Node service.',
    languages: ['node'],
    watches: [
      { label: 'uptime (s)', expr: 'process.uptime()', intervalMs: 1000 },
      { label: 'rss (MB)', expr: '(process.memoryUsage().rss / 1024 / 1024) | 0', intervalMs: 2000 },
      { label: 'heapUsed (MB)', expr: '(process.memoryUsage().heapUsed / 1024 / 1024) | 0', intervalMs: 2000 },
      { label: 'active handles', expr: 'process._getActiveHandles?.().length ?? null', intervalMs: 2000 },
    ],
  },
  {
    id: 'node-express',
    name: 'Node · Express request lifecycle',
    description: 'Counters for an Express app exposed on globalThis.app.',
    languages: ['node'],
    watches: [
      { label: 'route count', expr: 'globalThis.app?._router?.stack?.length ?? null', intervalMs: 2000, groupName: 'Express' },
      { label: 'active connections', expr: 'globalThis.server?._connections ?? null', intervalMs: 1000, groupName: 'Express' },
    ],
  },
  {
    id: 'bun-basics',
    name: 'Bun · runtime basics',
    description: 'Bun version + memory snapshot.',
    languages: ['bun'],
    watches: [
      { label: 'Bun.version', expr: 'Bun.version', intervalMs: 5000 },
      { label: 'rss (MB)', expr: '(process.memoryUsage().rss / 1024 / 1024) | 0', intervalMs: 2000 },
    ],
  },
  {
    id: 'python-process-basics',
    name: 'Python · process basics',
    description: 'Time alive, RSS memory, thread count for any Python service.',
    languages: ['python'],
    watches: [
      { label: 'uptime (s)', expr: '__import__("time").time() - __import__("psutil").Process().create_time()', intervalMs: 2000 },
      { label: 'rss (MB)', expr: '__import__("psutil").Process().memory_info().rss // (1024*1024)', intervalMs: 2000 },
      { label: 'threads', expr: 'len(__import__("threading").enumerate())', intervalMs: 2000 },
    ],
  },
  {
    id: 'python-fastapi',
    name: 'Python · FastAPI / Uvicorn',
    description: 'Uvicorn server stats — assumes the loop is exposed via uvicorn._server.',
    languages: ['python'],
    watches: [
      {
        label: 'open connections',
        expr: 'len(getattr(__import__("uvicorn").server, "connections", []))',
        intervalMs: 1000,
        groupName: 'FastAPI',
      },
      {
        label: 'active tasks',
        expr: 'len(__import__("asyncio").all_tasks()) if __import__("asyncio").get_event_loop().is_running() else 0',
        intervalMs: 1500,
        groupName: 'FastAPI',
      },
    ],
  },
];

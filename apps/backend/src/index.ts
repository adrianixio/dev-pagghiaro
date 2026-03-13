import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Elysia } from 'elysia';
import { getProjects } from './config-store';
import { metricsCollector } from './metrics-collector';
import { processManager } from './process-manager';
import { autoStartProjectServices } from './project-execution';
import { projectsRouter } from './routes/projects';
import { servicesRouter } from './routes/services';
import { wsLogsRouter } from './routes/ws-logs';

const PORT = Number(process.env['PAGGHIARO_PORT'] ?? 3001);
const STATIC_DIR = resolveStaticDir();

const app = new Elysia()
  .onRequest(({ set }) => {
    set.headers['Access-Control-Allow-Origin'] = '*';
    set.headers['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,DELETE,OPTIONS';
    set.headers['Access-Control-Allow-Headers'] = 'Content-Type';
  })
  .options('*', ({ set }) => {
    set.status = 204;
    return null;
  })
  .get('/health', () => ({ status: 'ok', ts: Date.now() }))
  .get('/api/meta', async () => {
    const pkg = await readAppPackage();
    return {
      name: pkg.name,
      version: pkg.version,
      author: pkg.author,
    };
  })
  .use(projectsRouter)
  .use(servicesRouter)
  .use(wsLogsRouter)
  .get('/', () => serveIndex())
  .get('/*', ({ request, set }) => {
    const url = new URL(request.url);
    const file = serveStaticPath(url.pathname);
    if (file) {
      return file;
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
      set.status = 404;
      return { error: 'NOT_FOUND', message: 'Route not found' };
    }

    return serveIndex();
  })
  .listen(PORT);

console.log(`[DevPagghiaro] Backend running on http://localhost:${PORT}`);
if (STATIC_DIR) {
  console.log(`[DevPagghiaro] Serving UI from ${STATIC_DIR}`);
}

void (async () => {
  const projects = await getProjects();
  await Promise.allSettled(projects.map((project) => autoStartProjectServices(project)));
})();

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[DevPagghiaro] Received ${signal} - shutting down...`);
  metricsCollector.stopAll();
  await processManager.stopAll();
  console.log('[DevPagghiaro] All child processes stopped. Bye.');
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

if (process.platform === 'win32') {
  process.on('SIGBREAK', () => {
    void shutdown('SIGBREAK');
  });
}

function resolveStaticDir(): string | null {
  const envPath = process.env['PAGGHIARO_STATIC_DIR'];
  const candidates = [
    envPath ? resolve(envPath) : null,
    join(process.cwd(), 'dist', 'frontend', 'browser'),
    join(import.meta.dir, '..', '..', '..', 'frontend', 'dist', 'frontend', 'browser'),
    join(import.meta.dir, '..', '..', 'frontend', 'browser'),
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function serveIndex(): Response | Blob | null {
  if (!STATIC_DIR) {
    return new Response('Frontend build not found. Run the frontend build first.', { status: 503 });
  }
  return Bun.file(join(STATIC_DIR, 'index.html'));
}

function serveStaticPath(pathname: string): Blob | null {
  if (!STATIC_DIR) {
    return null;
  }

  const normalized = pathname.replace(/^\/+/, '');
  if (!normalized) {
    return Bun.file(join(STATIC_DIR, 'index.html'));
  }

  const filePath = join(STATIC_DIR, normalized);
  if (!existsSync(filePath)) {
    return null;
  }

  return Bun.file(filePath);
}

async function readAppPackage(): Promise<{ name: string; version: string; author?: string }> {
  const packagePath = resolve(import.meta.dir, '..', '..', '..', 'package.json');
  const raw = await Bun.file(packagePath).text();
  const parsed = JSON.parse(raw) as { name: string; version: string; author?: string };
  return parsed;
}

export type App = typeof app;

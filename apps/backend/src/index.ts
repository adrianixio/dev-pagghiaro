import { Elysia } from 'elysia';
import { getProjects } from './config-store';
import { metricsCollector } from './metrics-collector';
import { processManager } from './process-manager';
import { projectsRouter } from './routes/projects';
import { servicesRouter } from './routes/services';
import { wsLogsRouter } from './routes/ws-logs';

const PORT = Number(process.env['PORT'] ?? 3001);

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
  .use(projectsRouter)
  .use(servicesRouter)
  .use(wsLogsRouter)
  .listen(PORT);

console.log(`[DevPagghiaro] Backend running on http://localhost:${PORT}`);

void (async () => {
  const projects = await getProjects();
  await Promise.allSettled(
    projects.flatMap((project) =>
      project.services
        .filter((service) => service.autoStart)
        .map((service) => processManager.start(project.id, service, project.rootPath))
    )
  );
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

export type App = typeof app;

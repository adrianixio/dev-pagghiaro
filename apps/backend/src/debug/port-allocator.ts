import { createServer } from 'node:net';

const ALLOCATION_RETRIES = 3;

/**
 * Ask the OS for a free TCP port on 127.0.0.1, validate it can still be bound
 * after the probe socket closes, and return the port number. We retry a few
 * times to narrow (not fully eliminate) the TOCTOU window between
 * `close()` and the caller's actual bind. The race remains in principle, so
 * the DAP adapter still surfaces a clearer error if the port turns out to be
 * stolen by the time debugpy boots.
 */
export async function allocateFreePort(retries = ALLOCATION_RETRIES): Promise<number> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const port = await allocateOnce();
      // Re-bind on the exact port we just released — if this works the port
      // is still ours for "a moment longer" than a single probe would prove.
      const stillFree = await canStillBind(port);
      if (stillFree) return port;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(`Could not allocate a free port after ${retries} attempts`);
}

function allocateOnce(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (err) => reject(err));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to allocate port')));
      }
    });
  });
}

function canStillBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

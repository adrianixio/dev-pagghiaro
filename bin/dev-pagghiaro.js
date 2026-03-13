#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dir, '..');
const backendEntry = join(packageRoot, 'dist', 'backend', 'index.js');
const staticDir = join(packageRoot, 'dist', 'frontend', 'browser');
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!existsSync(backendEntry)) {
  console.error('[DevPagghiaro] Missing dist/backend/index.js. Run the release build before starting.');
  process.exit(1);
}

if (!existsSync(staticDir)) {
  console.error('[DevPagghiaro] Missing dist/frontend/browser assets. Run the release build before starting.');
  process.exit(1);
}

const configPath = options.config ?? join(process.cwd(), 'pagghiaro.json');
const port = String(options.port ?? 3001);

process.env['PAGGHIARO_PORT'] = port;
process.env['PAGGHIARO_CONFIG_PATH'] = configPath;
process.env['PAGGHIARO_STATIC_DIR'] = staticDir;

console.log(`[DevPagghiaro] Using config: ${configPath}`);
console.log(`[DevPagghiaro] Opening on http://localhost:${port}`);

if (!options.noOpen) {
  void openBrowser(`http://localhost:${port}`);
}

await import(backendEntry);

function parseArgs(argv) {
  const parsed = {
    port: undefined,
    config: undefined,
    noOpen: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--no-open') {
      parsed.noOpen = true;
      continue;
    }

    if (arg === '--port') {
      const rawPort = argv[index + 1];
      const numericPort = rawPort ? Number(rawPort) : Number.NaN;
      if (!rawPort || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
        console.error('[DevPagghiaro] --port must be an integer between 1 and 65535.');
        process.exit(1);
      }
      parsed.port = numericPort;
      index += 1;
      continue;
    }

    if (arg === '--config') {
      const rawPath = argv[index + 1];
      if (!rawPath) {
        console.error('[DevPagghiaro] --config requires a path.');
        process.exit(1);
      }
      parsed.config = resolve(rawPath);
      index += 1;
      continue;
    }

    console.error(`[DevPagghiaro] Unknown argument: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return parsed;
}

function printHelp() {
  console.log(`DevPagghiaro\n\nUsage:\n  dev-pagghiaro [--port 3001] [--config ./pagghiaro.json] [--no-open]\n\nOptions:\n  --port <number>   Port for the local web UI and API\n  --config <path>   Path to pagghiaro.json\n  --no-open         Do not open the browser automatically\n  -h, --help        Show this help message\n`);
}

async function openBrowser(url) {
  const command = process.platform === 'win32'
    ? ['cmd', '/c', 'start', '', url]
    : process.platform === 'darwin'
      ? ['open', url]
      : ['xdg-open', url];

  try {
    const proc = Bun.spawn(command, {
      stdout: 'ignore',
      stderr: 'ignore',
      stdin: 'ignore',
    });
    await proc.exited;
  } catch {
    // best effort only
  }
}

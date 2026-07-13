#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const distDir = join(root, 'dist');
const backendDistDir = join(distDir, 'backend');
const frontendBrowserDir = join(root, 'frontend', 'dist', 'frontend', 'browser');
const frontendOutDir = join(distDir, 'frontend');
const frontendBrowserOutDir = join(frontendOutDir, 'browser');
const frontendLicenses = join(root, 'frontend', 'dist', 'frontend', '3rdpartylicenses.txt');
const bun = process.execPath;

async function run(command: string[], cwd = root): Promise<void> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${command.join(' ')}`);
  }
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(backendDistDir, { recursive: true });
mkdirSync(frontendBrowserOutDir, { recursive: true });

await run([bun, 'run', 'build:shared']);
await run([bun, 'run', 'build:frontend']);
await run([bun, 'build', 'apps/backend/src/index.ts', '--outdir', backendDistDir, '--target', 'bun']);

cpSync(frontendBrowserDir, frontendBrowserOutDir, { recursive: true });
if (existsSync(frontendLicenses)) {
  cpSync(frontendLicenses, join(frontendOutDir, '3rdpartylicenses.txt'));
}

console.log(`[DevPagghiaro] Release build ready in ${distDir}`);

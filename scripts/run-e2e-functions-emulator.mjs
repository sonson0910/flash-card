#!/usr/bin/env node
// Signed-in browser tests use a separate emulator build and throwaway local
// parameters/secrets. Preserve existing local configuration; never fetch live keys.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, lstat, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shellQuote = value => `'${String(value).replaceAll("'", `'\\''`)}'`;

export async function runE2eFunctionsEmulator({ rootDir = projectRoot, extraArgs = [] } = {}) {
  const envLocalPath = path.join(rootDir, 'functions', '.env.local');
  const secretLocalPath = path.join(rootDir, 'functions', '.secret.local');
  const firebaseBin = path.join(rootDir, 'node_modules', '.bin', 'firebase');
  let originalEnv = null;
  try {
    const metadata = await lstat(envLocalPath);
    if (!metadata.isFile()) throw new Error('Emulator parameter override must be a regular file.');
    originalEnv = { bytes: await readFile(envLocalPath), mode: metadata.mode & 0o777 };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let secretCreated = false;
  let envTouched = false;
  let child;
  let interrupted;
  let restorePromise;
  let exitCode = 1;
  const restore = () => restorePromise ??= (async () => {
    try {
      if (envTouched) {
        if (originalEnv) {
          await writeFile(envLocalPath, originalEnv.bytes);
          await chmod(envLocalPath, originalEnv.mode);
        } else await rm(envLocalPath);
      }
    } finally {
      if (secretCreated) await rm(secretLocalPath);
    }
  })();
  const onSignal = signal => {
    if (interrupted) return;
    interrupted = signal;
    if (child && child.exitCode === null && child.signalCode === null) {
      console.error('Waiting for Firebase emulator shutdown before restoring local configuration.');
      child.kill(signal);
    }
  };
  const onInterrupt = () => onSignal('SIGINT');
  const onTerminate = () => onSignal('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);

  try {
    // Exclusive creation also rejects stale sentinel files and symlinks; neither
    // proves this run owns the file or is allowed to replace it.
    const secret = await open(secretLocalPath, 'wx', 0o600);
    secretCreated = true;
    try {
      await secret.writeFile([
        `ANALYTICS_PSEUDONYM_KEY=${randomBytes(32).toString('hex')}`,
        'GEMINI_API_KEY=disabled-in-e2e-emulator',
        'PEXELS_API_KEY=disabled-in-e2e-emulator',
        'UNSPLASH_API_KEY=disabled-in-e2e-emulator', '',
      ].join('\n'));
    } finally { await secret.close(); }
    const parameters = await open(envLocalPath, originalEnv ? 'w' : 'wx', 0o600);
    envTouched = true;
    try {
      await parameters.chmod(0o600);
      await parameters.writeFile('ENFORCE_APP_CHECK=false\n');
    } finally { await parameters.close(); }
    if (!interrupted) {
      // Serial workers avoid contention in the shared callable rate-limit budgets.
      const workerArgs = extraArgs.some(arg => arg.startsWith('--workers') || arg === '-j') ? [] : ['--workers=1'];
      const command = ['npx', 'playwright', 'test', ...workerArgs, ...extraArgs].map(shellQuote).join(' ');
      const config = process.env.SONFLASH_E2E_FIREBASE_CONFIG;
      exitCode = await new Promise((resolve, reject) => {
        child = spawn(firebaseBin, [
          'emulators:exec', ...(config ? ['--config', config] : []),
          '--only', 'firestore,auth,functions', '--project', 'demo-lingoflash', command,
        ], { stdio: 'inherit', cwd: rootDir, detached: process.platform !== 'win32' });
        child.once('error', reject);
        child.once('exit', code => resolve(code ?? 1));
      });
    }
  } finally {
    try { await restore(); } finally {
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
    }
  }
  return interrupted ? 1 : exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runE2eFunctionsEmulator({ extraArgs: process.argv.slice(2) });
}

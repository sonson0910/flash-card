#!/usr/bin/env node
// Runs the Playwright e2e suite against the Firestore, Auth and Functions
// emulators together, so specs exercise the real Cloud Functions callables
// (createCard, reviewCardV2, bulkMutateCards, ...) instead of a
// firestore+auth-only harness that silently skipped every protected call.
//
// Two local-only overrides are required for that to work, both scoped
// strictly to this run and restored/removed afterward:
//
// 1. App Check. firebase-functions' onCall enforces App Check the same way
//    inside the emulator as in production (verified by reading
//    firebase-functions/lib/common/providers/https.js: a missing
//    X-Firebase-AppCheck header throws 'unauthenticated' whenever
//    `enforceAppCheck` resolves true — there is no emulator-specific
//    bypass), and the e2e build has no App Check site key to attach a token
//    with. functions/.env.local is the Firebase CLI's emulator-only
//    parameter override file (loaded only when `isEmulator` is true, never
//    for a real deploy), so this script flips its committed
//    `ENFORCE_APP_CHECK=true` to `false` for the duration of the run only,
//    then restores the original bytes.
// 2. Secrets. Every authenticated callable calls `requireUser`, which hashes
//    the uid with ANALYTICS_PSEUDONYM_KEY; an empty/short key throws before
//    the callable's own logic ever runs. Without functions/.secret.local the
//    emulator tries to fetch each defineSecret() from real Google Secret
//    Manager on first use — a real cloud call this project must not make in
//    e2e. This script writes a throwaway functions/.secret.local (a random
//    pseudonym key long enough to pass validation, and an obviously-invalid
//    placeholder for GEMINI_API_KEY/PEXELS_API_KEY/UNSPLASH_API_KEY) so the
//    emulator never attempts that fetch, then deletes the file afterward.
//    GEMINI_API_KEY is deliberately never a working key. The callable rejects
//    this exact sentinel before constructing a model client, including when
//    an e2e spec invokes a real AI callable through the Functions emulator.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envLocalPath = path.join(rootDir, 'functions', '.env.local');
const secretLocalPath = path.join(rootDir, 'functions', '.secret.local');
const firebaseBin = path.join(rootDir, 'node_modules', '.bin', 'firebase');

const extraArgs = process.argv.slice(2);
// emulators:exec runs its command through a shell, so every argument is
// single-quoted to keep values like `-g "two words"` as one argv entry.
const shellQuote = value => `'${String(value).replaceAll("'", `'\\''`)}'`;
// All workers share one Functions emulator; with two, the rate limiter's
// Firestore budget read misses its deadline and callables stall past the
// specs' visibility waits. Pass --workers to override.
const workerArgs = extraArgs.some(arg => arg.startsWith('--workers') || arg === '-j') ? [] : ['--workers=1'];
const playwrightCommand = ['npx', 'playwright', 'test', ...workerArgs, ...extraArgs].map(shellQuote).join(' ');

/** Restores or removes a file to its exact prior state, once, regardless of how it is called. */
function once(fn) {
  let done = false;
  return async (...args) => {
    if (done) return;
    done = true;
    await fn(...args);
  };
}

async function withEmulatorOnlyOverrides(run) {
  if (!existsSync(envLocalPath)) {
    throw new Error(`Expected ${envLocalPath} to exist (the emulator-only ENFORCE_APP_CHECK override).`);
  }
  if (existsSync(secretLocalPath)) {
    // A run killed before cleanup leaves this script's own throwaway file
    // behind; anything else is a real local secret file and stays untouched.
    const leftover = await readFile(secretLocalPath, 'utf8');
    if (!leftover.includes('GEMINI_API_KEY=disabled-in-e2e-emulator')) {
      throw new Error(`Refusing to overwrite an existing ${secretLocalPath}; remove it manually and retry.`);
    }
    await rm(secretLocalPath, { force: true });
  }
  const originalEnvLocal = await readFile(envLocalPath, 'utf8');
  const pseudonymKey = randomBytes(32).toString('hex');
  const secretLocalContent = [
    `ANALYTICS_PSEUDONYM_KEY=${pseudonymKey}`,
    'GEMINI_API_KEY=disabled-in-e2e-emulator',
    'PEXELS_API_KEY=disabled-in-e2e-emulator',
    'UNSPLASH_API_KEY=disabled-in-e2e-emulator',
    '',
  ].join('\n');

  const restore = once(async () => {
    await writeFile(envLocalPath, originalEnvLocal);
    await rm(secretLocalPath, { force: true });
  });
  const onSignal = () => { void restore().finally(() => process.exit(1)); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    await writeFile(envLocalPath, 'ENFORCE_APP_CHECK=false\n');
    await writeFile(secretLocalPath, secretLocalContent);
    return await run();
  } finally {
    await restore();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

function runEmulatorExec() {
  return new Promise((resolve, reject) => {
    const child = spawn(firebaseBin, [
      'emulators:exec',
      '--only', 'firestore,auth,functions',
      '--project', 'demo-lingoflash',
      playwrightCommand,
    ], { stdio: 'inherit', cwd: rootDir });
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  });
}

const exitCode = await withEmulatorOnlyOverrides(runEmulatorExec);
process.exit(exitCode);

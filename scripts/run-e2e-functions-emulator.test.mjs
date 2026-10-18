import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { describe, it } = process.env.VITEST ? await import('vitest') : await import('node:test');
const runner = pathToFileURL(path.resolve('scripts/run-e2e-functions-emulator.mjs')).href;
const setup = (mode = 'success') => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sonflash-e2e-runner-'));
  mkdirSync(path.join(root, 'functions'));
  mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  const envPath = path.join(root, 'functions/.env.local');
  const secretPath = path.join(root, 'functions/.secret.local');
  if (mode !== 'spawn-error') {
    const fake = path.join(root, 'node_modules/.bin/firebase');
    writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const assert = require('node:assert/strict');
assert.equal(fs.readFileSync('functions/.env.local', 'utf8'), 'ENFORCE_APP_CHECK=false\\n');
const secrets = fs.readFileSync('functions/.secret.local', 'utf8');
assert.match(secrets, /ANALYTICS_PSEUDONYM_KEY=[a-f0-9]{64}/);
assert.match(secrets, /GEMINI_API_KEY=disabled-in-e2e-emulator/);
assert.equal(fs.statSync('functions/.secret.local').mode & 0o777, 0o600);
fs.writeFileSync('child-pid', String(process.pid));
const mode = ${JSON.stringify(mode)};
if (mode === 'signal' || mode === 'double-signal') {
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    fs.appendFileSync('received-signals', signal + '\\n');
    if (mode === 'double-signal') console.log('FIRST_SIGNAL');
    setTimeout(() => {
      fs.writeFileSync('stopped-with-overrides', String(fs.existsSync('functions/.secret.local')));
      process.exit(0);
    }, mode === 'double-signal' ? 250 : 0);
  });
  console.log('READY');
  setInterval(() => {}, 1000);
} else process.exit(mode === 'failure' ? 7 : 0);
`);
    chmodSync(fake, 0o755);
  }
  const code = `import {runE2eFunctionsEmulator} from ${JSON.stringify(runner)}; process.exitCode = await runE2eFunctionsEmulator({rootDir:${JSON.stringify(root)},extraArgs:['--project=chromium']});`;
  return { root, envPath, secretPath, code, cleanup: () => rmSync(root, { recursive: true, force: true }) };
};
const run = state => spawnSync(process.execPath, ['--input-type=module', '-e', state.code], { encoding: 'utf8', timeout: 10_000 });

describe('emulator browser runner cleanup', () => {
  for (const mode of ['success', 'failure', 'spawn-error']) it(`restores existing bytes and permissions after ${mode}`, () => {
    const state = setup(mode);
    try {
      const original = Buffer.from('ENFORCE_APP_CHECK=true\r\n# keep bytes\r\n');
      writeFileSync(state.envPath, original, { mode: 0o640 });
      const result = run(state);
      assert.ifError(result.error);
      assert.equal(result.status, mode === 'success' ? 0 : mode === 'failure' ? 7 : 1, result.stderr);
      assert.deepEqual(readFileSync(state.envPath), original);
      assert.equal(statSync(state.envPath).mode & 0o777, 0o640);
      assert.equal(existsSync(state.secretPath), false);
    } finally { state.cleanup(); }
  });

  it('leaves a clean checkout without local parameter or secret files', () => {
    const state = setup();
    try {
      const result = run(state);
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(state.envPath), false);
      assert.equal(existsSync(state.secretPath), false);
    } finally { state.cleanup(); }
  });

  it('refuses a pre-existing secret, including a stale test sentinel, without replacing it', () => {
    const state = setup();
    try {
      const original = 'GEMINI_API_KEY=disabled-in-e2e-emulator\nKEEP_THIS=true\n';
      writeFileSync(state.secretPath, original, { mode: 0o600 });
      const result = run(state);
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.equal(readFileSync(state.secretPath, 'utf8'), original);
      assert.equal(existsSync(state.envPath), false);
      assert.equal(existsSync(path.join(state.root, 'child-pid')), false);
    } finally { state.cleanup(); }
  });

  for (const scenario of ['SIGINT', 'SIGTERM', 'double-signal']) it(`waits for child shutdown before restoring configuration on ${scenario}`, async () => {
    const signal = scenario === 'double-signal' ? 'SIGINT' : scenario;
    const state = setup(scenario === 'double-signal' ? scenario : 'signal');
    let child;
    try {
      child = spawn(process.execPath, ['--input-type=module', '-e', state.code], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      const finished = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => resolve(code));
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        await new Promise((resolve, reject) => {
          child.stdout.on('data', chunk => { if (String(chunk).includes('READY')) resolve(); });
          child.once('exit', () => reject(new Error(`runner exited before ready: ${stderr}`)));
        });
        const cliPid = Number(readFileSync(path.join(state.root, 'child-pid'), 'utf8'));
        const firstSignal = new Promise(resolve => child.stdout.on('data', chunk => { if (String(chunk).includes('FIRST_SIGNAL')) resolve(); }));
        child.kill(signal);
        if (scenario === 'double-signal') {
          await firstSignal;
          child.kill('SIGTERM');
        }
        assert.equal(await finished, 1, stderr);
        assert.equal(readFileSync(path.join(state.root, 'stopped-with-overrides'), 'utf8'), 'true');
        assert.equal(readFileSync(path.join(state.root, 'received-signals'), 'utf8'), signal + '\n');
        assert.throws(() => process.kill(cliPid, 0), { code: 'ESRCH' });
        assert.equal(existsSync(state.envPath), false);
        assert.equal(existsSync(state.secretPath), false);
      } finally { clearTimeout(timer); }
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      state.cleanup();
    }
  });
});

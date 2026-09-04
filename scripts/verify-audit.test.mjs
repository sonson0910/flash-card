import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { describe, it } = process.env.VITEST
  ? await import('vitest')
  : await import('node:test');

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const auditScript = path.join(repositoryRoot, 'scripts', 'verify-audit.mjs');

const successReport = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 0,
      critical: 0,
      total: 0,
    },
  },
});

const highVulnerabilityReport = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    unsafe: { severity: 'high' },
  },
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 1,
      critical: 0,
      total: 1,
    },
  },
});

function runAuditScenario(scenario, timeoutMs = 5_000, attemptTimeoutMs = timeoutMs) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-audit-'));
  const statePath = path.join(temporaryDirectory, 'calls.json');
  const npmPath = path.join(temporaryDirectory, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const fakeNpm = `#!/usr/bin/env node
import fs from 'node:fs';
const statePath = process.env.AUDIT_TEST_STATE;
const calls = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : [];
calls.push({ args: process.argv.slice(2), cwd: process.cwd() });
fs.writeFileSync(statePath, JSON.stringify(calls));
const scenario = process.env.AUDIT_TEST_SCENARIO;
if (scenario === 'timeout') {
  setTimeout(() => undefined, 10_000);
} else if (scenario === 'registry-once' && calls.length === 1) {
  console.error(JSON.stringify({ error: { code: 'EAI_AGAIN', summary: 'registry unavailable' } }));
  process.exitCode = 1;
} else if (scenario === 'registry-always') {
  console.error(JSON.stringify({ error: { code: 'ECONNRESET', summary: 'registry unavailable' } }));
  process.exitCode = 1;
} else if (scenario === 'vulnerability') {
  console.log(${JSON.stringify(highVulnerabilityReport)});
  process.exitCode = 1;
} else {
  console.log(${JSON.stringify(successReport)});
}
`;

  fs.writeFileSync(npmPath, fakeNpm, { mode: 0o755 });
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [auditScript], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${temporaryDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      AUDIT_TEST_SCENARIO: scenario,
      AUDIT_TEST_STATE: statePath,
      NPM_AUDIT_RETRY_DELAY_MS: '0',
      NPM_AUDIT_ATTEMPT_TIMEOUT_MS: String(attemptTimeoutMs),
      NPM_AUDIT_TIMEOUT_MS: String(timeoutMs),
    },
  });
  const calls = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
    : [];
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  return { calls, elapsedMs: Date.now() - startedAt, result };
}

describe('dependency audit preflight', () => {
  it('audits root and Functions separately and retries one transient registry failure', () => {
    const { calls, result } = runAuditScenario('registry-once');

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls, [
      { args: ['audit', '--audit-level=high', '--json'], cwd: repositoryRoot },
      { args: ['audit', '--audit-level=high', '--json'], cwd: repositoryRoot },
      {
        args: ['audit', '--audit-level=high', '--json'],
        cwd: path.join(repositoryRoot, 'functions'),
      },
    ]);
  });

  it('stops after one retry when the registry remains unavailable', () => {
    const { calls, result } = runAuditScenario('registry-always');

    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 2);
  });

  it('does not retry a real high-severity vulnerability', () => {
    const { calls, result } = runAuditScenario('vulnerability');

    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 1);
  });

  it('enforces one timeout budget for the whole preflight', () => {
    const { calls, elapsedMs, result } = runAuditScenario('timeout', 150);

    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 1);
    assert.ok(elapsedMs < 2_000, `preflight took ${elapsedMs}ms`);
  });

  it('retries one timed-out registry request within the preflight budget', () => {
    const { calls, elapsedMs, result } = runAuditScenario('timeout', 1_500, 100);

    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 2);
    assert.ok(elapsedMs < 3_000, `preflight took ${elapsedMs}ms`);
  });

  it('runs the pinned audit preflight before browser installation and full CI', () => {
    const qualityWorkflow = fs.readFileSync(
      path.join(repositoryRoot, '.github', 'workflows', 'quality.yml'),
      'utf8',
    );
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
    );
    const pinIndex = qualityWorkflow.indexOf('npm install --global npm@10.9.8');
    const rootInstallIndex = qualityWorkflow.indexOf('npm ci --no-audit --no-fund');
    const functionsInstallIndex = qualityWorkflow.indexOf(
      'npm ci --prefix functions --no-audit --no-fund',
    );
    const auditIndex = qualityWorkflow.indexOf('npm run verify:audit');
    const browserInstallIndex = qualityWorkflow.indexOf(
      'npx playwright install --with-deps chromium firefox webkit',
    );
    const fullCiIndex = qualityWorkflow.indexOf('npm run verify:ci');

    assert.equal(packageJson.packageManager, 'npm@10.9.8');
    assert.equal(packageJson.scripts['verify:audit'], 'node scripts/verify-audit.mjs');
    assert.ok(!packageJson.scripts['verify:ci'].includes('verify:audit'));
    assert.ok(pinIndex >= 0);
    assert.ok(pinIndex < rootInstallIndex);
    assert.ok(rootInstallIndex < functionsInstallIndex);
    assert.ok(functionsInstallIndex < auditIndex);
    assert.ok(auditIndex < browserInstallIndex);
    assert.ok(browserInstallIndex < fullCiIndex);
    assert.match(
      qualityWorkflow,
      /name: Audit dependencies before full CI[\s\S]*?timeout-minutes: 5[\s\S]*?run: npm run verify:audit/,
    );
  });
});

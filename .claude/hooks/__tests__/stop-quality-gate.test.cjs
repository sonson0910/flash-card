const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach, describe, it } = require('node:test');
const HOOK = path.resolve(__dirname, '..', 'stop-quality-gate.cjs');
const {
  javaMajor,
  runCommand,
  runQualityChecks,
} = require(HOOK);
const {
  changedPaths,
  diffFingerprint,
  matchingTests,
  selectQualityPlan,
} = require('../lib/stop-quality-plan.cjs');
const temporaryPaths = [];
function temporaryDirectory(prefix = 'stop-quality-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
function initializeRepository() {
  const cwd = temporaryDirectory();
  git(cwd, ['init', '--quiet']);
  fs.mkdirSync(path.join(cwd, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'lib', 'sample.ts'), 'export const sample = 1;\n');
  fs.writeFileSync(path.join(cwd, 'src', 'lib', 'sample.test.ts'), 'export {};\n');
  git(cwd, ['add', '.']);
  git(cwd, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'baseline']);
  return cwd;
}
afterEach(() => {
  while (temporaryPaths.length) fs.rmSync(temporaryPaths.pop(), { recursive: true, force: true });
});
describe('stop quality plan', () => {
  it('finds tracked and untracked paths and fingerprints their exact content', () => {
    const cwd = initializeRepository();
    fs.writeFileSync(path.join(cwd, 'src', 'lib', 'sample.ts'), 'export const sample = 2;\n');
    fs.writeFileSync(path.join(cwd, 'new-file.ts'), 'one\n');
    const changes = changedPaths(cwd);
    assert.equal(changes.overflow, false);
    assert.equal(changes.incomplete, false);
    assert.deepEqual(changes.files, ['new-file.ts', 'src/lib/sample.ts']);
    const first = diffFingerprint(cwd, changes.files);
    assert.equal(first, diffFingerprint(cwd, changes.files));
    fs.writeFileSync(path.join(cwd, 'new-file.ts'), 'two\n');
    assert.notEqual(diffFingerprint(cwd, changes.files), first);
  });
  it('detects path overflow instead of silently truncating validation', () => {
    const cwd = initializeRepository();
    const bulk = path.join(cwd, 'bulk');
    fs.mkdirSync(bulk);
    for (let index = 0; index < 2_049; index += 1) {
      fs.writeFileSync(path.join(bulk, `${String(index).padStart(4, '0')}.txt`), '');
    }
    fs.writeFileSync(path.join(cwd, 'firestore.rules'), 'rules_version = "2";\n');
    const changes = changedPaths(cwd);
    assert.equal(changes.overflow, true);
    assert.equal(changes.files.length, 2_048);
    const result = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ cwd, session_id: `overflow-${process.pid}` }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).decision, 'block');
  });
  it('maps application and Functions files to focused checks', () => {
    const cwd = temporaryDirectory();
    fs.mkdirSync(path.join(cwd, 'src', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'functions', 'test'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'lib', 'card.ts'), '');
    fs.writeFileSync(path.join(cwd, 'src', 'lib', 'card.test.ts'), '');
    fs.writeFileSync(path.join(cwd, 'functions', 'test', 'inputValidation.test.ts'), '');
    assert.deepEqual(matchingTests(cwd, 'src/lib/card.ts'), ['src/lib/card.test.ts']);
    const plan = selectQualityPlan(cwd, [
      'src/lib/card.ts',
      'functions/src/inputValidation.ts',
    ]);
    assert.deepEqual(plan.checks.map(check => check.id), [
      'app-lint',
      'app-tests',
      'functions-lint',
      'functions-build',
      'functions-tests',
    ]);
  });
  it('selects declared package tests and standalone custom runners for Claude automation', () => {
    const cwd = temporaryDirectory();
    const hookTests = path.join(cwd, '.claude', 'hooks', '__tests__');
    const scriptTests = path.join(cwd, '.claude', 'scripts');
    const dashboardTests = path.join(cwd, '.claude', 'skills', 'markdown-novel-viewer', 'tests');
    const worktreeTests = path.join(cwd, '.claude', 'skills', 'worktree', 'scripts');
    fs.mkdirSync(hookTests, { recursive: true });
    fs.mkdirSync(scriptTests, { recursive: true });
    fs.mkdirSync(dashboardTests, { recursive: true });
    fs.mkdirSync(worktreeTests, { recursive: true });
    fs.writeFileSync(path.join(hookTests, 'first.test.cjs'), '');
    fs.writeFileSync(path.join(hookTests, 'second.test.cjs'), '');
    fs.writeFileSync(path.join(scriptTests, 'scan_skills.test.cjs'), '');
    fs.writeFileSync(path.join(cwd, '.claude', 'skills', 'markdown-novel-viewer', 'package.json'), JSON.stringify({
      scripts: { test: 'node scripts/tests/server.test.cjs' },
    }));
    fs.writeFileSync(path.join(dashboardTests, 'dashboard-assets.test.cjs'), 'describe("assets", () => {});');
    fs.writeFileSync(path.join(worktreeTests, 'worktree.test.cjs'), '');

    const plan = selectQualityPlan(cwd, [
      '.claude/hooks/lib/stop-quality-plan.cjs',
      '.claude/scripts/scan_skills.py',
      '.claude/skills/markdown-novel-viewer/tests/dashboard-assets.test.cjs',
      '.claude/skills/worktree/scripts/worktree.cjs',
    ]);
    assert.deepEqual(plan.checks.map(check => check.id), [
      'automation-hook-tests',
      'automation-test:.claude/scripts/scan_skills.test.cjs',
      'automation-skill-test:.claude/skills/markdown-novel-viewer',
      'automation-test:.claude/skills/worktree/scripts/worktree.test.cjs',
    ]);
    assert.deepEqual(plan.checks[0].args, ['--test', '--test-concurrency=1',
      '.claude/hooks/__tests__/first.test.cjs',
      '.claude/hooks/__tests__/second.test.cjs',
    ]);
    assert.deepEqual(plan.checks.slice(1).map(check => check.args), [
      ['.claude/scripts/scan_skills.test.cjs'],
      ['--prefix', '.claude/skills/markdown-novel-viewer', 'test'],
      ['.claude/skills/worktree/scripts/worktree.test.cjs'],
    ]);
    assert.ok(!plan.checks.some(check => check.args.includes('.claude/skills/markdown-novel-viewer/tests/dashboard-assets.test.cjs')));
  });
  it('selects release, Rules, and E2E boundaries without browser execution', () => {
    const cwd = temporaryDirectory();
    const hookTests = path.join(cwd, '.claude', 'hooks', '__tests__');
    fs.mkdirSync(hookTests, { recursive: true });
    fs.writeFileSync(path.join(hookTests, 'hook.test.cjs'), '');
    const plan = selectQualityPlan(cwd, [
      'e2e/sync-acceptance.spec.ts',
      'firestore.rules',
      '.github/workflows/release-candidate.yml',
      '.claude/settings.json',
    ]);
    assert.equal(plan.rulesChanged, true);
    assert.ok(plan.checks.some(check => check.id === 'app-lint'));
    assert.ok(plan.checks.some(check => check.id === 'release-tests'));
    assert.ok(plan.checks.some(check => check.id === 'automation-hook-tests'));
    assert.match(plan.notes.join('\n'), /Browser tests were not auto-run/);
  });
  it('selects migration and trust-root release boundaries independently', () => {
    const cwd = temporaryDirectory();
    const migrationPlan = selectQualityPlan(cwd, ['.github/workflows/reservation-migration.yml']);
    assert.equal(migrationPlan.rulesChanged, true);
    assert.deepEqual(migrationPlan.checks.map(check => check.id), ['release-tests']);
    assert.deepEqual(migrationPlan.notes, ['RULES_CHECK_REQUIRED']);

    const trustRootPlan = selectQualityPlan(cwd, ['evidence-attestation-trust-root.json']);
    assert.equal(trustRootPlan.rulesChanged, false);
    assert.deepEqual(trustRootPlan.checks.map(check => check.id), ['release-tests']);
    assert.deepEqual(trustRootPlan.notes, []);
  });
});
describe('stop quality execution', () => {
  it('runs Rules tests only with Java 21', () => {
    const calls = [];
    const result = runQualityChecks('/repo', {
      checks: [],
      notes: ['RULES_CHECK_REQUIRED'],
      rulesChanged: true,
    }, check => {
      calls.push(check.id || check.command);
      return check.command === 'java'
        ? { ok: true, output: 'openjdk version "21.0.8"' }
        : { ok: true, output: '' };
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['java', 'firestore-rules']);
    assert.equal(javaMajor('java version "1.8.0"'), 8);
  });
  it('does not cache skipped Rules checks and retries when Java becomes available', () => {
    let javaAvailable = false;
    const calls = [];
    const plan = { checks: [], notes: ['RULES_CHECK_REQUIRED'], rulesChanged: true };
    const runner = check => {
      calls.push(check.id || check.command);
      if (check.command !== 'java') return { ok: true, output: '' };
      return javaAvailable
        ? { ok: true, output: 'openjdk version "21.0.8"' }
        : { ok: false, error: 'not found', output: '' };
    };
    const skipped = runQualityChecks('/repo', plan, runner);
    assert.equal(skipped.ok, true);
    assert.equal(skipped.cacheable, false);
    assert.match(skipped.notes.join('\n'), /BLOCKED \/ NOT RUN/);
    javaAvailable = true;
    assert.equal(runQualityChecks('/repo', plan, runner).cacheable, true);
    assert.ok(calls.includes('firestore-rules'));
  });
  it('returns concise actionable output for failed checks', () => {
    const result = runQualityChecks('/repo', {
      checks: [{ label: 'App TypeScript', command: 'npm', args: ['run', 'lint'], timeoutMs: 1_000 }],
      notes: [],
      rulesChanged: false,
    }, () => ({ ok: false, status: 2, output: 'type error' }));
    assert.equal(result.ok, false);
    assert.match(result.reason, /npm run lint/);
    assert.match(result.reason, /type error/);
  });
  it('marks timed-out commands as failures', () => {
    const result = runCommand({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 1000)'],
      timeoutMs: 10,
    }, process.cwd());
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
  });
  it('no-ops during a recursive Stop hook invocation', () => {
    const result = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ stop_hook_active: true, cwd: '/missing' }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });
  it('no-ops when disabled in the shared hook configuration', () => {
    const home = temporaryDirectory('stop-quality-home-');
    const cwd = temporaryDirectory('stop-quality-cwd-');
    const configDirectory = path.join(home, '.claude');
    fs.mkdirSync(configDirectory);
    fs.writeFileSync(path.join(configDirectory, '.ck.json'), JSON.stringify({
      hooks: { 'stop-quality-gate': false },
    }));
    const result = spawnSync(process.execPath, [HOOK], {
      cwd,
      input: JSON.stringify({ cwd: '/missing' }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });
  it('caches successful checks for the same session and diff', () => {
    const cwd = initializeRepository();
    fs.writeFileSync(path.join(cwd, 'src', 'lib', 'sample.ts'), 'export const sample = 2;\n');
    const bin = temporaryDirectory('stop-quality-bin-');
    const countFile = path.join(temporaryDirectory('stop-quality-count-'), 'calls');
    const npm = path.join(bin, 'npm');
    fs.writeFileSync(npm, '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.COUNT_FILE, "1\\n");\n');
    fs.chmodSync(npm, 0o755);
    const payload = JSON.stringify({ cwd, session_id: `test-${process.pid}` });
    const options = {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COUNT_FILE: countFile },
    };
    assert.equal(spawnSync(process.execPath, [HOOK], options).status, 0);
    assert.equal(spawnSync(process.execPath, [HOOK], options).status, 0);
    assert.equal(fs.readFileSync(countFile, 'utf8').trim().split('\n').length, 2);
  });
});

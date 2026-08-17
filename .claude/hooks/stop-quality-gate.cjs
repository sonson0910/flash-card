#!/usr/bin/env node
/**
 * Stop hook that runs fast checks selected from the current Git diff.
 * Successful results are cached per session and exact working-tree fingerprint.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  changedPaths,
  diffFingerprint,
  selectQualityPlan,
} = require('./lib/stop-quality-plan.cjs');
const { isHookEnabled } = require('./lib/ck-config-utils.cjs');

function readPayload() {
  const input = fs.readFileSync(0, 'utf8').trim();
  return input ? JSON.parse(input) : {};
}

function runCommand(check, cwd) {
  const result = spawnSync(check.command, check.args, {
    cwd,
    encoding: 'utf8',
    timeout: check.timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error?.code === 'ETIMEDOUT') return { ok: false, timedOut: true, output };
  if (result.error) return { ok: false, error: result.error.message, output };
  return { ok: result.status === 0, status: result.status, output };
}

function javaMajor(output) {
  const match = output.match(/version\s+"(?:1\.)?(\d+)/i)
    || output.match(/(?:openjdk|java)\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function failureMessage(check, result) {
  const command = [check.command, ...check.args].join(' ');
  const reason = result.timedOut
    ? `timed out after ${Math.round(check.timeoutMs / 1000)}s`
    : result.error || `exited with status ${result.status}`;
  const output = result.output ? `\n${result.output.slice(-4_000)}` : '';
  return `Stop quality gate blocked: ${check.label} ${reason}.\nRun: ${command}${output}`;
}

function runQualityChecks(cwd, plan, runner = runCommand) {
  const notes = plan.notes.filter(note => note !== 'RULES_CHECK_REQUIRED');
  const checks = [...plan.checks];
  let cacheable = true;

  if (plan.rulesChanged) {
    const java = runner({ command: 'java', args: ['-version'], timeoutMs: 10_000 }, cwd);
    if (java.ok && javaMajor(java.output) === 21) {
      checks.push({
        id: 'firestore-rules',
        label: 'Firestore Rules tests',
        command: 'npm',
        args: ['run', 'test:rules'],
        timeoutMs: 300_000,
      });
    } else {
      cacheable = false;
      notes.push('Firestore Rules verification BLOCKED / NOT RUN: Java 21 is unavailable.');
    }
  }

  for (const check of checks) {
    const result = runner(check, cwd);
    if (!result.ok) return { ok: false, reason: failureMessage(check, result), notes, checks, cacheable: false };
  }
  return { ok: true, notes, checks, cacheable };
}

function cachePath(sessionId) {
  const key = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 24);
  return path.join(os.tmpdir(), `sonflash-stop-quality-${key}.json`);
}

function cacheMatches(file, fingerprint) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).fingerprint === fingerprint;
  } catch {
    return false;
  }
}

function writeCache(file, fingerprint) {
  try {
    fs.writeFileSync(file, JSON.stringify({ fingerprint }), { mode: 0o600 });
  } catch { /* cache failure only causes checks to rerun */ }
}

function emitBlock(reason) {
  console.log(JSON.stringify({ decision: 'block', reason }));
}

function emitNotes(notes) {
  if (notes.length) console.log(JSON.stringify({ systemMessage: notes.join('\n') }));
}

function main() {
  if (!isHookEnabled('stop-quality-gate')) return;
  const payload = readPayload();
  if (payload.stop_hook_active === true) return;

  const cwd = path.resolve(payload.cwd || process.cwd());
  const changes = changedPaths(cwd);
  if (changes.incomplete) {
    emitBlock('Stop quality gate blocked: the complete Git diff could not be inspected within safety bounds. Retry or run the required checks manually.');
    return;
  }
  if (changes.overflow) {
    emitBlock('Stop quality gate blocked: more than 2,048 changed paths prevent complete diff-aware validation. Narrow the diff or run the required checks manually.');
    return;
  }
  const { files } = changes;
  if (!files.length) return;
  const plan = selectQualityPlan(cwd, files);
  if (!plan.checks.length && !plan.rulesChanged && !plan.notes.length) return;

  const fingerprint = diffFingerprint(cwd, files);
  const sessionId = String(payload.session_id || '');
  const cache = sessionId && fingerprint ? cachePath(sessionId) : null;
  if (cache && cacheMatches(cache, fingerprint)) return;

  const result = runQualityChecks(cwd, plan);
  if (!result.ok) {
    emitBlock(result.reason);
    return;
  }
  if (cache && result.cacheable) writeCache(cache, fingerprint);
  emitNotes(result.notes);
}

try {
  if (require.main === module) main();
} catch {
  process.exit(0);
}

module.exports = { cachePath, javaMajor, runCommand, runQualityChecks };

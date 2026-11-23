import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIMEOUT_MS = 270_000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 60_000;
const MAX_REGISTRY_RETRIES = 1;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
// High advisories that have no patched release and reach only development tooling. An exception applies
// only while every affected install path is dev-only in the target's lockfile and the date has not passed,
// so a runtime dependency on the package, or a stale exception, fails the gate again.
const ACCEPTED_DEV_ADVISORIES = [
  {
    id: 'GHSA-fc5q-39xc-vjpf',
    package: 'picomatch',
    expires: '2027-01-31',
    reason: 'ReDoS in glob matching with no patched release (<= 4.0.7); used only by build and test tooling on repository-authored patterns.',
  },
];
const registryErrorPattern = /(?:EAI_AGAIN|ECONNRESET|ECONNREFUSED|ENETUNREACH|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ERR_SOCKET_TIMEOUT|fetch failed|audit endpoint returned an error|registry\.npmjs\.org|bad gateway|service unavailable|gateway timeout|too many requests)/i;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseAuditReport(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function highSeverityCount(report) {
  const vulnerabilities = report?.metadata?.vulnerabilities;
  return {
    critical: Number(vulnerabilities?.critical ?? 0),
    high: Number(vulnerabilities?.high ?? 0),
  };
}

function readLockfilePackages(cwd) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json'), 'utf8')).packages ?? {};
  } catch {
    return {};
  }
}

/** Splits high and critical advisories into accepted dev-only exceptions and blocking findings. */
function classifyHighAdvisories(report, lockfilePackages, today) {
  const accepted = new Set();
  const blocking = new Set();
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (!via || typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue;
      const id = String(via.url ?? via.source ?? '').split('/').pop();
      const label = `${via.name} ${id}`;
      const exception = ACCEPTED_DEV_ADVISORIES.find(entry => entry.id === id && entry.package === via.name);
      const nodes = vulnerability.nodes ?? [];
      const devOnly = nodes.length > 0 && nodes.every(node => lockfilePackages[node]?.dev === true);
      if (exception && today <= exception.expires && devOnly) accepted.add(label);
      else blocking.add(label);
    }
  }
  return { accepted: [...accepted], blocking: [...blocking] };
}

function runAudit(args, cwd, timeoutMs) {
  const result = spawnSync(npmCommand, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return {
    ...result,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim(),
    report: parseAuditReport(result.stdout ?? ''),
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

async function auditTarget(target, deadline, attemptTimeoutMs, retryDelayMs) {
  for (let attempt = 0; attempt <= MAX_REGISTRY_RETRIES; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      console.error(`[audit] ${target.label}: preflight exceeded its timeout budget.`);
      return false;
    }

    const result = runAudit(
      target.args,
      target.cwd,
      Math.min(remainingMs, attemptTimeoutMs),
    );
    const { critical, high } = highSeverityCount(result.report);
    if (result.status === 0 && result.report && high === 0 && critical === 0) {
      console.log(`[audit] ${target.label}: no high or critical vulnerabilities.`);
      return true;
    }

    if (high > 0 || critical > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const { accepted, blocking } = classifyHighAdvisories(result.report, readLockfilePackages(target.cwd), today);
      if (blocking.length === 0 && accepted.length > 0) {
        console.warn(`[audit] ${target.label}: accepted dev-only advisories without a patched release: ${accepted.join(', ')}.`);
        return true;
      }
      console.error(`[audit] ${target.label}: found ${high} high and ${critical} critical vulnerabilities.`);
      if (blocking.length > 0) console.error(`[audit] ${target.label}: blocking advisories: ${blocking.join(', ')}.`);
      console.error(result.stdout.trim());
      return false;
    }

    const registryFailure = result.timedOut || registryErrorPattern.test(result.output);
    if (registryFailure && attempt < MAX_REGISTRY_RETRIES && Date.now() < deadline) {
      console.warn(`[audit] ${target.label}: registry failure; retrying once.`);
      const delayMs = Math.min(retryDelayMs, Math.max(0, deadline - Date.now()));
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      continue;
    }

    const reason = result.timedOut
      ? 'audit command timed out'
      : result.output || 'audit command returned no valid JSON report';
    console.error(`[audit] ${target.label}: ${reason}`);
    return false;
  }
  return false;
}

const timeoutMs = positiveInteger(process.env.NPM_AUDIT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
const attemptTimeoutMs = positiveInteger(
  process.env.NPM_AUDIT_ATTEMPT_TIMEOUT_MS,
  DEFAULT_ATTEMPT_TIMEOUT_MS,
);
const retryDelayMs = nonNegativeInteger(process.env.NPM_AUDIT_RETRY_DELAY_MS, 1_000);
const deadline = Date.now() + timeoutMs;
const targets = [
  {
    label: 'root',
    cwd: repositoryRoot,
    args: [
      'audit',
      '--audit-level=high',
      '--fetch-retries=0',
      '--fetch-timeout=30000',
      '--json',
    ],
  },
  {
    label: 'functions',
    cwd: path.join(repositoryRoot, 'functions'),
    args: [
      'audit',
      '--audit-level=high',
      '--fetch-retries=0',
      '--fetch-timeout=30000',
      '--json',
    ],
  },
];

const requestedTarget = process.argv[2];
const selectedTargets = requestedTarget
  ? targets.filter(target => target.label === requestedTarget)
  : targets;

if (selectedTargets.length === 0) {
  console.error(`[audit] unknown target: ${requestedTarget}`);
  process.exitCode = 1;
}

for (const target of selectedTargets) {
  if (!await auditTarget(target, deadline, attemptTimeoutMs, retryDelayMs)) {
    process.exitCode = 1;
    break;
  }
}

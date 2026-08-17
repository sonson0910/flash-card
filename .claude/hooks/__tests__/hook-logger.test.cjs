#!/usr/bin/env node

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOGGER_PATH = path.join(__dirname, '..', 'lib', 'hook-logger.cjs');
const LOCK_PATH = path.join(__dirname, '..', 'lib', 'hook-log-ticket-lock.cjs');
const STATE_PATH = path.join(__dirname, '..', 'lib', 'hook-log-ticket-state.cjs');
const CHILD_TIMEOUT_MS = 5_000;
let logDir;
let logFile;
let lockFile;
let logger;

function waitForChildSignal(child, expected, label, getStderr) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onData = chunk => {
      stdout += String(chunk);
      if (stdout.includes(expected)) finish(resolve);
    };
    const onError = error => finish(reject, error);
    const onExit = (code, signal) => finish(reject, new Error(
      `${label} exited before ${expected} (${code ?? signal}): ${getStderr()}`,
    ));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error(
        `${label} timed out waiting for ${expected}: ${getStderr()}`,
      ));
    }, CHILD_TIMEOUT_MS);
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

function waitForChildExit(child, label, getStderr, accepts = code => code === 0) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onError = error => finish(reject, error);
    const onExit = (code, signal) => {
      if (accepts(code, signal)) finish(resolve);
      else finish(reject, new Error(
        `${label} exited ${code ?? signal}: ${getStderr()}`,
      ));
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error(`${label} timed out: ${getStderr()}`));
    }, CHILD_TIMEOUT_MS);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

function readEntries() {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function seedLogEntries(count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(JSON.stringify({
      ts: `2026-03-18T12:00:${String(i % 60).padStart(2, '0')}.000Z`,
      hook: 'seed',
      status: 'ok',
      note: String(i),
    }));
  }
  fs.writeFileSync(logFile, `${lines.join('\n')}\n`, 'utf8');
}

function currentProcessStart() {
  const { readProcessStartIdentity } = require(STATE_PATH);
  const processStart = readProcessStartIdentity(process.pid);
  assert.match(processStart, /^\d+$/);
  return processStart;
}

function runWriter(writerId, count) {
  const script = `
    const { logHook } = require(${JSON.stringify(LOGGER_PATH)});
    for (let i = 0; i < ${count}; i++) {
      logHook('child-writer', { status: 'ok', note: ${JSON.stringify(writerId)} + ':' + i });
    }
  `;
  const child = spawn(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLAUDE_HOOK_LOG_DIR_FOR_TESTS: logDir,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  return waitForChildExit(child, `Writer ${writerId}`, () => stderr);
}

function startStaleLockOwner() {
  const script = `
    const fs = require('node:fs');
    let processStart = '';
    if (process.platform === 'linux') {
      const stat = fs.readFileSync('/proc/' + process.pid + '/stat', 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\\s+/);
      processStart = fields[19] || '';
    }
    const fd = fs.openSync(${JSON.stringify(lockFile)}, 'wx');
    fs.writeFileSync(fd, JSON.stringify({
      pid: process.pid,
      createdAt: Date.now() - 60000,
      processStart,
    }));
    fs.closeSync(fd);
    process.stdout.write('ready\\n');
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  return waitForChildSignal(child, 'ready', 'Lock owner', () => stderr)
    .then(() => child);
}

function startPausedTicketPublisher(targetLockFile) {
  const script = `
    const fs = require('node:fs');
    const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const targetLockFile = ${JSON.stringify(targetLockFile)};
    const originalLinkSync = fs.linkSync;
    fs.linkSync = function(source, target) {
      originalLinkSync.call(fs, source, target);
      if (target === targetLockFile) {
        process.stdout.write('published\\n');
        while (true) sleep(1000);
      }
    };
    const { logHook } = require(${JSON.stringify(LOGGER_PATH)});
    logHook('paused-ticket-owner', { status: 'ok' });
  `;
  const child = spawn(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLAUDE_HOOK_LOG_DIR_FOR_TESTS: logDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  return waitForChildSignal(
    child,
    'published',
    'Ticket publisher',
    () => stderr,
  ).then(() => child);
}

function startPausedRecoveryPublisher() {
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const originalLinkSync = fs.linkSync;
    fs.linkSync = function(source, target) {
      originalLinkSync.call(fs, source, target);
      if (path.basename(target).startsWith('.hook-log-recovery.')) {
        process.stdout.write('recovery-published\\n');
        while (true) sleep(1000);
      }
    };
    const { logHook } = require(${JSON.stringify(LOGGER_PATH)});
    logHook('paused-recovery-owner', { status: 'ok' });
  `;
  const child = spawn(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLAUDE_HOOK_LOG_DIR_FOR_TESTS: logDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  return waitForChildSignal(
    child,
    'recovery-published',
    'Recovery publisher',
    () => stderr,
  ).then(() => child);
}

async function killPausedChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForChildExit(
    child,
    'Paused child',
    () => '',
    (_code, signal) => signal === 'SIGKILL',
  );
  child.kill('SIGKILL');
  await exited;
}

function startPausedRotationWriter(writerId, releaseFile, pausedMarker) {
  const script = `
    const fs = require('node:fs');
    const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const originalReadFileSync = fs.readFileSync;
    let paused = false;
    fs.readFileSync = function(target, ...args) {
      const value = originalReadFileSync.call(fs, target, ...args);
      if (!paused && target === ${JSON.stringify(logFile)}) {
        paused = true;
        fs.writeFileSync(${JSON.stringify(pausedMarker)}, 'paused', 'utf8');
        process.stdout.write('paused\\n');
        while (!fs.existsSync(${JSON.stringify(releaseFile)})) sleep(1);
      }
      return value;
    };
    const { logHook } = require(${JSON.stringify(LOGGER_PATH)});
    logHook('stale-ticket-writer', { status: 'ok', note: ${JSON.stringify(writerId)} });
  `;
  const child = spawn(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLAUDE_HOOK_LOG_DIR_FOR_TESTS: logDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ready = waitForChildSignal(
    child,
    'paused',
    'Paused rotation writer',
    () => stderr,
  );
  const completion = waitForChildExit(
    child,
    'Paused rotation writer',
    () => stderr,
  );
  return { child, ready, completion };
}

function startObservedWriter(writerId, appendMarker, blockedMarker) {
  const script = `
    const fs = require('node:fs');
    const originalAppendFileSync = fs.appendFileSync;
    const originalAtomicsWait = Atomics.wait;
    let blockedSignaled = false;
    Atomics.wait = function(...args) {
      if (
        !blockedSignaled
        && fs.existsSync(${JSON.stringify(path.join(logDir, 'hook-log.lock.2'))})
        && fs.existsSync(${JSON.stringify(path.join(logDir, 'hook-log.lock.3'))})
      ) {
        blockedSignaled = true;
        fs.writeFileSync(${JSON.stringify(blockedMarker)}, 'blocked', 'utf8');
        process.stdout.write('blocked\\n');
      }
      return originalAtomicsWait.call(Atomics, ...args);
    };
    fs.appendFileSync = function(target, ...args) {
      if (target === ${JSON.stringify(logFile)}) {
        originalAppendFileSync.call(fs, ${JSON.stringify(appendMarker)}, 'entered\\n');
      }
      return originalAppendFileSync.call(fs, target, ...args);
    };
    const { logHook } = require(${JSON.stringify(LOGGER_PATH)});
    logHook('stale-ticket-writer', { status: 'ok', note: ${JSON.stringify(writerId)} });
  `;
  const child = spawn(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLAUDE_HOOK_LOG_DIR_FOR_TESTS: logDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ready = waitForChildSignal(
    child,
    'blocked',
    'Observed writer',
    () => stderr,
  );
  const completion = waitForChildExit(
    child,
    'Observed writer',
    () => stderr,
  );
  return { child, ready, completion };
}

beforeEach(() => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-hook-logger-'));
  logFile = path.join(logDir, 'hook-log.jsonl');
  lockFile = path.join(logDir, 'hook-log.lock.1');
  process.env.NODE_ENV = 'test';
  process.env.CLAUDE_HOOK_LOG_DIR_FOR_TESTS = logDir;
  delete require.cache[require.resolve(LOGGER_PATH)];
  logger = require(LOGGER_PATH);
});

afterEach(() => {
  delete require.cache[require.resolve(LOGGER_PATH)];
  delete process.env.CLAUDE_HOOK_LOG_DIR_FOR_TESTS;
  delete process.env.NODE_ENV;
  fs.rmSync(logDir, { recursive: true, force: true });
});

describe('hook-logger', () => {
  it('writes structured hook fields', () => {
    logger.logHook('privacy-block', {
      event: 'PreToolUse',
      tool: 'Grep',
      target: '.env',
      note: 'approval-required',
      status: 'block',
      exit: 2,
    });

    const [entry] = readEntries();
    assert.strictEqual(entry.hook, 'privacy-block');
    assert.strictEqual(entry.event, 'PreToolUse');
    assert.strictEqual(entry.tool, 'Grep');
    assert.strictEqual(entry.target, '.env');
    assert.strictEqual(entry.note, 'approval-required');
    assert.strictEqual(entry.status, 'block');
    assert.strictEqual(entry.exit, 2);
  });

  it('ignores the test log override outside test mode', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-hook-logger-production-'));
    const fixtureLib = path.join(fixtureRoot, 'lib');
    const fixtureLogger = path.join(fixtureLib, 'hook-logger.cjs');
    const ignoredOverride = path.join(fixtureRoot, 'ignored-override');
    fs.mkdirSync(fixtureLib, { recursive: true });
    fs.copyFileSync(LOGGER_PATH, fixtureLogger);
    fs.copyFileSync(LOCK_PATH, path.join(fixtureLib, path.basename(LOCK_PATH)));
    fs.copyFileSync(STATE_PATH, path.join(fixtureLib, path.basename(STATE_PATH)));

    try {
      process.env.NODE_ENV = 'production';
      process.env.CLAUDE_HOOK_LOG_DIR_FOR_TESTS = ignoredOverride;
      const productionLogger = require(fixtureLogger);
      productionLogger.logHook('production-logger', { status: 'ok' });

      assert.strictEqual(fs.existsSync(ignoredOverride), false);
      assert.strictEqual(
        fs.existsSync(path.join(fixtureRoot, '.logs', 'hook-log.jsonl')),
        true,
      );
    } finally {
      delete require.cache[require.resolve(fixtureLogger)];
      process.env.NODE_ENV = 'test';
      process.env.CLAUDE_HOOK_LOG_DIR_FOR_TESTS = logDir;
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('merges base timer fields into the final entry', async () => {
    const timer = logger.createHookTimer('usage-context-awareness', {
      event: 'PostToolUse',
      tool: 'Grep',
    });

    await new Promise(resolve => setTimeout(resolve, 5));
    timer.end({ status: 'skip', note: 'throttled' });

    const [entry] = readEntries();
    assert.strictEqual(entry.hook, 'usage-context-awareness');
    assert.strictEqual(entry.event, 'PostToolUse');
    assert.strictEqual(entry.tool, 'Grep');
    assert.strictEqual(entry.status, 'skip');
    assert.strictEqual(entry.note, 'throttled');
    assert.ok(entry.dur >= 0);
  });

  it('normalizes crash logging', () => {
    logger.logHookCrash('scout-block', new Error('boom'), {
      event: 'PreToolUse',
      tool: 'Read',
    });

    const [entry] = readEntries();
    assert.strictEqual(entry.hook, 'scout-block');
    assert.strictEqual(entry.event, 'PreToolUse');
    assert.strictEqual(entry.tool, 'Read');
    assert.strictEqual(entry.status, 'crash');
    assert.strictEqual(entry.error, 'boom');
  });

  it('rotates under lock and preserves the newest entries', () => {
    seedLogEntries(1000);

    logger.logHook('hook-logger', { status: 'ok', note: 'latest' });

    const entries = readEntries();
    assert.strictEqual(entries.length, 500);
    assert.strictEqual(entries.at(-1).note, 'latest');
  });

  it('preserves the live log when a rotation temp write fails', () => {
    seedLogEntries(1000);
    const originalWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = function(target, data, ...args) {
      if (typeof target === 'number') {
        originalWriteFileSync.call(fs, target, String(data).slice(0, 16), ...args);
        throw new Error('simulated temp write failure');
      }
      return originalWriteFileSync.call(fs, target, data, ...args);
    };
    try {
      logger.logHook('hook-logger', { status: 'ok', note: 'still-live' });
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }

    const entries = readEntries();
    assert.strictEqual(entries.length, 1001);
    assert.strictEqual(entries.at(-1).note, 'still-live');
    assert.deepStrictEqual(
      fs.readdirSync(logDir).filter(name => name.includes('.rotate.')),
      [],
    );
  });

  it('removes an abandoned rotation temp while holding the lock', () => {
    const abandoned = path.join(logDir, 'hook-log.jsonl.rotate.abandoned');
    fs.writeFileSync(abandoned, 'partial', 'utf8');

    logger.logHook('hook-logger', { status: 'ok', note: 'cleanup-temp' });

    assert.strictEqual(fs.existsSync(abandoned), false);
    assert.deepStrictEqual(
      readEntries().map(entry => entry.note),
      ['cleanup-temp'],
    );
  });

  it('bounds abandoned rotation temp cleanup per lock hold', () => {
    for (let index = 0; index < 200; index += 1) {
      fs.writeFileSync(
        path.join(logDir, `hook-log.jsonl.rotate.${index}`),
        'partial',
        'utf8',
      );
    }

    logger.logHook('hook-logger', { status: 'ok', note: 'bounded-cleanup' });

    const remaining = fs.readdirSync(logDir)
      .filter(name => name.startsWith('hook-log.jsonl.rotate.'));
    assert.ok(remaining.length >= 184, `Unexpected cleanup size: ${remaining.length}`);
    assert.deepStrictEqual(
      readEntries().map(entry => entry.note),
      ['bounded-cleanup'],
    );
  });

  it('drops append and rotation after a bounded lock timeout', () => {
    seedLogEntries(1000);
    fs.writeFileSync(lockFile, 'held', 'utf8');

    const startedAt = performance.now();
    logger.logHook('hook-logger', { status: 'ok', note: 'must-drop' });
    const elapsedMs = performance.now() - startedAt;

    const entries = readEntries();
    assert.strictEqual(entries.length, 1000);
    assert.strictEqual(entries.at(-1).note, '999');
    assert.strictEqual(fs.readFileSync(lockFile, 'utf8'), 'held');
    assert.ok(elapsedMs >= 200, `Expected lock wait, observed ${elapsedMs}ms`);
    assert.ok(elapsedMs < 800, `Lock timeout regressed to ${elapsedMs}ms`);
  });

  it('keeps the lock timeout bounded across a wall-clock rollback', () => {
    fs.writeFileSync(lockFile, JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      createdAt: Date.now(),
      processStart: currentProcessStart(),
    }), 'utf8');
    const originalDateNow = Date.now;
    let fakeNow = originalDateNow();
    Date.now = () => {
      fakeNow -= 60_000;
      return fakeNow;
    };

    const startedAt = performance.now();
    try {
      logger.logHook('hook-logger', { status: 'ok', note: 'must-drop' });
    } finally {
      Date.now = originalDateNow;
    }
    const elapsedMs = performance.now() - startedAt;

    assert.deepStrictEqual(readEntries(), []);
    assert.ok(elapsedMs >= 200, `Expected lock wait, observed ${elapsedMs}ms`);
    assert.ok(elapsedMs < 800, `Monotonic timeout regressed to ${elapsedMs}ms`);
  });

  it('drops the write when the ticket directory cannot be inspected', () => {
    const liveTicket = JSON.stringify({
      pid: process.pid,
      createdAt: Date.now(),
    });
    fs.writeFileSync(lockFile, liveTicket, 'utf8');

    const originalOpendirSync = fs.opendirSync;
    let scans = 0;
    fs.opendirSync = function(target, ...args) {
      if (target === logDir && ++scans === 2) {
        const error = new Error('too many open files');
        error.code = 'EMFILE';
        throw error;
      }
      return originalOpendirSync.call(fs, target, ...args);
    };
    try {
      logger.logHook('hook-logger', { status: 'ok', note: 'must-drop' });
    } finally {
      fs.opendirSync = originalOpendirSync;
    }

    assert.ok(scans >= 2);
    assert.deepStrictEqual(readEntries(), []);
    assert.strictEqual(fs.readFileSync(lockFile, 'utf8'), liveTicket);
    assert.deepStrictEqual(
      fs.readdirSync(logDir).filter(name => name.startsWith('hook-log.lock.')),
      ['hook-log.lock.1'],
    );
  });

  it('bounds ticket scans across irrelevant directory entries', () => {
    for (let index = 0; index < 300; index += 1) {
      fs.writeFileSync(path.join(logDir, `irrelevant-${index}`), '', 'utf8');
    }
    const originalOpendirSync = fs.opendirSync;
    fs.opendirSync = function(target, ...args) {
      const directory = originalOpendirSync.call(fs, target, ...args);
      if (target !== logDir) return directory;
      return {
        readSync() {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
          return directory.readSync();
        },
        closeSync() {
          return directory.closeSync();
        },
      };
    };

    const startedAt = performance.now();
    try {
      logger.logHook('hook-logger', { status: 'ok', note: 'must-drop' });
    } finally {
      fs.opendirSync = originalOpendirSync;
    }
    const elapsedMs = performance.now() - startedAt;

    assert.deepStrictEqual(readEntries(), []);
    assert.ok(elapsedMs >= 200, `Expected bounded scan, observed ${elapsedMs}ms`);
    assert.ok(elapsedMs < 800, `Directory scan exceeded its budget: ${elapsedMs}ms`);
  });

  it('does not bypass a lower ticket when its metadata cannot be read', () => {
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid,
      createdAt: Date.now(),
    }), 'utf8');

    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = function(target, ...args) {
      if (target === lockFile) {
        const error = new Error('too many open files');
        error.code = 'EMFILE';
        throw error;
      }
      return originalReadFileSync.call(fs, target, ...args);
    };
    try {
      logger.logHook('hook-logger', { status: 'ok', note: 'must-drop' });
    } finally {
      fs.readFileSync = originalReadFileSync;
    }

    assert.deepStrictEqual(readEntries(), []);
    assert.deepStrictEqual(
      fs.readdirSync(logDir).filter(name => name.startsWith('hook-log.lock.')),
      ['hook-log.lock.1'],
    );
  });

  it('ignores a stale ticket with an invalid platform PID', () => {
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: Number.MAX_SAFE_INTEGER,
      createdAt: Date.now() - 60_000,
    }), 'utf8');
    const staleTime = new Date(Date.now() - 60_000);
    fs.utimesSync(lockFile, staleTime, staleTime);

    logger.logHook('hook-logger', { status: 'ok', note: 'invalid-pid-ignored' });

    assert.deepStrictEqual(
      readEntries().map(entry => entry.note),
      ['invalid-pid-ignored'],
    );
    assert.strictEqual(fs.existsSync(lockFile), true);
  });

  it('bounds a stale ticket that has no process generation identity', () => {
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid,
      createdAt: Date.now() - 60_000,
    }), 'utf8');

    logger.logHook('hook-logger', { status: 'ok', note: 'identity-less-ticket-ignored' });

    assert.deepStrictEqual(
      readEntries().map(entry => entry.note),
      ['identity-less-ticket-ignored'],
    );
    assert.strictEqual(fs.existsSync(lockFile), true);
  });

  it('does not age out an atomically published ticket while its owner is live', () => {
    fs.writeFileSync(lockFile, JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      createdAt: Date.now() - 60_000,
      processStart: currentProcessStart(),
    }), 'utf8');

    logger.logHook('hook-logger', { status: 'ok', note: 'must-drop' });

    assert.deepStrictEqual(readEntries(), []);
    assert.strictEqual(fs.existsSync(lockFile), true);
  });

  it('ignores an identity-less ticket with an implausible future timestamp', () => {
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid,
      createdAt: Number.MAX_VALUE,
    }), 'utf8');
    const staleTime = new Date(Date.now() - 60_000);
    fs.utimesSync(lockFile, staleTime, staleTime);

    logger.logHook('hook-logger', { status: 'ok', note: 'future-ticket-ignored' });

    assert.deepStrictEqual(
      readEntries().map(entry => entry.note),
      ['future-ticket-ignored'],
    );
    assert.strictEqual(fs.existsSync(lockFile), true);
  });

  it('immediately ignores a fresh ticket owned by a zombie process', {
    skip: process.platform !== 'linux',
  }, () => {
    const procPath = `/proc/${process.pid}/stat`;
    const processStat = fs.readFileSync(procPath, 'utf8');
    const commandEnd = processStat.lastIndexOf(')');
    const fields = processStat.slice(commandEnd + 1).trim().split(/\s+/);
    const processStart = fields[19];
    fields[0] = 'Z';
    const zombieStat = `${processStat.slice(0, commandEnd + 1)} ${fields.join(' ')}`;
    fs.writeFileSync(lockFile, JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      createdAt: Date.now(),
      processStart,
    }), 'utf8');

    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = function(target, ...args) {
      if (target === procPath) return zombieStat;
      return originalReadFileSync.call(fs, target, ...args);
    };
    const startedAt = performance.now();
    try {
      logger.logHook('hook-logger', { status: 'ok', note: 'zombie-ticket-ignored' });
    } finally {
      fs.readFileSync = originalReadFileSync;
    }

    assert.ok(performance.now() - startedAt < 200);
    assert.deepStrictEqual(
      readEntries().map(entry => entry.note),
      ['zombie-ticket-ignored'],
    );
    assert.strictEqual(fs.existsSync(lockFile), false);
  });

  it('does not enter the lock after process inspections exhaust the deadline', {
    skip: process.platform !== 'linux',
  }, () => {
    for (let number = 1; number <= 40; number += 1) {
      fs.writeFileSync(
        path.join(logDir, `hook-log.lock.${number}`),
        JSON.stringify({
          schemaVersion: 1,
          pid: process.pid,
          createdAt: Date.now(),
          processStart: '0',
        }),
        'utf8',
      );
    }
    const procPath = `/proc/${process.pid}/stat`;
    const originalReadFileSync = fs.readFileSync;
    let processInspections = 0;
    fs.readFileSync = function(target, ...args) {
      if (target === procPath) {
        processInspections += 1;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
      return originalReadFileSync.call(fs, target, ...args);
    };

    const startedAt = performance.now();
    try {
      logger.logHook('hook-logger', { status: 'ok', note: 'must-drop' });
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
    const elapsedMs = performance.now() - startedAt;

    assert.deepStrictEqual(readEntries(), []);
    assert.ok(processInspections < 20, `Inspected ${processInspections} processes`);
    assert.ok(elapsedMs < 800, `Process inspection exceeded deadline: ${elapsedMs}ms`);
  });

  it('prunes a proven-stopped ticket before waiting on a later live owner', () => {
    const staleTicket = path.join(logDir, 'hook-log.lock.1');
    const liveTicket = path.join(logDir, 'hook-log.lock.2');
    fs.writeFileSync(staleTicket, JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      createdAt: Date.now(),
      processStart: '0',
    }), 'utf8');
    fs.writeFileSync(liveTicket, JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      createdAt: Date.now(),
      processStart: currentProcessStart(),
    }), 'utf8');
    const originalReadFileSync = fs.readFileSync;
    let staleReads = 0;
    fs.readFileSync = function(target, ...args) {
      if (target === staleTicket) staleReads += 1;
      return originalReadFileSync.call(fs, target, ...args);
    };
    try {
      logger.logHook('hook-logger', { status: 'ok', note: 'must-drop' });
    } finally {
      fs.readFileSync = originalReadFileSync;
    }

    assert.deepStrictEqual(readEntries(), []);
    assert.strictEqual(staleReads, 1);
    assert.strictEqual(fs.existsSync(staleTicket), false);
    assert.strictEqual(fs.existsSync(liveTicket), true);
  });

  it('ignores a stale ticket whose PID belongs to another process generation', {
    skip: process.platform !== 'linux',
  }, () => {
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid,
      createdAt: Date.now() - 60_000,
      processStart: '0',
    }), 'utf8');

    logger.logHook('hook-logger', { status: 'ok', note: 'reused-pid-ignored' });

    assert.deepStrictEqual(
      readEntries().map(entry => entry.note),
      ['reused-pid-ignored'],
    );
    assert.strictEqual(fs.existsSync(lockFile), false);
  });

  it('waits for a live ticket and ignores it only after its owner exits', {
    skip: process.platform !== 'linux',
  }, async () => {
    const child = await startStaleLockOwner();
    try {
      logger.logHook('hook-logger', { status: 'ok', note: 'owner-alive' });
      assert.deepStrictEqual(readEntries(), []);

      await killPausedChild(child);
      logger.logHook('hook-logger', { status: 'ok', note: 'owner-exited' });

      assert.deepStrictEqual(
        readEntries().map(entry => entry.note),
        ['owner-exited'],
      );
      assert.strictEqual(fs.existsSync(lockFile), false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        await killPausedChild(child);
      }
    }
  });

  it('publishes complete metadata before exposing a live ticket', async () => {
    const child = await startPausedTicketPublisher(lockFile);
    try {
      const metadata = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      assert.strictEqual(metadata.schemaVersion, 1);
      assert.strictEqual(metadata.pid, child.pid);
      assert.ok(Number.isFinite(metadata.createdAt));
      assert.match(metadata.processStart, /^\d+$/);

      logger.logHook('hook-logger', { status: 'ok', note: 'must-drop' });
      assert.deepStrictEqual(readEntries(), []);
    } finally {
      await killPausedChild(child);
    }

    const claimDir = path.join(logDir, '.hook-log-claims');
    const [abandonedClaim] = fs.readdirSync(claimDir);
    assert.ok(abandonedClaim);
    const staleTime = new Date(Date.now() - 60_000);
    fs.utimesSync(
      path.join(claimDir, abandonedClaim),
      staleTime,
      staleTime,
    );

    logger.logHook('hook-logger', { status: 'ok', note: 'owner-exited' });

    assert.deepStrictEqual(
      readEntries().map(entry => entry.note),
      ['owner-exited'],
    );
    assert.strictEqual(fs.existsSync(lockFile), false);
    assert.deepStrictEqual(fs.readdirSync(claimDir), []);
  });

  it('prunes abandoned atomic tickets instead of accumulating them', () => {
    const deadOwner = spawnSync(process.execPath, ['-e', '']);
    assert.strictEqual(deadOwner.status, 0);
    assert.ok(deadOwner.pid);
    const createdAt = Date.now() - 60_000;
    for (let number = 1; number <= 64; number += 1) {
      fs.writeFileSync(
        path.join(logDir, `hook-log.lock.${number}`),
        JSON.stringify({
          schemaVersion: 1,
          pid: deadOwner.pid,
          createdAt,
          processStart: '0',
        }),
        'utf8',
      );
    }

    logger.logHook('hook-logger', { status: 'ok', note: 'after-prune' });

    assert.deepStrictEqual(
      readEntries().map(entry => entry.note),
      ['after-prune'],
    );
    assert.deepStrictEqual(
      fs.readdirSync(logDir).filter(name => /^hook-log\.lock\.\d+$/.test(name)),
      [],
    );
  });

  it('recovers stale ticket sets at and above the admission boundary', () => {
    const deadOwner = spawnSync(process.execPath, ['-e', '']);
    assert.strictEqual(deadOwner.status, 0);
    assert.ok(deadOwner.pid);
    const createdAt = Date.now() - 60_000;

    for (const count of [1_024, 1_025]) {
      for (let number = 1; number <= count; number += 1) {
        fs.writeFileSync(
          path.join(logDir, `hook-log.lock.${number}`),
          JSON.stringify({
            schemaVersion: 1,
            pid: deadOwner.pid,
            createdAt,
            processStart: '0',
          }),
          'utf8',
        );
      }

      logger.logHook('hook-logger', { status: 'ok', note: `after-${count}` });

      assert.deepStrictEqual(
        readEntries().map(entry => entry.note),
        [`after-${count}`],
      );
      assert.deepStrictEqual(
        fs.readdirSync(logDir).filter(name => /^hook-log\.lock\.\d+$/.test(name)),
        [],
      );
      fs.unlinkSync(logFile);
    }
  });

  it('uses a unique recovery path and reclaims it only after its owner exits', async () => {
    const deadOwner = spawnSync(process.execPath, ['-e', '']);
    assert.strictEqual(deadOwner.status, 0);
    assert.ok(deadOwner.pid);
    for (let number = 1; number <= 1_024; number += 1) {
      fs.writeFileSync(
        path.join(logDir, `hook-log.lock.${number}`),
        JSON.stringify({
          schemaVersion: 1,
          pid: deadOwner.pid,
          createdAt: Date.now() - 60_000,
          processStart: '0',
        }),
        'utf8',
      );
    }

    const child = await startPausedRecoveryPublisher();
    const recoveryName = fs.readdirSync(logDir)
      .find(name => name.startsWith('.hook-log-recovery.'));
    assert.ok(recoveryName);
    const recoveryPath = path.join(logDir, recoveryName);
    try {
      logger.logHook('hook-logger', { status: 'ok', note: 'must-drop' });
      assert.deepStrictEqual(readEntries(), []);
      assert.strictEqual(fs.existsSync(recoveryPath), true);
    } finally {
      await killPausedChild(child);
    }

    logger.logHook('hook-logger', { status: 'ok', note: 'owner-exited' });

    assert.deepStrictEqual(
      readEntries().map(entry => entry.note),
      ['owner-exited'],
    );
    assert.deepStrictEqual(
      fs.readdirSync(logDir).filter(name => name.startsWith('.hook-log-recovery.')),
      [],
    );
  });

  it('distinguishes process generations on macOS and Windows', () => {
    const cases = [
      {
        platform: 'darwin',
        first: 'S+ Sat Aug 15 10:00:00 2026\n',
        second: 'S+ Sat Aug 15 10:00:01 2026\n',
      },
      {
        platform: 'win32',
        first: '638908776000000000',
        second: '638908776010000000',
      },
    ];

    for (const identityCase of cases) {
      const script = `
        const assert = require('node:assert');
        const fs = require('node:fs');
        const os = require('node:os');
        const path = require('node:path');
        Object.defineProperty(process, 'platform', {
          value: ${JSON.stringify(identityCase.platform)},
        });
        const childProcess = require('node:child_process');
        const outputs = [
          ${JSON.stringify(identityCase.first)},
          ${JSON.stringify(identityCase.second)},
        ];
        let call = 0;
        let spawnOptions;
        childProcess.spawnSync = (_command, _args, options) => {
          spawnOptions = options;
          return {
            status: 0,
            stdout: outputs[Math.min(call++, outputs.length - 1)],
          };
        };
        const state = require(${JSON.stringify(STATE_PATH)});
        const expectedStart = state.readProcessStartIdentity(process.pid);
        assert.match(expectedStart, /^\\d+$/);
        if (process.platform === 'darwin') {
          assert.strictEqual(spawnOptions.env.LANG, 'C');
          assert.strictEqual(spawnOptions.env.LC_ALL, 'C');
          assert.strictEqual(spawnOptions.env.TZ, 'UTC');
        }
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-process-identity-'));
        const ticket = path.join(root, 'ticket');
        fs.writeFileSync(ticket, JSON.stringify({
          schemaVersion: 1,
          pid: process.pid,
          createdAt: Date.now(),
          processStart: expectedStart,
        }));
        const inspection = state.inspectTicket(ticket, Date.now());
        assert.deepStrictEqual(inspection, { blocks: false, prune: true });
        fs.rmSync(root, { recursive: true, force: true });
      `;
      const result = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
      });
      assert.strictEqual(result.status, 0, result.stderr);
    }
  });

  it('treats a modifier-bearing macOS zombie state as stopped', () => {
    const script = `
      const assert = require('node:assert');
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const childProcess = require('node:child_process');
      childProcess.spawnSync = () => ({
        status: 0,
        stdout: 'Z+ Sat Aug 15 10:00:00 2026\\n',
      });
      const state = require(${JSON.stringify(STATE_PATH)});
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-zombie-identity-'));
      const ticket = path.join(root, 'ticket');
      fs.writeFileSync(ticket, JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        createdAt: Date.now(),
        processStart: state.readProcessStartIdentity(process.pid),
      }));
      assert.deepStrictEqual(
        state.inspectTicket(ticket, Date.now()),
        { blocks: false, prune: true },
      );
      fs.rmSync(root, { recursive: true, force: true });
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, result.stderr);
  });

  it('fails closed when the platform cannot provide process generation identity', () => {
    const script = `
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      const { logHook } = require(${JSON.stringify(LOGGER_PATH)});
      logHook('unsupported-platform', { status: 'ok' });
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CLAUDE_HOOK_LOG_DIR_FOR_TESTS: logDir,
      },
      encoding: 'utf8',
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(readEntries(), []);
  });

  it('serializes two writers without replacing a stale ticket', async () => {
    const deadOwner = spawnSync(process.execPath, ['-e', '']);
    assert.strictEqual(deadOwner.status, 0);
    const deadPid = deadOwner.pid;
    assert.ok(deadPid);
    const staleTicket = JSON.stringify({
      pid: deadPid,
      createdAt: Date.now() - 60_000,
      marker: 'stale-test-owner',
    });
    fs.writeFileSync(lockFile, staleTicket, 'utf8');

    const releaseFile = path.join(logDir, 'release-paused-writer');
    const pausedMarker = path.join(logDir, 'first-writer-paused');
    const appendMarker = path.join(logDir, 'second-writer-entered-append');
    const blockedMarker = path.join(logDir, 'second-writer-blocked');
    const paused = startPausedRotationWriter(
      'first-writer',
      releaseFile,
      pausedMarker,
    );
    let observed;
    try {
      await paused.ready;
      assert.strictEqual(fs.existsSync(pausedMarker), true);

      observed = startObservedWriter(
        'second-writer',
        appendMarker,
        blockedMarker,
      );
      await observed.ready;
      assert.strictEqual(fs.existsSync(blockedMarker), true);
      assert.strictEqual(fs.existsSync(appendMarker), false);
    } finally {
      fs.writeFileSync(releaseFile, 'continue', 'utf8');
      const completions = [paused.completion];
      if (observed) completions.push(observed.completion);
      const results = await Promise.allSettled(completions);
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    }

    assert.strictEqual(fs.existsSync(appendMarker), true);
    assert.deepStrictEqual(
      readEntries().map(entry => entry.note).sort(),
      ['first-writer', 'second-writer'],
    );
    assert.strictEqual(fs.readFileSync(lockFile, 'utf8'), staleTicket);
    assert.deepStrictEqual(
      fs.readdirSync(logDir).filter(name => name.startsWith('hook-log.lock.')),
      ['hook-log.lock.1'],
    );
  });

  it('serializes concurrent rotation and preserves every child entry', async () => {
    const writers = 6;
    const entriesPerWriter = 20;
    seedLogEntries(950);

    await Promise.all(Array.from(
      { length: writers },
      (_, index) => runWriter(`writer-${index}`, entriesPerWriter),
    ));

    const entries = readEntries();
    const childEntries = entries.filter(entry => entry.hook === 'child-writer');
    assert.strictEqual(entries.length, 570);
    assert.strictEqual(childEntries.length, writers * entriesPerWriter);
    assert.strictEqual(
      new Set(childEntries.map(entry => entry.note)).size,
      childEntries.length,
    );
  });
});

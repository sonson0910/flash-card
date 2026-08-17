/**
 * hook-logger.cjs - Zero-dependency structured logger for hooks
 *
 * Logs to .claude/hooks/.logs/hook-log.jsonl (JSON Lines format)
 * Auto-creates .logs/ directory and handles rotation (1000 lines max → 500 last)
 * Uses only Node builtins (fs, path) — no external dependencies
 *
 * Export: logHook(hookName, data), createHookTimer(hookName, baseData), logHookCrash(hookName, error, data)
 */

const fs = require('fs');
const path = require('path');
const { withHookLogLock } = require('./hook-log-ticket-lock.cjs');

const testLogDir = process.env.NODE_ENV === 'test'
  ? process.env.CLAUDE_HOOK_LOG_DIR_FOR_TESTS
  : '';
const LOG_DIR = testLogDir
  ? path.resolve(testLogDir)
  : path.join(__dirname, '..', '.logs');
const LOG_FILE = path.join(LOG_DIR, 'hook-log.jsonl');
const MAX_LINES = 1000;
const TRUNCATE_TO = 500;
const ROTATION_TEMP_PREFIX = `${path.basename(LOG_FILE)}.rotate.`;
const MAX_ROTATION_ENTRIES_SCANNED = 64;
const MAX_ROTATION_TEMPS_REMOVED = 16;
let rotationSequence = 0;

/**
 * Ensure log directory exists
 */
function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (_) {
    // Fail silently — never crash
  }
}

function sweepRotationTemps() {
  let directory;
  try {
    directory = fs.opendirSync(LOG_DIR);
    let scanned = 0;
    let removed = 0;
    let entry;
    while (scanned < MAX_ROTATION_ENTRIES_SCANNED
      && removed < MAX_ROTATION_TEMPS_REMOVED
      && (entry = directory.readSync()) !== null) {
      scanned += 1;
      if (!entry.name.startsWith(ROTATION_TEMP_PREFIX)) continue;
      try {
        fs.unlinkSync(path.join(LOG_DIR, entry.name));
        removed += 1;
      } catch (_) {}
    }
  } catch (_) {
    // Cleanup is best effort and bounded so it cannot dominate the lock hold.
  } finally {
    try { directory?.closeSync(); } catch (_) {}
  }
}

/**
 * Rotate log file if it exceeds MAX_LINES.
 * The caller holds the ticket lock, so abandoned temp files are never active.
 */
function rotateIfNeeded() {
  let tempPath = '';
  try {
    sweepRotationTemps();
    if (!fs.existsSync(LOG_FILE)) return;
    const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
    if (lines.length < MAX_LINES) return;

    const truncated = lines.slice(-TRUNCATE_TO).join('\n') + '\n';
    tempPath = path.join(
      LOG_DIR,
      `${ROTATION_TEMP_PREFIX}${process.pid}.${process.hrtime.bigint()}.${++rotationSequence}`,
    );
    const descriptor = fs.openSync(tempPath, 'wx');
    try {
      fs.writeFileSync(descriptor, truncated, 'utf-8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(tempPath, LOG_FILE);
    tempPath = '';
  } catch (_) {
    // Fail silently
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
}

/**
 * Log a hook event
 * @param {string} hookName - Hook filename (e.g., 'scout-block')
 * @param {object} data - Log data { event?, tool?, target?, note?, dur?, status, exit?, error? }
 */
function logHook(hookName, data) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      hook: hookName,
      event: data.event || '',
      tool: data.tool || '',
      target: data.target || '',
      note: data.note || '',
      dur: data.dur || 0,
      status: data.status || 'ok',
      exit: data.exit !== undefined ? data.exit : 0,
      error: data.error || ''
    };

    const serialized = JSON.stringify(entry) + '\n';
    withHookLogLock(LOG_DIR, () => {
      fs.appendFileSync(LOG_FILE, serialized, 'utf-8');
      rotateIfNeeded();
    });
  } catch (_) {
    // Never crash — fail silently
  }
}

/**
 * Create a duration timer for a hook
 * @param {string} hookName - Hook filename
 * @param {object} [baseData] - Shared fields applied to every end() call
 * @returns {{ end: (data) => void }} Timer object with end() method
 */
function createHookTimer(hookName, baseData = {}) {
  const start = Date.now();
  let ended = false;
  return {
    end(data = {}) {
      if (ended) return;
      ended = true;
      const dur = Date.now() - start;
      logHook(hookName, { ...baseData, ...data, dur });
    }
  };
}

/**
 * Log a crash entry with normalized error handling.
 * @param {string} hookName
 * @param {unknown} error
 * @param {object} [data]
 */
function logHookCrash(hookName, error, data = {}) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error || 'unknown error');
  logHook(hookName, {
    ...data,
    status: 'crash',
    exit: data.exit !== undefined ? data.exit : 0,
    error: message
  });
}

module.exports = {
  logHook,
  createHookTimer,
  logHookCrash
};

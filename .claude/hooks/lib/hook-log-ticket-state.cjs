const fs = require('fs');
const childProcess = require('node:child_process');

const STALE_LOCK_AGE_MS = 30_000;
const MAX_CLOCK_SKEW_MS = 5_000;
const MAX_PLATFORM_PID = 0x7fffffff;
const TICKET_SCHEMA_VERSION = 1;

function readLinuxProcessIdentity(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const commandEnd = stat.lastIndexOf(')');
    if (commandEnd < 0) return null;
    const fields = stat.slice(commandEnd + 1).trim().split(/\s+/);
    const state = fields[0];
    const startTime = fields[19];
    if (!/^[A-Z]$/.test(state || '') || !/^\d+$/.test(startTime || '')) {
      return null;
    }
    return { state, startTime };
  } catch (_) {
    return null;
  }
}

function readPosixProcessIdentity(pid) {
  try {
    const result = childProcess.spawnSync(
      '/bin/ps',
      ['-o', 'state=', '-o', 'lstart=', '-p', String(pid)],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 100,
        maxBuffer: 4_096,
        env: {
          ...process.env,
          LANG: 'C',
          LC_ALL: 'C',
          TZ: 'UTC',
        },
      },
    );
    if (result.status !== 0) return null;
    const match = /^\s*(\S+)\s+(.+?)\s*$/.exec(result.stdout || '');
    if (!match) return null;
    const startedAt = Date.parse(`${match[2]} UTC`);
    if (!Number.isFinite(startedAt)) return null;
    return {
      state: match[1][0].toUpperCase(),
      startTime: String(Math.floor(startedAt / 1_000)),
    };
  } catch (_) {
    return null;
  }
}

function readWindowsProcessIdentity(pid) {
  try {
    const result = childProcess.spawnSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p=Get-Process -Id ${pid} -ErrorAction Stop; `
          + '[Console]::Write($p.StartTime.ToUniversalTime().Ticks)',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 200,
        windowsHide: true,
        maxBuffer: 4_096,
      },
    );
    const startTime = String(result.stdout || '').trim();
    if (result.status !== 0 || !/^\d+$/.test(startTime)) return null;
    return { state: 'R', startTime };
  } catch (_) {
    return null;
  }
}

function readProcessIdentity(pid) {
  if (process.platform === 'linux') return readLinuxProcessIdentity(pid);
  if (process.platform === 'darwin') return readPosixProcessIdentity(pid);
  if (process.platform === 'win32') return readWindowsProcessIdentity(pid);
  return null;
}

function readProcessStartIdentity(pid) {
  return readProcessIdentity(pid)?.startTime || '';
}

function processStatus(pid, expectedStart = '') {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > MAX_PLATFORM_PID) {
    return 'stopped';
  }
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error && ['ESRCH', 'EINVAL', 'ERR_OUT_OF_RANGE'].includes(error.code)) {
      return 'stopped';
    }
    return 'unknown';
  }

  const identity = readProcessIdentity(pid);
  if (identity && ['Z', 'X'].includes(identity.state)) return 'stopped';
  if (expectedStart && identity?.startTime !== expectedStart) {
    return identity ? 'stopped' : 'unknown';
  }
  return 'running';
}

function isRecentTimestamp(timestamp, now) {
  const age = now - timestamp;
  return age >= -MAX_CLOCK_SKEW_MS && age < STALE_LOCK_AGE_MS;
}

function isValidMetadata(metadata) {
  return metadata
    && (metadata.schemaVersion === undefined
      || metadata.schemaVersion === TICKET_SCHEMA_VERSION)
    && Number.isSafeInteger(metadata.pid)
    && metadata.pid > 0
    && metadata.pid <= MAX_PLATFORM_PID
    && Number.isFinite(metadata.createdAt)
    && (metadata.processStart === undefined
      || (typeof metadata.processStart === 'string'
        && (metadata.processStart === '' || /^\d+$/.test(metadata.processStart))))
    && (metadata.schemaVersion !== TICKET_SCHEMA_VERSION
      || /^\d+$/.test(metadata.processStart || ''));
}

function inspectTicket(ticketPath, now) {
  let stats;
  let serialized;
  try {
    stats = fs.statSync(ticketPath);
    serialized = fs.readFileSync(ticketPath, 'utf8');
  } catch (error) {
    return error?.code === 'ENOENT'
      ? { blocks: false, prune: false }
      : { blocks: true, prune: false };
  }

  try {
    const metadata = JSON.parse(serialized);
    if (!isValidMetadata(metadata)) {
      return { blocks: isRecentTimestamp(stats.mtimeMs, now), prune: false };
    }

    const recent = isRecentTimestamp(metadata.createdAt, now);
    const atomicTicket = metadata.schemaVersion === TICKET_SCHEMA_VERSION;
    if (!atomicTicket && !metadata.processStart) {
      return { blocks: recent, prune: false };
    }

    const status = processStatus(metadata.pid, metadata.processStart || '');
    return {
      blocks: status !== 'stopped',
      prune: status === 'stopped',
    };
  } catch (_) {
    return { blocks: isRecentTimestamp(stats.mtimeMs, now), prune: false };
  }
}

module.exports = {
  TICKET_SCHEMA_VERSION,
  inspectTicket,
  readProcessStartIdentity,
};

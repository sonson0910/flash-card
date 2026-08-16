const fs = require('fs');
const path = require('path');
const {
  TICKET_SCHEMA_VERSION,
  inspectTicket,
  readProcessStartIdentity,
} = require('./hook-log-ticket-state.cjs');

const LOCK_FILE_PREFIX = 'hook-log.lock.';
const LOCK_FILE_PATTERN = /^hook-log\.lock\.([1-9][0-9]*)$/;
const RECOVERY_FILE_PREFIX = '.hook-log-recovery.';
const RECOVERY_FILE_PATTERN = /^\.hook-log-recovery\.(\d+)\.([1-9][0-9]*)\.([1-9][0-9]*)$/;
const CLAIM_DIR_NAME = '.hook-log-claims';
const LOCK_TIMEOUT_MS = 250;
const LOCK_RETRY_MS = 10;
const MAX_LOCK_TICKETS = 1_024;
const MAX_DIRECTORY_ENTRIES_SCANNED = 2_048;
const MAX_ACQUISITION_DIRECTORY_ENTRIES = 4_096;
const MAX_ACQUISITION_TICKET_INSPECTIONS = 2_048;
const MAX_CLAIMS_SCANNED = 64;
const ABANDONED_CLAIM_AGE_MS = 30_000;
const MAX_CLOCK_SKEW_MS = 5_000;
let claimSequence = 0;

function monotonicNowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function sleep(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {
    const end = monotonicNowMs() + ms;
    while (monotonicNowMs() < end) {}
  }
}

function sweepAbandonedClaims(claimDir, now, deadline) {
  let directory;
  try {
    directory = fs.opendirSync(claimDir);
    let scanned = 0;
    let entry;
    while (scanned < MAX_CLAIMS_SCANNED && monotonicNowMs() < deadline
      && (entry = directory.readSync()) !== null) {
      scanned += 1;
      if (!entry.isFile()) continue;
      const claimPath = path.join(claimDir, entry.name);
      try {
        const age = now - fs.statSync(claimPath).mtimeMs;
        if (age >= ABANDONED_CLAIM_AGE_MS || age < -MAX_CLOCK_SKEW_MS) {
          fs.unlinkSync(claimPath);
        }
      } catch (_) {}
    }
  } catch (_) {
    // Claim recovery is best effort; lock acquisition still fails closed.
  } finally {
    try { directory?.closeSync(); } catch (_) {}
  }
}

function compareRecovery(left, right) {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt < right.startedAt ? -1 : 1;
  }
  if (left.pid !== right.pid) return left.pid - right.pid;
  return left.sequence - right.sequence;
}

function scanLockState(logDir, deadline, budget) {
  let directory;
  try {
    directory = fs.opendirSync(logDir);
    const tickets = [];
    const recoveries = [];
    let scanned = 0;
    let entry;
    while (monotonicNowMs() < deadline
      && scanned < MAX_DIRECTORY_ENTRIES_SCANNED) {
      if (budget.directoryEntries <= 0) return null;
      entry = directory.readSync();
      if (entry === null) break;
      budget.directoryEntries -= 1;
      scanned += 1;
      const ticketMatch = LOCK_FILE_PATTERN.exec(entry.name);
      if (ticketMatch) {
        const number = Number(ticketMatch[1]);
        if (Number.isSafeInteger(number)) {
          tickets.push({ number, path: path.join(logDir, entry.name) });
        }
        continue;
      }
      const recoveryMatch = RECOVERY_FILE_PATTERN.exec(entry.name);
      if (!recoveryMatch) continue;
      const pid = Number(recoveryMatch[2]);
      const sequence = Number(recoveryMatch[3]);
      if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(sequence)) continue;
      recoveries.push({
        startedAt: BigInt(recoveryMatch[1]),
        pid,
        sequence,
        path: path.join(logDir, entry.name),
      });
    }
    if (monotonicNowMs() >= deadline || entry !== null) return null;
    tickets.sort((left, right) => left.number - right.number);
    recoveries.sort(compareRecovery);
    return { tickets, recoveries };
  } catch (_) {
    return null;
  } finally {
    try { directory?.closeSync(); } catch (_) {}
  }
}

function createClaim(logDir, deadline) {
  const claimDir = path.join(logDir, CLAIM_DIR_NAME);
  try {
    fs.mkdirSync(claimDir, { recursive: true });
    sweepAbandonedClaims(claimDir, Date.now(), deadline);
    if (monotonicNowMs() >= deadline) return null;
    const processStart = readProcessStartIdentity(process.pid);
    if (!processStart || monotonicNowMs() >= deadline) return null;
    const metadata = JSON.stringify({
      schemaVersion: TICKET_SCHEMA_VERSION,
      pid: process.pid,
      createdAt: Date.now(),
      processStart,
    });
    const claimPath = path.join(
      claimDir,
      `${process.pid}.${process.hrtime.bigint()}.${++claimSequence}`,
    );
    fs.writeFileSync(claimPath, metadata, { encoding: 'utf8', flag: 'wx' });
    return claimPath;
  } catch (_) {
    return null;
  }
}

function inspectRecoveries(recoveries, deadline, budget, owner = null) {
  let blocked = false;
  for (const recovery of recoveries) {
    if (owner && compareRecovery(recovery, owner) >= 0) continue;
    if (monotonicNowMs() >= deadline || budget.inspections <= 0) return null;
    budget.inspections -= 1;
    const inspection = inspectTicket(recovery.path, Date.now());
    if (inspection.blocks) {
      blocked = true;
    } else {
      // Recovery paths are unique, so a stopped owner's path cannot be replaced.
      try { fs.unlinkSync(recovery.path); } catch (_) {}
    }
  }
  return blocked;
}

function inspectTickets(tickets, deadline, budget, ownerTicket = null) {
  const inspected = [];
  for (const ticket of tickets) {
    if (ownerTicket && ticket.number >= ownerTicket.number) continue;
    if (monotonicNowMs() >= deadline || budget.inspections <= 0) return null;
    budget.inspections -= 1;
    const inspection = inspectTicket(ticket.path, Date.now());
    inspected.push({ ticket, inspection });
    if (inspection.blocks) return { blocked: true, inspected };
  }
  return { blocked: false, inspected };
}

function pruneInspectedTickets(inspected, deadline, removeAllNonblocking = false) {
  for (const { ticket, inspection } of inspected) {
    if (monotonicNowMs() >= deadline) return false;
    if (inspection.prune || (removeAllNonblocking && !inspection.blocks)) {
      try { fs.unlinkSync(ticket.path); } catch (_) {}
    }
  }
  return monotonicNowMs() < deadline;
}

function recoverOverflow(logDir, claimPath, deadline, budget) {
  const startedAt = process.hrtime.bigint();
  const sequence = ++claimSequence;
  const owner = {
    startedAt,
    pid: process.pid,
    sequence,
    path: path.join(
      logDir,
      `${RECOVERY_FILE_PREFIX}${startedAt}.${process.pid}.${sequence}`,
    ),
  };
  try {
    fs.linkSync(claimPath, owner.path);
  } catch (_) {
    return false;
  }

  try {
    while (monotonicNowMs() < deadline) {
      const state = scanLockState(logDir, deadline, budget);
      if (!state) return false;
      const recoveryBlocked = inspectRecoveries(
        state.recoveries,
        deadline,
        budget,
        owner,
      );
      if (recoveryBlocked === null) return false;
      if (recoveryBlocked) {
        sleep(LOCK_RETRY_MS);
        continue;
      }
      const result = inspectTickets(state.tickets, deadline, budget);
      if (!result) return false;
      if (!pruneInspectedTickets(result.inspected, deadline, true)) return false;
      if (!result.blocked) return true;
      sleep(LOCK_RETRY_MS);
    }
    return false;
  } finally {
    // Recovery names are unique and never reused, so this cannot remove a successor.
    try { fs.unlinkSync(owner.path); } catch (_) {}
  }
}

function reserveTicket(logDir, deadline, budget) {
  const claimPath = createClaim(logDir, deadline);
  if (!claimPath) return null;
  try {
    while (monotonicNowMs() < deadline) {
      const state = scanLockState(logDir, deadline, budget);
      if (!state) return null;
      const recoveryBlocked = inspectRecoveries(
        state.recoveries,
        deadline,
        budget,
      );
      if (recoveryBlocked === null) return null;
      if (state.recoveries.length > 0 || recoveryBlocked) {
        sleep(LOCK_RETRY_MS);
        continue;
      }
      if (state.tickets.length >= MAX_LOCK_TICKETS) {
        recoverOverflow(logDir, claimPath, deadline, budget);
        continue;
      }
      const highest = state.tickets.reduce(
        (maximum, ticket) => Math.max(maximum, ticket.number),
        0,
      );
      if (highest >= Number.MAX_SAFE_INTEGER) return null;
      const ticket = {
        number: highest + 1,
        path: path.join(logDir, `${LOCK_FILE_PREFIX}${highest + 1}`),
      };
      try {
        fs.linkSync(claimPath, ticket.path);
        return ticket;
      } catch (error) {
        if (!error || error.code !== 'EEXIST') return null;
        sleep(LOCK_RETRY_MS);
      }
    }
    return null;
  } finally {
    try { fs.unlinkSync(claimPath); } catch (_) {}
  }
}

function withHookLogLock(logDir, fn) {
  const deadline = monotonicNowMs() + LOCK_TIMEOUT_MS;
  const budget = {
    directoryEntries: MAX_ACQUISITION_DIRECTORY_ENTRIES,
    inspections: MAX_ACQUISITION_TICKET_INSPECTIONS,
  };
  const ticket = reserveTicket(logDir, deadline, budget);
  if (!ticket) return null;

  try {
    while (monotonicNowMs() < deadline) {
      const state = scanLockState(logDir, deadline, budget);
      if (!state) return null;
      const recoveryBlocked = inspectRecoveries(
        state.recoveries,
        deadline,
        budget,
      );
      if (recoveryBlocked === null) return null;
      const result = inspectTickets(state.tickets, deadline, budget, ticket);
      if (!result) return null;
      if (!pruneInspectedTickets(result.inspected, deadline)) return null;
      if (!recoveryBlocked && !result.blocked) {
        if (monotonicNowMs() >= deadline) return null;
        return fn();
      }
      sleep(LOCK_RETRY_MS);
    }
    return null;
  } finally {
    try { fs.unlinkSync(ticket.path); } catch (_) {}
  }
}

module.exports = { withHookLogLock };

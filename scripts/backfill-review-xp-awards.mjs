#!/usr/bin/env node
/**
 * Backfill per-card/day review XP receipts from strict server review receipts.
 *
 * Usage:
 *   node scripts/backfill-review-xp-awards.mjs --project encoded-hangout-433912-h2 \
 *     --database ai-studio-945b4052-4462-4668-8936-277f09f07a37 \
 *     --coverage-start YYYY-MM-DD --coverage-end YYYY-MM-DD
 *
 * The command is a dry run unless --apply and
 * --confirm APPLY_REVIEW_XP_AWARDS_WITH_EXTERNAL_COVERAGE_EVIDENCE are both
 * passed. That confirmation attests that old writers and account deletion are
 * paused and receipt retention covers the cutover day; the script itself
 * cannot prove those external conditions.
 * An apply is
 * blocked when the paginated scan has malformed evidence, no declared coverage
 * window, or evidence outside that window. The operator must also stop the old
 * writer and ensure the declared window is retained before relying on this
 * report; Firestore TTL means this script cannot reconstruct deleted receipts.
 */

import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import runtimeTarget from '../functions/src/runtime-target.json' with { type: 'json' };

export const SEALED_PROJECT_ID = 'encoded-hangout-433912-h2';
export const SEALED_STAGING_PROJECT_ID = 'sonflash-staging-20260906';
export const SEALED_PROJECT_IDS = new Set([SEALED_PROJECT_ID, SEALED_STAGING_PROJECT_ID]);
export const SEALED_DATABASE_ID = runtimeTarget.firestoreDatabaseId;
export const APPLY_CONFIRMATION = 'APPLY_REVIEW_XP_AWARDS_WITH_EXTERNAL_COVERAGE_EVIDENCE';
export const DEFAULT_PAGE_SIZE = 500;
export const MAX_PAGE_SIZE = 1_000;

const CARD_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isLocalDay = value => {
  if (typeof value !== 'string' || !LOCAL_DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const assertOptions = options => {
  if (!options.project || !options.database) throw new Error('--project and --database are required.');
  if (!SEALED_PROJECT_IDS.has(options.project) || options.database !== SEALED_DATABASE_ID) throw new Error('Project and database must match a sealed Functions target.');
  if ((options.coverageStart || options.coverageEnd) && (!isLocalDay(options.coverageStart) || !isLocalDay(options.coverageEnd) || options.coverageStart > options.coverageEnd)) {
    throw new Error('Coverage must be an inclusive valid YYYY-MM-DD range.');
  }
  if (!Number.isSafeInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > MAX_PAGE_SIZE) {
    throw new Error(`--page-size must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }
  if (options.apply && options.confirm !== APPLY_CONFIRMATION) throw new Error(`--apply requires --confirm ${APPLY_CONFIRMATION}.`);
  if (options.apply && (!options.coverageStart || !options.coverageEnd)) throw new Error('--apply requires an explicit coverage range and external coverage confirmation.');
};

const assertDatabaseTarget = (database, options) => {
  if (database.projectId !== options.project || database.databaseId !== options.database) {
    throw new Error('Firestore instance does not match the sealed project and database.');
  }
};

export const reviewXpAwardId = (cardId, studyDay) => {
  if (!CARD_ID.test(cardId) || !isLocalDay(studyDay)) throw new Error('Review award identity is invalid.');
  return createHash('sha256').update(`${cardId}\u0000${studyDay}`).digest('hex');
};

const valueFor = (argv, index, flag, inlineValue) => {
  if (inlineValue !== undefined) return inlineValue;
  const next = argv[index + 1];
  if (next === undefined || next.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
  return next;
};

export function parseArgs(argv) {
  const options = { project: '', database: '', apply: false, confirm: '', pageSize: DEFAULT_PAGE_SIZE, coverageStart: '', coverageEnd: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equals = arg.indexOf('=');
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : arg.slice(equals + 1);
    const take = () => {
      const value = valueFor(argv, index, flag, inlineValue);
      if (inlineValue === undefined) index += 1;
      return value.trim();
    };
    switch (flag) {
      case '--project': options.project = take(); break;
      case '--database': options.database = take(); break;
      case '--coverage-start': options.coverageStart = take(); break;
      case '--coverage-end': options.coverageEnd = take(); break;
      case '--confirm': options.confirm = take(); break;
      case '--page-size': {
        const pageSize = Number.parseInt(take(), 10);
        if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new Error(`--page-size must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
        options.pageSize = pageSize;
        break;
      }
      case '--apply': options.apply = true; break;
      case '--help':
      case '-h': throw new Error('Usage: node scripts/backfill-review-xp-awards.mjs --project <sealed-project> --database <sealed-database> [--coverage-start YYYY-MM-DD --coverage-end YYYY-MM-DD] [--page-size n] [--apply --confirm APPLY_REVIEW_XP_AWARDS_WITH_EXTERNAL_COVERAGE_EVIDENCE]');
      default: throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  assertOptions(options);
  return options;
}

const receiptOwner = path => {
  const parts = path.split('/');
  return parts.length === 4 && parts[0] === 'users' && parts[2] === 'review_receipts' && parts[1] && !parts[1].includes('/') ? parts[1] : null;
};

const timestampDate = value => {
  const date = value instanceof Date ? value
    : isRecord(value) && typeof value.toDate === 'function' ? value.toDate()
      : isRecord(value) && typeof value.toMillis === 'function' ? new Date(value.toMillis()) : null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
};

/** Returns no personal identifiers so scan reports remain safe to share. */
export function validateReceipt(doc) {
  const ownerId = receiptOwner(doc.ref.path);
  const receipt = doc.data();
  if (!ownerId || !isRecord(receipt)) return { state: 'malformed' };
  // Legacy non-strict review rows have no server replay fingerprint and cannot
  // establish a per-card/day award. They are deliberately outside this ledger.
  if (receipt.fingerprint === undefined) return { state: 'ignored' };
  const createdAt = timestampDate(receipt.createdAt);
  const expiresAt = timestampDate(receipt.expiresAt);
  if (typeof receipt.ownerId !== 'string' || receipt.ownerId !== ownerId || !CARD_ID.test(receipt.cardId)
    || typeof receipt.opId !== 'string' || receipt.opId.length === 0 || !SHA256.test(receipt.fingerprint)
    || !createdAt || !expiresAt || expiresAt <= createdAt || !isRecord(receipt.result)
    || receipt.result.applied !== true || receipt.result.duplicate !== false) return { state: 'malformed' };
  const explicitXp = receipt.result.xpAwarded;
  if (explicitXp !== undefined && explicitXp !== 0 && explicitXp !== 2) return { state: 'malformed' };
  if (explicitXp === 0) return { state: 'ignored' };
  const gamification = receipt.result.gamification;
  // Old strict receipts predate explicit result.xpAwarded. Their gamification
  // result is the authoritative record of the then-unconditional two XP.
  if (explicitXp === undefined && gamification === undefined) return { state: 'ignored' };
  if (!isRecord(gamification) || !isLocalDay(gamification.studyDay)) return { state: 'malformed' };
  return {
    state: 'eligible', ownerId, cardId: receipt.cardId, studyDay: gamification.studyDay,
    awardedAt: createdAt, receiptRef: doc.ref,
  };
}

const validAward = (data, candidate) => isRecord(data)
  && data.schemaVersion === 1
  && data.ownerId === candidate.ownerId
  && data.cardId === candidate.cardId
  && data.studyDay === candidate.studyDay
  && data.xpAwarded === 2
  && timestampDate(data.expiresAt) !== null;

const awardPath = candidate => `users/${candidate.ownerId}/review_xp_awards/${reviewXpAwardId(candidate.cardId, candidate.studyDay)}`;

const coverage = (options, candidates, malformed) => {
  const base = {
    coverageUnproven: true,
    warning: 'This scan cannot prove old writers were drained or that Firestore retained every cutover receipt; it does not authorize release.',
  };
  if (!options.coverageStart || !options.coverageEnd) return { ...base, applyEligible: false, reason: 'Coverage range was not declared.' };
  if (malformed > 0) return { ...base, applyEligible: false, reason: 'Malformed or ambiguous receipt rows were found.' };
  if (candidates.length === 0) return { ...base, applyEligible: false, reason: 'No strict XP award evidence was found in the declared coverage range.' };
  if (candidates.some(row => row.studyDay < options.coverageStart || row.studyDay > options.coverageEnd)) {
    return { ...base, applyEligible: false, reason: 'Strict XP evidence falls outside the declared coverage range.' };
  }
  return { ...base, applyEligible: true, externalEvidenceConfirmed: options.apply };
};

async function resolveExisting(database, candidates) {
  const missing = [];
  let existing = 0;
  let conflicts = 0;
  for (const candidate of candidates) {
    const ref = database.doc(awardPath(candidate));
    // eslint-disable-next-line no-await-in-loop
    const snapshot = await ref.get();
    if (!snapshot.exists) missing.push({ ...candidate, ref });
    else if (validAward(snapshot.data(), candidate)) existing += 1;
    else conflicts += 1;
  }
  return { missing, existing, conflicts };
}

export async function createIfMissing(database, candidate) {
  return database.runTransaction(async transaction => {
    const receipt = await transaction.get(candidate.receiptRef);
    const current = receipt.exists ? validateReceipt(receipt) : null;
    if (current?.state !== 'eligible' || current.ownerId !== candidate.ownerId
      || current.cardId !== candidate.cardId || current.studyDay !== candidate.studyDay
      || current.awardedAt.getTime() !== candidate.awardedAt.getTime()) return 'conflict';
    const deletion = await transaction.get(database.collection('account_tombstones')
      .where('uid', '==', candidate.ownerId).limit(1));
    if (!deletion.empty) return 'conflict';
    const snapshot = await transaction.get(candidate.ref);
    if (!snapshot.exists) {
      transaction.create(candidate.ref, {
        schemaVersion: 1,
        ownerId: candidate.ownerId,
        cardId: candidate.cardId,
        studyDay: candidate.studyDay,
        xpAwarded: 2,
        awardedAt: candidate.awardedAt,
        // Mirrors the server's finite receipt window without touching XP totals.
        expiresAt: new Date(candidate.awardedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
      return 'created';
    }
    return validAward(snapshot.data(), candidate) ? 'existing' : 'conflict';
  });
}

export async function runBackfill(database, options) {
  assertOptions(options);
  assertDatabaseTarget(database, options);
  let cursor = null;
  let scanned = 0;
  let eligibleRows = 0;
  let malformed = 0;
  let duplicateReceipts = 0;
  const byCardDay = new Map();
  for (;;) {
    let query = database.collectionGroup('review_receipts').orderBy('__name__').limit(options.pageSize);
    if (cursor) query = query.startAfter(cursor);
    // eslint-disable-next-line no-await-in-loop
    const page = await query.get();
    if (page.empty) break;
    scanned += page.docs.length;
    for (const doc of page.docs) {
      const receipt = validateReceipt(doc);
      if (receipt.state === 'malformed') malformed += 1;
      if (receipt.state === 'eligible') {
        eligibleRows += 1;
        const key = `${receipt.ownerId}\u0000${receipt.cardId}\u0000${receipt.studyDay}`;
        if (byCardDay.has(key)) duplicateReceipts += 1;
        else byCardDay.set(key, receipt);
      }
    }
    cursor = page.docs.at(-1);
    if (page.docs.length < options.pageSize) break;
  }
  const candidates = [...byCardDay.values()];
  const coverageResult = coverage(options, candidates, malformed);
  const preflight = await resolveExisting(database, candidates);
  const blocked = !coverageResult.applyEligible || preflight.conflicts > 0;
  let created = 0;
  let existing = preflight.existing;
  let conflicts = preflight.conflicts;
  if (options.apply && !blocked) {
    for (const candidate of preflight.missing) {
      // eslint-disable-next-line no-await-in-loop
      const result = await createIfMissing(database, candidate);
      if (result === 'created') created += 1;
      else if (result === 'existing') existing += 1;
      else conflicts += 1;
    }
  }
  return {
    mode: options.apply ? 'apply' : 'dry-run',
    scanned,
    eligible: eligibleRows,
    uniqueEligible: candidates.length,
    duplicateReceipts,
    malformed,
    preflightMissing: preflight.missing.length,
    existing,
    created,
    conflicts,
    blocked: blocked || conflicts > 0,
    coverage: coverageResult,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const app = initializeApp({ projectId: options.project }, `review-xp-backfill-${randomUUID()}`);
  try {
    const database = getFirestore(app, options.database);
    try {
      const report = await runBackfill(database, options);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (options.apply && report.blocked) process.exitCode = 2;
    } finally {
      await database.terminate();
    }
  } finally {
    await deleteApp(app);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Review XP award backfill failed.');
    process.exitCode = 1;
  });
}

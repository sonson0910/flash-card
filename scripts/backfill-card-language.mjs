#!/usr/bin/env node
/**
 * One-time admin script: backfill the `language` field on legacy card
 * documents that predate the explicit target-language write.
 *
 * Card creation now always writes an explicit `language` (see
 * `prepareTargetAwareCardForCreate` in src/lib/cardRepository.ts and
 * `canonicalCard` in functions/src/cardPersistence.ts) so course-scoped
 * queries can filter `users/{uid}/cards` by `language` directly instead of
 * relying on "missing field means en". This script repairs the pre-existing
 * documents written before that change.
 *
 * Usage:
 *   node scripts/backfill-card-language.mjs --project <firebase-project-id> [options]
 *
 * Required:
 *   --project <id>       Firebase project id. There is no default; the
 *                         script refuses to run without one so it can never
 *                         accidentally touch whichever project ambient
 *                         credentials happen to point at.
 *
 * Options:
 *   --apply               Actually write. Without this flag the script is a
 *                         dry run: it scans and reports, and writes nothing.
 *   --database <id>       Firestore database id. Defaults to the project's
 *                         single named database, ai-studio-945b4052-4462-
 *                         4668-8936-277f09f07a37 (see functions/src/
 *                         runtime-target.json), which both production and
 *                         staging use today.
 *   --page-size <n>       Documents scanned per page. Default 500, max 1000.
 *   --resume               Continue from the last checkpoint written by a
 *                         prior --apply run, instead of scanning from the
 *                         start of the collection group.
 *   --backup-dir <path>   Directory for pre-write JSON backups and the
 *                         checkpoint file. Default artifacts/backfill-card-
 *                         language/.
 *
 * Safety properties:
 *   - Dry run by default; --apply is required to write anything.
 *   - Before every batch commit, the full pre-write data of every document
 *     about to change is written to a timestamped JSON backup file.
 *   - Processes the users/*\/cards collection group in bounded pages ordered
 *     by document path (Firestore's native document-id ordering, so it
 *     needs no extra index) and checkpoints after every page for resumable
 *     interrupted runs.
 *   - Only ever writes documents where `language` is absent, and only ever
 *     sets it to 'en'. Re-running the script at any point, from scratch or
 *     resumed, is a safe no-op once every legacy document has been backfilled.
 */

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 1_000;
const MAX_WRITES_PER_BATCH = 400;
const DEFAULT_BACKUP_DIR = path.join('artifacts', 'backfill-card-language');

function printUsageAndExit(message) {
  if (message) console.error(message);
  console.error(
    'Usage: node scripts/backfill-card-language.mjs --project <firebase-project-id> [--apply] '
    + '[--database <id>] [--page-size <n>] [--resume] [--backup-dir <path>]',
  );
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    project: undefined,
    apply: false,
    database: DEFAULT_DATABASE_ID,
    pageSize: DEFAULT_PAGE_SIZE,
    resume: false,
    backupDir: DEFAULT_BACKUP_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const takeValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        printUsageAndExit(`Missing value for ${flag}.`);
      }
      index += 1;
      return next;
    };
    switch (flag) {
      case '--project':
        options.project = takeValue().trim();
        break;
      case '--database':
        options.database = takeValue().trim();
        break;
      case '--page-size': {
        const value = Number.parseInt(takeValue(), 10);
        if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_PAGE_SIZE) {
          printUsageAndExit(`--page-size must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
        }
        options.pageSize = value;
        break;
      }
      case '--backup-dir':
        options.backupDir = takeValue().trim();
        break;
      case '--apply':
        options.apply = true;
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--help':
      case '-h':
        printUsageAndExit();
        break;
      default:
        printUsageAndExit(`Unrecognized argument: ${arg}`);
    }
  }
  if (!options.project) {
    printUsageAndExit('--project is required. Refusing to run against an implicit default project.');
  }
  return options;
}

const checkpointPath = backupDir => path.join(backupDir, 'checkpoint.json');

async function readCheckpoint(backupDir) {
  try {
    const raw = await readFile(checkpointPath(backupDir), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeCheckpoint(backupDir, checkpoint) {
  await mkdir(backupDir, { recursive: true });
  await writeFile(checkpointPath(backupDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

async function writeBackup(backupDir, runId, pageIndex, docs) {
  await mkdir(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `backup-${runId}-page-${String(pageIndex).padStart(5, '0')}.json`);
  const payload = docs.map(doc => ({ path: doc.ref.path, data: doc.data() }));
  // A JSON backup of every document's pre-write data is durable on disk
  // before the batch that overwrites it commits, so an operator can restore
  // any card exactly as it stood before this script ran.
  await writeFile(backupFile, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
  return backupFile;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const app = getApps()[0] ?? initializeApp({ projectId: options.project });
  const database = getFirestore(app, options.database);

  const resumeCheckpoint = options.resume ? await readCheckpoint(options.backupDir) : null;
  if (options.resume && !resumeCheckpoint) {
    console.error('--resume was passed but no checkpoint file exists yet; starting from the beginning.');
  }

  let scanned = 0;
  let missingLanguage = 0;
  let updated = 0;
  let pageIndex = 0;
  const backupFiles = [];
  let cursor = resumeCheckpoint?.lastDocPath
    ? await database.doc(resumeCheckpoint.lastDocPath).get()
    : null;

  try {
    for (;;) {
      let query = database.collectionGroup('cards')
        .orderBy('__name__')
        .limit(options.pageSize);
      if (cursor) query = query.startAfter(cursor);

      // eslint-disable-next-line no-await-in-loop
      const snapshot = await query.get();
      if (snapshot.empty) break;

      const pageDocsMissingLanguage = snapshot.docs.filter(doc => doc.data().language === undefined);
      scanned += snapshot.docs.length;
      missingLanguage += pageDocsMissingLanguage.length;

      if (pageDocsMissingLanguage.length > 0 && options.apply) {
        const backupFile = await writeBackup(options.backupDir, runId, pageIndex, pageDocsMissingLanguage);
        backupFiles.push(backupFile);

        for (let offset = 0; offset < pageDocsMissingLanguage.length; offset += MAX_WRITES_PER_BATCH) {
          const chunk = pageDocsMissingLanguage.slice(offset, offset + MAX_WRITES_PER_BATCH);
          const batch = database.batch();
          for (const doc of chunk) batch.update(doc.ref, { language: 'en' });
          // eslint-disable-next-line no-await-in-loop
          await batch.commit();
          updated += chunk.length;
        }
      }

      cursor = snapshot.docs[snapshot.docs.length - 1];
      pageIndex += 1;

      if (options.apply) {
        // eslint-disable-next-line no-await-in-loop
        await writeCheckpoint(options.backupDir, {
          lastDocPath: cursor.ref.path,
          scanned,
          missingLanguage,
          updated,
          updatedAt: new Date().toISOString(),
          complete: false,
        });
      }

      if (snapshot.docs.length < options.pageSize) break;
    }

    if (options.apply) {
      await writeCheckpoint(options.backupDir, {
        lastDocPath: cursor?.ref.path ?? null,
        scanned,
        missingLanguage,
        updated,
        updatedAt: new Date().toISOString(),
        complete: true,
      });
    }

    const summary = {
      mode: options.apply ? 'apply' : 'dry-run',
      project: options.project,
      database: options.database,
      scanned,
      missingLanguage,
      updated: options.apply ? updated : 0,
      wouldUpdate: options.apply ? 0 : missingLanguage,
      backupFiles,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    const terminationDeadline = new Promise(resolve => {
      const timer = setTimeout(resolve, 5_000);
      timer.unref();
    });
    await Promise.race([database.terminate(), terminationDeadline]);
  }
}

void main().then(
  () => process.exit(0),
  error => {
    console.error(error instanceof Error ? error.message : 'Card language backfill failed.');
    process.exit(1);
  },
);

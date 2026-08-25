import type { FirebaseApp } from 'firebase/app';
import { protectedFunctionsCapability } from '../../lib/firebase';
import { runProtectedFunction } from '../../lib/protectedFunctionsCapability';

const REGION = 'asia-southeast1';
const BATCH_SIZE = 100;
const MAX_BATCHES_PER_ACTION = 20;

type CallableMigrationResult = {
  migrated: number;
  merged: number;
  scanned: number;
  complete: boolean;
  remaining: number;
  invalid: number;
  phase?: 'discover' | 'discovered' | 'blocked' | 'verify';
};

type LegacyMigrationResult = {
  migrated: number;
  scanned: number;
  complete: boolean;
};

const isSafeCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const parseMigrationResult = (value: unknown): CallableMigrationResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Library migration service returned an invalid response.');
  }
  const result = value as Record<string, unknown>;
  if (
    !isSafeCount(result.migrated)
    || !isSafeCount(result.merged)
    || !isSafeCount(result.scanned)
    || typeof result.complete !== 'boolean'
    || !isSafeCount(result.remaining)
    || !isSafeCount(result.invalid)
    || (result.phase !== undefined
      && !['discover', 'discovered', 'blocked', 'verify'].includes(String(result.phase)))
  ) {
    throw new Error('Library migration service returned an invalid response.');
  }
  return result as CallableMigrationResult;
};

const invokeMigrationBatch = async (app: FirebaseApp): Promise<CallableMigrationResult> => {
  const data = await runProtectedFunction(
    protectedFunctionsCapability,
    'Library upgrade',
    async () => {
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const callable = httpsCallable<
        { batchSize: number; dryRun: boolean },
        unknown
      >(getFunctions(app, REGION), 'migrateLegacyLibrary');
      const response = await callable({ batchSize: BATCH_SIZE, dryRun: false });
      return response.data;
    },
  );
  return parseMigrationResult(data);
};

export async function migrateLegacyLibraryWithAdmin(
  app: FirebaseApp,
): Promise<LegacyMigrationResult> {
  let migrated = 0;
  let scanned = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_ACTION; batch += 1) {
    const result = await invokeMigrationBatch(app);
    if (result.invalid > 0) {
      throw new Error('Library migration found a malformed card that needs administrator review.');
    }
    if (result.complete) return { migrated, scanned, complete: true };
    const nextMigrated = migrated + result.migrated;
    const nextScanned = scanned + result.scanned;
    if (result.phase === 'discovered' || result.phase === 'verify') {
      return { migrated: nextMigrated, scanned: nextScanned, complete: false };
    }
    // Discovery/verification deliberately reports migrated=0 until Task7's
    // server-side apply phase. A scanned page is still trusted progress.
    if (result.scanned === 0 && !result.complete) {
      throw new Error('Library migration did not make progress.');
    }
    migrated = nextMigrated;
    scanned = nextScanned;
  }
  throw new Error('Library migration needs more bounded batches than one action allows.');
}

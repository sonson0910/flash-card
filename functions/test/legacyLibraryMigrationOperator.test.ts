import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LegacyLibraryDiscoveryCommit,
  LegacyLibraryDiscoveryJob,
} from '../src/legacyLibraryMigration.js';
import runtimeTarget from '../src/runtime-target.json';

// The operator script runs on import. The Admin SDK and the Firestore store are
// replaced by in-memory fakes; discovery itself runs the real code.
const state = vi.hoisted(() => ({
  ownerIds: [] as string[],
  jobs: new Map<string, Record<string, unknown>>(),
  fencedOwnerIds: new Set<string>(),
  repairedOwnerIds: [] as string[],
  manifestOwnerIds: [] as string[],
  restartedOwnerIds: [] as string[],
}));

vi.mock('../src/catalogProgressPersistence.js', () => ({
  repairCatalogProgressForOwner: async (_database: unknown, ownerId: string) => {
    if (state.fencedOwnerIds.has(ownerId)) {
      // Imported on use, so the error comes from the module instance the operator loaded.
      const { LegacyLibraryMigrationFenceError } = await import('../src/legacyLibraryMigrationOwnerScope.js');
      throw new LegacyLibraryMigrationFenceError();
    }
    state.repairedOwnerIds.push(ownerId);
    return { scanned: 4, repaired: 2 };
  },
}));

vi.mock('firebase-admin/app', () => ({
  getApps: () => [{}],
  initializeApp: () => ({}),
}));

vi.mock('firebase-admin/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase-admin/firestore')>(),
  getFirestore: () => ({
    collection: () => ({
      doc: (ownerId: string) => ({
        collection: () => ({
          doc: () => ({
            get: async () => {
              const job = state.jobs.get(ownerId);
              return { exists: Boolean(job), data: () => job };
            },
          }),
        }),
      }),
    }),
    terminate: async () => undefined,
  }),
}));

vi.mock('../src/legacyLibraryMigrationFirestore.js', () => ({
  listLibraryOwnerIds: async () => [...state.ownerIds],
  listMigrationManifestOwnerIds: async () => [...state.manifestOwnerIds],
  restartBlockedLegacyLibraryDiscovery: async (_database: unknown, ownerId: string, jobId: string) => {
    state.restartedOwnerIds.push(`${ownerId}/${jobId}`);
  },
  applyLegacyLibraryMigration: async () => { throw new Error('dry-run must not apply'); },
  rollbackLegacyLibraryMigration: async () => { throw new Error('dry-run must not roll back'); },
  createFirestoreLegacyLibraryDiscoveryStore: () => ({
    acquireDiscoveryLease: async (ownerId: string, request: { scanId: string; leaseOwner: string }) => {
      if (!state.jobs.has(ownerId)) {
        state.jobs.set(ownerId, {
          schemaVersion: 3, scanId: request.scanId, phase: 'discover', cursor: null,
          libraryEpoch: null, sourceRevision: '', scanned: 0, sourceCount: 0, groupCount: 0,
          lastPageDigest: null, leaseOwner: request.leaseOwner, leaseExpiresAt: Date.now() + 180_000,
        });
      }
      return state.jobs.get(ownerId);
    },
    readPage: async () => ({
      documents: [{ id: 'card-1', data: { word: 'Fresh', translation: 'mới' } }],
      cursor: 'card-1',
      terminal: true,
      libraryEpoch: 1,
    }),
    readDiscoveryGroups: async () => [],
    commitDiscoveryPage: async (ownerId: string, request: LegacyLibraryDiscoveryCommit) => {
      state.jobs.set(ownerId, { ...request.nextJob });
      return request.nextJob;
    },
  }),
}));

const terminalJob = (
  phase: LegacyLibraryDiscoveryJob['phase'],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  schemaVersion: 3, scanId: '00000000-0000-4000-8000-000000000000', phase, cursor: 'card-9',
  libraryEpoch: 1, sourceRevision: 'e'.repeat(64), scanned: 9, sourceCount: 9, groupCount: 7,
  lastPageDigest: 'd'.repeat(64), leaseOwner: null, leaseExpiresAt: null, ...extra,
});

const runOperator = async (mode: string, confirmation?: string) => {
  vi.resetModules();
  process.env.MIGRATION_MODE = mode;
  if (confirmation) process.env.MIGRATION_CONFIRMATION = confirmation;
  else delete process.env.MIGRATION_CONFIRMATION;
  process.env.FIREBASE_PROJECT_ID = 'encoded-hangout-433912-h2';
  process.env.FIRESTORE_DATABASE_ID = runtimeTarget.firestoreDatabaseId;
  delete process.env.MIGRATION_REPORT_FILE;
  const exitCodes: number[] = [];
  const errors: string[] = [];
  let stdout = '';
  let finish: () => void = () => undefined;
  const exited = new Promise<void>(resolve => { finish = resolve; });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    finish();
    return undefined as never;
  }) as typeof process.exit);
  vi.spyOn(console, 'error').mockImplementation((message: unknown) => { errors.push(String(message)); });
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  await import('../src/legacyLibraryMigrationOperator.js');
  await exited;
  vi.restoreAllMocks();
  return { exitCodes, errors, report: stdout ? JSON.parse(stdout) as { reports: Array<Record<string, unknown>> } : null };
};
const runDryRun = () => runOperator('dry-run');

describe('legacy library operator dry-run', () => {
  beforeEach(() => {
    state.ownerIds = ['owner-a', 'owner-b'];
    state.jobs.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MIGRATION_MODE;
  });

  it.each([
    ['complete', {}, 'e'.repeat(64)],
    ['rolled-back', {}, null],
    ['blocked', { blockedReason: 'library-epoch-changed', sourceRevision: '' }, null],
  ] as const)('reports every owner when another owner\'s job is %s', async (phase, extra, revision) => {
    state.jobs.set('owner-a', terminalJob(phase, extra));

    const { exitCodes, errors, report } = await runDryRun();

    expect(errors).toEqual([]);
    expect(exitCodes).toEqual([0]);
    expect(report?.reports).toHaveLength(2);
    const [finished, fresh] = report?.reports ?? [];
    expect(finished).toMatchObject({ phase, sourceRevision: revision, complete: phase === 'complete' });
    expect(finished.blockedReason).toBe(phase === 'blocked' ? 'library-epoch-changed' : undefined);
    expect(fresh).toMatchObject({ phase: 'discovered', complete: false });
    expect(fresh.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toContain('owner-');
  });
});

describe('legacy library operator catalog progress repair', () => {
  beforeEach(() => {
    state.ownerIds = ['owner-a', 'owner-b'];
    state.jobs.clear();
    state.fencedOwnerIds = new Set(['owner-b']);
    state.repairedOwnerIds = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MIGRATION_MODE;
    delete process.env.MIGRATION_CONFIRMATION;
  });

  it('repairs every owner and reports an owner under a migration fence as left for a later run', async () => {
    const { exitCodes, errors, report } = await runOperator('catalog-progress', 'REPAIR_CATALOG_PROGRESS');

    expect(errors).toEqual([]);
    expect(exitCodes).toEqual([0]);
    expect(state.repairedOwnerIds).toEqual(['owner-a']);
    expect(report?.reports).toEqual([
      expect.objectContaining({ mode: 'catalog-progress', scanned: 4, repaired: 2 }),
      expect.objectContaining({ mode: 'catalog-progress', skipped: 'migration-fence' }),
    ]);
    expect(JSON.stringify(report)).not.toContain('owner-');
  });

  it('refuses to run without its confirmation', async () => {
    await expect(runOperator('catalog-progress')).rejects
      .toThrow('Catalog progress repair requires MIGRATION_CONFIRMATION=REPAIR_CATALOG_PROGRESS.');
    expect(state.repairedOwnerIds).toEqual([]);
  });
});

describe('legacy library operator restart of a blocked job', () => {
  beforeEach(async () => {
    const { createMigrationOwnerKey } = await import('../src/legacyLibraryMigrationOwnerScope.js');
    state.manifestOwnerIds = ['owner-a', 'owner-b'];
    state.restartedOwnerIds = [];
    process.env.MIGRATION_OWNER_KEY = createMigrationOwnerKey('owner-b');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MIGRATION_MODE;
    delete process.env.MIGRATION_CONFIRMATION;
    delete process.env.MIGRATION_OWNER_KEY;
  });

  it('restarts the one owner the key names, without a source revision', async () => {
    const { exitCodes, errors, report } = await runOperator('restart', 'RESTART_QUERY_V3');

    expect(errors).toEqual([]);
    expect(exitCodes).toEqual([0]);
    expect(state.restartedOwnerIds).toEqual(['owner-b/query-v3']);
    expect(report?.reports).toEqual([expect.objectContaining({ mode: 'restart', phase: 'discover' })]);
    expect(JSON.stringify(report)).not.toContain('owner-');
  });

  it('refuses to run without its confirmation', async () => {
    await expect(runOperator('restart')).rejects
      .toThrow('Restart requires MIGRATION_CONFIRMATION=RESTART_QUERY_V3.');
    expect(state.restartedOwnerIds).toEqual([]);
  });
});

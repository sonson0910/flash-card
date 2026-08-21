import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import viteConfig from './vite.config';
import {
  filterAcknowledgedLocalPending,
  hasDeviceAckOwnerConflict,
  hasDeviceWriteOwnerConflict,
  mergeLocalPendingOperations,
  normalizeLocalDeviceBackup,
  readJsonFileWithMigration,
  withLocalDeviceBackupLock,
  writeJsonFileAtomically,
  sharedDeviceStorePlugin,
} from './dev/sharedDeviceStoreAdapter';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
};

type DeviceMutationRequest = {
  route: string;
  method: 'POST' | 'PUT';
  payload: unknown;
};

type UserScopedMutation = {
  label: string;
  create: (backup: any) => DeviceMutationRequest;
};

const configureDeviceRoutes = (directory: string) => {
  const backupFile = path.join(directory, '.lingoflash-device-sync', 'lingoflash-2-cards.json');
  const plugin = sharedDeviceStorePlugin(async idToken => idToken || null);
  const routes = new Map<string, (request: any, response: any) => Promise<void>>();
  if (typeof plugin.configureServer !== 'function') throw new Error('Shared Device Store server hook is unavailable.');
  plugin.configureServer({
    middlewares: {
      use(route: string, handler: (request: any, response: any) => Promise<void>) {
        routes.set(route, handler);
      },
    },
  } as never);
  return { backupFile, routes };
};

const invokeDeviceMutation = async (
  routes: Map<string, (request: any, response: any) => Promise<void>>,
  mutation: DeviceMutationRequest,
) => {
  const request = Readable.from([JSON.stringify(mutation.payload)]) as any;
  request.method = mutation.method;
  request.headers = {
    host: '127.0.0.1:3000',
    origin: 'http://127.0.0.1:3000',
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    authorization: `Bearer ${String((mutation.payload as { userId?: unknown; ownerUserId?: unknown }).userId
      ?? (mutation.payload as { ownerUserId?: unknown }).ownerUserId ?? '')}`,
  };
  request.socket = { remoteAddress: '127.0.0.1' };
  let responseBody = '';
  const response = {
    statusCode: 0,
    setHeader: vi.fn(),
    end(body: string) {
      responseBody = body;
    },
  };

  await routes.get(mutation.route)!(request, response);
  return { statusCode: response.statusCode, body: JSON.parse(responseBody) };
};

const unknownOwnerBackups = [
  {
    label: 'cards',
    backup: {
      cards: [{ id: 'unknown-card', word: 'Private', libraryEpoch: 1, revision: 1 }],
      total: 0,
      pending: [],
    },
  },
  {
    label: 'legacy items',
    backup: {
      items: [{ id: 'unknown-card', word: 'Private', libraryEpoch: 1, revision: 1 }],
      total: 0,
      pending: [],
    },
  },
  {
    label: 'ownerless pending operations',
    backup: {
      cards: [],
      total: 0,
      pending: [{
        type: 'delete',
        cardId: 'unknown-card',
        opId: 'unknown-delete',
        updatedAt: '2026-08-10T00:00:00.000Z',
      }],
    },
  },
  {
    label: 'a positive total',
    backup: {
      cards: [],
      total: 3,
      pending: [],
    },
  },
] as const;

const adoptableBackups = [
  {
    label: 'an explicit guest backup with meaningful cards',
    backup: {
      ownerUserId: null,
      cards: [{ id: 'unknown-card', word: 'Guest', libraryEpoch: 1, revision: 1 }],
      total: 1,
      pending: [],
    },
    ownerWithoutAdoption: null,
  },
  {
    label: 'an empty owner-unknown object',
    backup: {},
    ownerWithoutAdoption: undefined,
  },
  {
    label: 'an owner-unknown backup containing only empty collections and a zero total',
    backup: { cards: [], items: [], pending: [], total: 0 },
    ownerWithoutAdoption: undefined,
  },
] as const;

const malformedTopLevelBackups = [
  {
    label: 'a non-empty top-level array',
    backup: [{ id: 'raw-legacy-card', word: 'Private' }],
  },
  {
    label: 'an empty top-level array',
    backup: [],
  },
  {
    label: 'top-level null',
    backup: null,
  },
  {
    label: 'a top-level primitive string',
    backup: 'corrupt-device-backup',
  },
] as const;

const userScopedMutations: readonly UserScopedMutation[] = [
  {
    label: 'sync POST',
    create: (): DeviceMutationRequest => ({
      route: '/api/device-cards/sync',
      method: 'POST',
      payload: { userId: 'user-a', expectedTotal: 1 },
    }),
  },
  {
    label: 'sync PUT',
    create: (): DeviceMutationRequest => ({
      route: '/api/device-cards/sync',
      method: 'PUT',
      payload: { userId: 'user-a', expectedTotal: 1, status: 'complete' },
    }),
  },
  {
    label: 'cleanup',
    create: (): DeviceMutationRequest => ({
      route: '/api/device-cards/cleanup',
      method: 'PUT',
      payload: {
        userId: 'user-a',
        cardId: 'unknown-card',
        maximum: { libraryEpoch: 1, revision: 1 },
      },
    }),
  },
  {
    label: 'ACK',
    create: (backup: any): DeviceMutationRequest => {
      const existingOperation = Array.isArray(backup?.pending) ? backup.pending[0] : null;
      return {
        route: '/api/device-cards/ack',
        method: 'PUT',
        payload: {
          userId: 'user-a',
          operations: [{
            ...(existingOperation ?? {
              type: 'delete',
              cardId: 'unknown-card',
              opId: 'ack-probe',
              updatedAt: '2026-08-10T00:00:00.000Z',
            }),
            ownerUserId: 'user-a',
          }],
        },
      };
    },
  },
  {
    label: 'cards PUT',
    create: (): DeviceMutationRequest => ({
      route: '/api/device-cards',
      method: 'PUT',
      payload: {
        ownerUserId: 'user-a',
        cards: [{ id: 'replacement-card', word: 'Replacement' }],
        total: 1,
        mode: 'replace',
      },
    }),
  },
];

describe('local device backup reconciliation', () => {
  it('does not rematerialize a queued word-duplicate after authoritative reconciliation', () => {
    const authoritative = {
      id: 'authoritative-id',
      word: 'Shared Word',
      normalizedWord: 'shared word',
      translation: 'cloud',
      libraryEpoch: 2,
      revision: 1,
      createdAt: '2026-08-09T00:00:00.000Z',
    };
    const candidate = {
      ...authoritative,
      id: 'candidate-id',
      translation: 'queued',
      revision: 9,
    };

    expect(normalizeLocalDeviceBackup({
      cards: [authoritative],
      pending: [{
        type: 'upsert',
        card: candidate,
        libraryEpoch: 2,
        baseRevision: 9,
        updatedAt: '2026-08-09T00:00:01.000Z',
      }],
    }, [authoritative]).cards).toEqual([authoritative]);
  });

  it('does not apply older pending operations over a newer same-id backup card', () => {
    const newer = {
      id: 'same-id',
      word: 'Current',
      normalizedWord: 'current',
      translation: 'newer',
      bookmarked: false,
      libraryEpoch: 3,
      revision: 1,
    };

    expect(normalizeLocalDeviceBackup({
      cards: [newer],
      pending: [
        {
          type: 'upsert',
          card: { ...newer, translation: 'older', libraryEpoch: 2, revision: 99 },
          libraryEpoch: 2,
          baseRevision: 99,
          updatedAt: '2026-08-09T00:00:01.000Z',
        },
        {
          type: 'patch',
          cardId: newer.id,
          fields: { bookmarked: true },
          libraryEpoch: 2,
          baseRevision: 99,
          updatedAt: '2026-08-09T00:00:02.000Z',
        },
        {
          type: 'delete',
          cardId: newer.id,
          libraryEpoch: 2,
          baseRevision: 99,
          updatedAt: '2026-08-09T00:00:03.000Z',
        },
      ],
    }).cards).toEqual([newer]);
  });

  it('rejects every unscoped or mismatched write into an owner-scoped backup', () => {
    expect(hasDeviceWriteOwnerConflict('user-b', true, 'user-a')).toBe(true);
    expect(hasDeviceWriteOwnerConflict('user-b', false, undefined)).toBe(true);
    expect(hasDeviceWriteOwnerConflict('user-b', true, null)).toBe(true);
    expect(hasDeviceWriteOwnerConflict(undefined, true, 'user-a')).toBe(false);
    expect(hasDeviceWriteOwnerConflict(undefined, false, undefined)).toBe(false);
  });

  it('does not let a stale owner acknowledge another account pending queue', () => {
    expect(hasDeviceAckOwnerConflict('user-b', 'user-a')).toBe(true);
    expect(hasDeviceAckOwnerConflict('user-a', 'user-a')).toBe(false);
    expect(hasDeviceAckOwnerConflict(undefined, 'user-a')).toBe(false);
  });

  it('acknowledges modern pending operations by opId instead of timestamp alone', () => {
    const current = [
      {
        type: 'patch',
        cardId: 'same-card',
        opId: 'new-operation',
        updatedAt: '2026-08-09T00:00:00.000Z',
      },
      {
        type: 'patch',
        cardId: 'same-card',
        opId: 'old-operation',
        updatedAt: '2026-08-09T00:00:00.000Z',
      },
    ];

    expect(filterAcknowledgedLocalPending(current, [current[1]])).toEqual([current[0]]);
  });

  it('retains timestamp fallback only for pending operations without an opId', () => {
    const current = [
      { type: 'delete', cardId: 'legacy-card', updatedAt: '2026-08-09T00:00:00.000Z' },
      { type: 'delete', cardId: 'legacy-card', updatedAt: '2026-08-09T00:00:01.000Z' },
    ];

    expect(filterAcknowledgedLocalPending(current, [current[0]])).toEqual([current[1]]);
  });

  it('preserves a create followed by a patch in the shared device queue', () => {
    const create = {
      type: 'upsert',
      opId: 'create-card',
      ownerUserId: 'user-a',
      card: { id: 'new-card', word: 'new' },
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
    const patch = {
      type: 'patch',
      opId: 'patch-card',
      ownerUserId: 'user-a',
      cardId: 'new-card',
      fields: { bookmarked: true },
      updatedAt: '2026-08-09T00:00:01.000Z',
    };

    expect(mergeLocalPendingOperations([create], [patch])).toEqual([create, patch]);
  });

  it('infers legacy patch fields when merging them with a masked v2 patch', () => {
    const legacyPatch = {
      type: 'patch',
      ownerUserId: 'user-a',
      cardId: 'existing-card',
      fields: { bookmarked: true },
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
    const maskedPatch = {
      type: 'patch',
      ownerUserId: 'user-a',
      cardId: 'existing-card',
      fields: { imageUrl: 'https://images.example.test/card.jpeg' },
      fieldMask: ['imageUrl'],
      updatedAt: '2026-08-09T00:00:01.000Z',
    };

    expect(mergeLocalPendingOperations([legacyPatch], [maskedPatch])).toEqual([{
      ...maskedPatch,
      fields: {
        bookmarked: true,
        imageUrl: 'https://images.example.test/card.jpeg',
      },
      fieldMask: ['bookmarked', 'imageUrl'],
    }]);
  });

  it('replaces the device backup atomically with private file permissions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-backup-'));
    const target = path.join(directory, 'cards.json');

    try {
      writeJsonFileAtomically(target, { cards: [{ id: 'first' }] });
      writeJsonFileAtomically(target, { cards: [{ id: 'second' }] });

      expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({
        cards: [{ id: 'second' }],
      });
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
      expect(fs.readdirSync(directory)).toEqual(['cards.json']);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('serializes read-merge-write transactions across independent processes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-lock-'));
    const target = path.join(directory, 'cards.json');
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();

    try {
      writeJsonFileAtomically(target, { cards: [] });
      const first = withLocalDeviceBackupLock(target, async () => {
        const existing = JSON.parse(fs.readFileSync(target, 'utf8')) as { cards: unknown[] };
        firstEntered.resolve();
        await releaseFirst.promise;
        writeJsonFileAtomically(target, {
          cards: [...existing.cards, { id: 'from-process-a' }],
        });
      });
      await firstEntered.promise;

      const lockProbe = spawnSync(process.execPath, [
        '-e',
        "const fs=require('node:fs');const p=process.argv[1];try{const fd=fs.openSync(p,'wx');fs.closeSync(fd);fs.unlinkSync(p);process.exit(0)}catch(error){process.exit(error?.code==='EEXIST'?23:24)}",
        `${target}.lock`,
      ]);
      const second = withLocalDeviceBackupLock(target, () => {
        const existing = JSON.parse(fs.readFileSync(target, 'utf8')) as { cards: unknown[] };
        writeJsonFileAtomically(target, {
          cards: [...existing.cards, { id: 'from-process-b' }],
        });
      });

      releaseFirst.resolve();
      await Promise.all([first, second]);

      expect(lockProbe.status).toBe(23);
      expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({
        cards: [{ id: 'from-process-a' }, { id: 'from-process-b' }],
      });
      expect(fs.existsSync(`${target}.lock`)).toBe(false);
    } finally {
      releaseFirst.resolve();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('retries when lock-directory removal races pending ticket creation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-pending-race-'));
    const target = path.join(directory, 'cards.json');
    const lockDirectory = `${target}.lock`;
    const originalOpen = fs.promises.open.bind(fs.promises);
    let injectedRace = false;
    const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (file, flags, mode) => {
      if (
        !injectedRace
        && String(file).startsWith(`${lockDirectory}${path.sep}.pending-`)
      ) {
        injectedRace = true;
        await fs.promises.rmdir(lockDirectory);
        throw Object.assign(new Error('simulated removed lock directory'), { code: 'EINVAL' });
      }
      return originalOpen(file, flags, mode);
    });

    try {
      await expect(withLocalDeviceBackupLock(
        target,
        () => 'completed',
        { retryMilliseconds: 1, timeoutMilliseconds: 1_000 },
      )).resolves.toBe('completed');
      expect(injectedRace).toBe(true);
      expect(fs.existsSync(lockDirectory)).toBe(false);
    } finally {
      openSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('serializes concurrent stale-lock reapers without deleting a successor lock', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-reaper-race-'));
    const target = path.join(directory, 'cards.json');
    const lockFile = `${target}.lock`;
    const firstUnlinkStarted = deferred<void>();
    const releaseFirstUnlink = deferred<void>();
    const releaseActions = deferred<void>();
    const originalUnlink = fs.promises.unlink.bind(fs.promises);
    let lockUnlinks = 0;
    let activeActions = 0;
    let maximumActiveActions = 0;

    fs.writeFileSync(lockFile, '{', { mode: 0o600 });
    const staleTime = new Date(Date.now() - 60_000);
    fs.utimesSync(lockFile, staleTime, staleTime);
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockImplementation(async file => {
      if (String(file) === lockFile && ++lockUnlinks === 1) {
        firstUnlinkStarted.resolve();
        await releaseFirstUnlink.promise;
      }
      return originalUnlink(file);
    });
    const action = async () => {
      activeActions += 1;
      maximumActiveActions = Math.max(maximumActiveActions, activeActions);
      await releaseActions.promise;
      activeActions -= 1;
    };

    try {
      const first = withLocalDeviceBackupLock(target, action, {
        retryMilliseconds: 1,
        timeoutMilliseconds: 250,
        staleMilliseconds: 1,
      });
      await firstUnlinkStarted.promise;
      const second = withLocalDeviceBackupLock(target, action, {
        retryMilliseconds: 1,
        timeoutMilliseconds: 250,
        staleMilliseconds: 1,
      });

      await new Promise(resolve => setTimeout(resolve, 20));
      releaseFirstUnlink.resolve();
      await vi.waitFor(() => expect(activeActions).toBeGreaterThan(0));
      await new Promise(resolve => setTimeout(resolve, 20));
      releaseActions.resolve();
      await Promise.all([first, second]);

      expect(maximumActiveActions).toBe(1);
      expect(fs.existsSync(lockFile)).toBe(false);
    } finally {
      releaseFirstUnlink.resolve();
      releaseActions.resolve();
      unlinkSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recovers after a process crashes while coordinating stale-lock reclamation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-gate-crash-'));
    const target = path.join(directory, 'cards.json');
    const orphanedCoordinationFile = `${target}.lock.gate`;
    let actionEntered = false;

    fs.writeFileSync(orphanedCoordinationFile, '', { mode: 0o600 });
    try {
      await withLocalDeviceBackupLock(target, () => { actionEntered = true; }, {
        retryMilliseconds: 1,
        timeoutMilliseconds: 20,
        staleMilliseconds: 1,
      });

      expect(actionEntered).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not reclaim a fresh lock that replaces stale malformed metadata during inspection', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-lock-race-'));
    const target = path.join(directory, 'cards.json');
    const lockFile = `${target}.lock`;
    const staleTime = new Date(Date.now() - 60_000);
    let actionEntered = false;
    let replacedLock = false;
    const originalReadFile = fs.promises.readFile.bind(fs.promises);

    fs.writeFileSync(lockFile, '{', { mode: 0o600 });
    fs.utimesSync(lockFile, staleTime, staleTime);
    const readFileSpy = vi.spyOn(fs.promises, 'readFile').mockImplementation(async (...args) => {
      if (!replacedLock && String(args[0]) === lockFile) {
        replacedLock = true;
        fs.unlinkSync(lockFile);
        fs.writeFileSync(lockFile, '', { mode: 0o600 });
      }
      return originalReadFile(...args);
    });

    try {
      await expect(withLocalDeviceBackupLock(target, () => {
        actionEntered = true;
      }, {
        retryMilliseconds: 1,
        timeoutMilliseconds: 5,
        staleMilliseconds: 30_000,
      })).rejects.toThrow('Timed out waiting for device backup lock');

      expect(replacedLock).toBe(true);
      expect(actionEntered).toBe(false);
      expect(fs.existsSync(lockFile)).toBe(true);
      expect(fs.statSync(lockFile).mtimeMs).toBeGreaterThan(staleTime.getTime());
    } finally {
      readFileSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not reclaim a fresh lock that replaces a dead-owner lock after metadata is read', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-dead-lock-race-'));
    const target = path.join(directory, 'cards.json');
    const lockFile = `${target}.lock`;
    const deadOwner = spawnSync(process.execPath, ['-e', '']);
    const freshMetadata = JSON.stringify({ pid: process.pid, token: 'fresh-owner' });
    let actionEntered = false;
    let replacedLock = false;
    const originalReadFile = fs.promises.readFile.bind(fs.promises);

    fs.writeFileSync(lockFile, JSON.stringify({ pid: deadOwner.pid, token: 'dead-owner' }), { mode: 0o600 });
    const readFileSpy = vi.spyOn(fs.promises, 'readFile').mockImplementation(async (...args) => {
      const contents = await originalReadFile(...args);
      if (!replacedLock && String(args[0]) === lockFile) {
        replacedLock = true;
        fs.unlinkSync(lockFile);
        fs.writeFileSync(lockFile, freshMetadata, { mode: 0o600 });
      }
      return contents;
    });

    try {
      await expect(withLocalDeviceBackupLock(target, () => {
        actionEntered = true;
      }, {
        retryMilliseconds: 1,
        timeoutMilliseconds: 5,
        staleMilliseconds: 30_000,
      })).rejects.toThrow('Timed out waiting for device backup lock');

      expect(replacedLock).toBe(true);
      expect(actionEntered).toBe(false);
      expect(fs.readFileSync(lockFile, 'utf8')).toBe(freshMetadata);
    } finally {
      readFileSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(
    unknownOwnerBackups.flatMap(({ label: backupLabel, backup }) => (
      userScopedMutations.map(({ label: mutationLabel, create }) => ({
        backupLabel,
        backup,
        mutationLabel,
        createMutation: create,
      }))
    )),
  )(
    'rejects $mutationLabel when an owner-unknown backup contains $backupLabel',
    async ({ backup, createMutation }) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-unknown-owner-'));
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(directory);

      try {
        const { backupFile, routes } = configureDeviceRoutes(directory);
        writeJsonFileAtomically(backupFile, backup);
        const originalBytes = fs.readFileSync(backupFile);

        const result = await invokeDeviceMutation(routes, createMutation(backup));

        expect(result.statusCode).toBe(409);
        expect(result.body).toEqual({
          error: 'Device backup belongs to another account',
        });
        expect(fs.readFileSync(backupFile).equals(originalBytes)).toBe(true);
      } finally {
        homedirSpy.mockRestore();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it('rejects an explicit guest cards PUT from claiming a meaningful owner-unknown backup', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-guest-claim-'));
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(directory);
    const originalBackup = unknownOwnerBackups[0].backup;

    try {
      const { backupFile, routes } = configureDeviceRoutes(directory);
      writeJsonFileAtomically(backupFile, originalBackup);
      const originalBytes = fs.readFileSync(backupFile);
      const originalData = JSON.parse(originalBytes.toString('utf8'));

      const result = await invokeDeviceMutation(routes, {
        route: '/api/device-cards',
        method: 'PUT',
        payload: {
          ownerUserId: null,
          cards: [{ id: 'guest-replacement', word: 'Guest replacement' }],
          total: 1,
          mode: 'replace',
        },
      });

      expect(result.statusCode).toBe(401);
      expect(result.body).toEqual({
        error: 'Firebase authentication is required',
      });
      const storedBytes = fs.readFileSync(backupFile);
      expect(storedBytes.equals(originalBytes)).toBe(true);
      expect(JSON.parse(storedBytes.toString('utf8'))).toEqual(originalData);
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(
    malformedTopLevelBackups.flatMap(({ label: backupLabel, backup }) => (
      userScopedMutations.map(({ label: mutationLabel, create }) => ({
        backupLabel,
        backup,
        mutationLabel,
        createMutation: create,
      }))
    )),
  )(
    'rejects $mutationLabel when the stored backup is $backupLabel',
    async ({ backup, createMutation }) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-malformed-backup-'));
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(directory);

      try {
        const { backupFile, routes } = configureDeviceRoutes(directory);
        writeJsonFileAtomically(backupFile, backup);
        const originalBytes = fs.readFileSync(backupFile);
        const originalData = JSON.parse(originalBytes.toString('utf8'));

        const result = await invokeDeviceMutation(routes, createMutation(backup));

        expect(result.statusCode).toBe(409);
        expect(result.body).toEqual({
          error: 'Device backup belongs to another account',
        });
        const storedBytes = fs.readFileSync(backupFile);
        expect(storedBytes.equals(originalBytes)).toBe(true);
        expect(JSON.parse(storedBytes.toString('utf8'))).toEqual(originalData);
      } finally {
        homedirSpy.mockRestore();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.each(
    adoptableBackups.flatMap(({ label: backupLabel, backup, ownerWithoutAdoption }) => (
      userScopedMutations.map(({ label: mutationLabel, create }) => ({
        backupLabel,
        backup,
        mutationLabel,
        createMutation: create,
        ownerWithoutAdoption,
      }))
    )),
  )(
    'allows $mutationLabel against $backupLabel',
    async ({ backup, mutationLabel, createMutation, ownerWithoutAdoption }) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-adoptable-owner-'));
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(directory);

      try {
        const { backupFile, routes } = configureDeviceRoutes(directory);
        writeJsonFileAtomically(backupFile, backup);

        const result = await invokeDeviceMutation(routes, createMutation(backup));

        expect(result.statusCode).toBe(200);
        const stored = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
        const adoptsOwner = mutationLabel === 'sync POST'
          || mutationLabel === 'sync PUT'
          || mutationLabel === 'cards PUT';
        expect(stored.ownerUserId).toBe(adoptsOwner ? 'user-a' : ownerWithoutAdoption);
      } finally {
        homedirSpy.mockRestore();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it('rejects cross-owner sync updates without relabeling the existing backup', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-sync-owner-'));
    const backupFile = path.join(directory, '.lingoflash-device-sync', 'lingoflash-2-cards.json');
    const originalBackup = {
      ownerUserId: 'user-a',
      cards: [{ id: 'private-card', word: 'Private' }],
      total: 1,
    };
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(directory);

    try {
      writeJsonFileAtomically(backupFile, originalBackup);
      const resolvedConfig = (viteConfig as unknown as (environment: {
        mode: string;
        command: string;
      }) => { plugins: any[] })({ mode: 'test', command: 'serve' });
      const plugin = resolvedConfig.plugins
        .flat(Infinity)
        .find(candidate => candidate?.name === 'lingoflash-local-device-sync');
      const routes = new Map<string, (request: any, response: any) => Promise<void>>();
      plugin.configureServer({
        middlewares: {
          use(route: string, handler: (request: any, response: any) => Promise<void>) {
            routes.set(route, handler);
          },
        },
      });
      const sync = routes.get('/api/device-cards/sync');
      expect(sync).toBeDefined();

      for (const method of ['POST', 'PUT']) {
        writeJsonFileAtomically(backupFile, originalBackup);
        const request = Readable.from([
          JSON.stringify({ userId: 'user-b', expectedTotal: 1, status: 'complete' }),
        ]) as any;
        request.method = method;
        request.headers = {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        };
        request.socket = { remoteAddress: '127.0.0.1' };
        let responseBody = '';
        const response = {
          statusCode: 0,
          setHeader: vi.fn(),
          end(payload: string) {
            responseBody = payload;
          },
        };

        await sync!(request, response);

        expect(response.statusCode).toBe(401);
        expect(JSON.parse(responseBody)).toEqual({
          error: 'Firebase authentication is required',
        });
        expect(JSON.parse(fs.readFileSync(backupFile, 'utf8'))).toEqual(originalBackup);
      }
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects every cross-owner mutation when a legacy backup owner is only present in pending operations', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-pending-owner-'));
    const backupFile = path.join(directory, '.lingoflash-device-sync', 'lingoflash-2-cards.json');
    const originalBackup = {
      cards: [{ id: 'private-card', word: 'Private', libraryEpoch: 1, revision: 1 }],
      total: 1,
      pending: [{
        type: 'patch',
        cardId: 'private-card',
        fields: { bookmarked: true },
        ownerUserId: 'user-a',
        updatedAt: '2026-08-10T00:00:00.000Z',
      }],
    };
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(directory);

    try {
      const resolvedConfig = (viteConfig as unknown as (environment: {
        mode: string;
        command: string;
      }) => { plugins: any[] })({ mode: 'test', command: 'serve' });
      const plugin = resolvedConfig.plugins
        .flat(Infinity)
        .find(candidate => candidate?.name === 'lingoflash-local-device-sync');
      const routes = new Map<string, (request: any, response: any) => Promise<void>>();
      plugin.configureServer({
        middlewares: {
          use(route: string, handler: (request: any, response: any) => Promise<void>) {
            routes.set(route, handler);
          },
        },
      });
      const mutations = [
        {
          route: '/api/device-cards/sync',
          method: 'POST',
          payload: { userId: 'user-b', expectedTotal: 1 },
        },
        {
          route: '/api/device-cards/sync',
          method: 'PUT',
          payload: { userId: 'user-b', expectedTotal: 1, status: 'complete' },
        },
        {
          route: '/api/device-cards/cleanup',
          method: 'PUT',
          payload: {
            userId: 'user-b',
            cardId: 'private-card',
            maximum: { libraryEpoch: 1, revision: 1 },
          },
        },
        {
          route: '/api/device-cards/ack',
          method: 'PUT',
          payload: { userId: 'user-b', operations: [] },
        },
        {
          route: '/api/device-cards',
          method: 'PUT',
          payload: { ownerUserId: 'user-b', cards: [], total: 0, mode: 'replace' },
        },
      ];

      for (const mutation of mutations) {
        writeJsonFileAtomically(backupFile, originalBackup);
        const request = Readable.from([JSON.stringify(mutation.payload)]) as any;
        request.method = mutation.method;
        request.headers = {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        };
        request.socket = { remoteAddress: '127.0.0.1' };
        let responseBody = '';
        const response = {
          statusCode: 0,
          setHeader: vi.fn(),
          end(payload: string) {
            responseBody = payload;
          },
        };

        await routes.get(mutation.route)!(request, response);

        expect(response.statusCode, `${mutation.method} ${mutation.route}`).toBe(401);
        expect(JSON.parse(responseBody)).toEqual({
          error: 'Firebase authentication is required',
        });
        expect(JSON.parse(fs.readFileSync(backupFile, 'utf8'))).toEqual(originalBackup);
      }
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when pending operations claim more than one backup owner', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-ambiguous-owner-'));
    const backupFile = path.join(directory, '.lingoflash-device-sync', 'lingoflash-2-cards.json');
    const originalBackup = {
      cards: [{ id: 'private-card', word: 'Private' }],
      total: 1,
      pending: [
        { type: 'delete', cardId: 'a', ownerUserId: 'user-a', updatedAt: '1' },
        { type: 'delete', cardId: 'b', ownerUserId: 'user-b', updatedAt: '2' },
      ],
    };
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(directory);

    try {
      writeJsonFileAtomically(backupFile, originalBackup);
      const resolvedConfig = (viteConfig as unknown as (environment: {
        mode: string;
        command: string;
      }) => { plugins: any[] })({ mode: 'test', command: 'serve' });
      const plugin = resolvedConfig.plugins
        .flat(Infinity)
        .find(candidate => candidate?.name === 'lingoflash-local-device-sync');
      const routes = new Map<string, (request: any, response: any) => Promise<void>>();
      plugin.configureServer({
        middlewares: {
          use(route: string, handler: (request: any, response: any) => Promise<void>) {
            routes.set(route, handler);
          },
        },
      });
      const request = Readable.from([JSON.stringify({ userId: 'user-a', operations: [] })]) as any;
      request.method = 'PUT';
      request.headers = {
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      };
      request.socket = { remoteAddress: '127.0.0.1' };
      let responseBody = '';
      const response = {
        statusCode: 0,
        setHeader: vi.fn(),
        end(payload: string) {
          responseBody = payload;
        },
      };

      await routes.get('/api/device-cards/ack')!(request, response);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(responseBody)).toEqual({
        error: 'Firebase authentication is required',
      });
      expect(JSON.parse(fs.readFileSync(backupFile, 'utf8'))).toEqual(originalBackup);
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists an inferred owner when acknowledging the final pending operation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-ack-owner-'));
    const backupFile = path.join(directory, '.lingoflash-device-sync', 'lingoflash-2-cards.json');
    const pendingOperation = {
      type: 'delete',
      cardId: 'already-deleted',
      opId: 'delete-operation',
      ownerUserId: 'user-a',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(directory);

    try {
      writeJsonFileAtomically(backupFile, {
        cards: [{ id: 'private-card', word: 'Private' }],
        total: 1,
        pending: [pendingOperation],
      });
      const resolvedConfig = (viteConfig as unknown as (environment: {
        mode: string;
        command: string;
      }) => { plugins: any[] })({ mode: 'test', command: 'serve' });
      const plugin = resolvedConfig.plugins
        .flat(Infinity)
        .find(candidate => candidate?.name === 'lingoflash-local-device-sync');
      const routes = new Map<string, (request: any, response: any) => Promise<void>>();
      plugin.configureServer({
        middlewares: {
          use(route: string, handler: (request: any, response: any) => Promise<void>) {
            routes.set(route, handler);
          },
        },
      });
      const invoke = async (route: string, method: string, payload: unknown) => {
        const request = Readable.from([JSON.stringify(payload)]) as any;
        request.method = method;
        request.headers = {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        };
        request.socket = { remoteAddress: '127.0.0.1' };
        let responseBody = '';
        const response = {
          statusCode: 0,
          setHeader: vi.fn(),
          end(body: string) {
            responseBody = body;
          },
        };
        await routes.get(route)!(request, response);
        return { statusCode: response.statusCode, body: JSON.parse(responseBody) };
      };

      await expect(invoke('/api/device-cards/ack', 'PUT', {
        userId: 'user-a',
        operations: [pendingOperation],
      })).resolves.toEqual({
        statusCode: 401,
        body: { error: 'Firebase authentication is required' },
      });
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('migrates the legacy backup before the first read or write path can replace it', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-migration-'));
    const legacy = path.join(directory, 'legacy.json');
    const target = path.join(directory, 'current', 'cards.json');

    try {
      fs.writeFileSync(legacy, JSON.stringify({ cards: [{ id: 'legacy-card' }] }));

      expect(readJsonFileWithMigration(target, legacy)).toEqual({
        cards: [{ id: 'legacy-card' }],
      });
      expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({
        cards: [{ id: 'legacy-card' }],
      });
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

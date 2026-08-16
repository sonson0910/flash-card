import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import type { CardIntakePortOptions } from './cardIntakePortContract';
import {
  createCardIntakePipeline,
  StaleIntakeSessionError,
} from './cardIntakePipeline';

vi.mock('../../lib/firebase', () => ({ db: null, isFirebaseConfigured: false }));

const card = (id: string, overrides: Partial<CardData> = {}): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `${id}-vi`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  ...overrides,
});

const pendingCreate = (candidate: CardData): Extract<
  DevicePendingOperation,
  { type: 'upsert' }
> => ({
  type: 'upsert',
  operation: 'create',
  opId: `create-${candidate.id}`,
  card: candidate,
  fieldMask: [],
  baseRevision: candidate.revision ?? 0,
  libraryEpoch: candidate.libraryEpoch ?? 0,
  updatedAt: candidate.createdAt ?? '2026-08-13T00:00:00.000Z',
  ownerUserId: 'owner-a',
});

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }

  postMessage(data: unknown) {
    FakeBroadcastChannel.instances
      .filter(channel => channel !== this && channel.name === this.name)
      .forEach(channel => channel.listeners.forEach(listener => listener({ data } as MessageEvent)));
  }

  close() {
    FakeBroadcastChannel.instances = FakeBroadcastChannel.instances.filter(channel => channel !== this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

const createContext = (): CardIntakePortOptions => ({
  ownerId: 'owner-a',
  libraryEpoch: 3,
  knownLibraryTotal: 0,
  cloudStats: {
    total: 0,
    reviewed: 0,
    easy: 0,
    good: 0,
    hard: 0,
    unrated: 0,
    bookmarked: 0,
    due: 0,
    legacyUnindexed: 0,
  },
  cardsPerPage: 9,
  getCards: () => [],
  publishCards: vi.fn(),
  upsertDeviceCards: vi.fn(async () => []),
  connectPendingCreateSettlement: vi.fn(),
  patchCard: vi.fn(async () => undefined),
  hydrateExisting: vi.fn(),
  rememberPromoted: vi.fn(),
  resetCatalog: vi.fn(),
  resetCloudPage: vi.fn(),
  updateCloudStats: vi.fn(),
  updateCloudTotal: vi.fn(),
  updateCategoryFacets: vi.fn(async () => undefined),
  setCloudUnavailable: vi.fn(),
  notify: vi.fn(),
  focusLibrary: vi.fn(),
  addXp: vi.fn(),
});

describe('Card Intake Pipeline contract', () => {
  it('keeps React lifecycle separate from the persistence protocol', () => {
    const hookSource = readFileSync(
      fileURLToPath(new URL('./useCardIntakePort.ts', import.meta.url)),
      'utf8',
    );
    const pipelineSource = readFileSync(
      fileURLToPath(new URL('./cardIntakePipeline.ts', import.meta.url)),
      'utf8',
    );

    expect(hookSource).toContain('createCardIntakePipeline');
    expect(hookSource).toContain('replaceOwner(options.ownerId)');
    expect(hookSource).not.toMatch(/firebase|cardRepository|cardMirror|deviceSync/);
    expect(pipelineSource).not.toMatch(/from ['"]react['"]|useRef\(/);
  });

  it('keeps one stable intent interface while the owner generation advances', () => {
    let context = createContext();
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });
    const methods = {
      findExisting: pipeline.findExisting,
      touchExisting: pipeline.touchExisting,
      generateCard: pipeline.generateCard,
      persistCards: pipeline.persistCards,
      applyMedia: pipeline.applyMedia,
      persistStructured: pipeline.persistStructured,
      generate: pipeline.generate,
      completeFlat: pipeline.completeFlat,
    };

    context = { ...context, ownerId: 'owner-b', libraryEpoch: 4 };
    pipeline.replaceOwner('owner-b');
    context = { ...context, ownerId: 'owner-a', libraryEpoch: 5 };
    pipeline.replaceOwner('owner-a');

    expect(pipeline).toMatchObject(methods);
  });

  it('publishes a queued card optimistically through the current owner context', async () => {
    const context = createContext();
    const candidate = card('queued-card');
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });

    await expect(pipeline.persistCards([candidate], 'shared')).resolves.toEqual([
      { card: candidate, created: true },
    ]);

    expect(context.upsertDeviceCards).toHaveBeenCalledWith([candidate], 1);
    expect(context.publishCards).toHaveBeenCalledWith([candidate]);
    expect(context.addXp).toHaveBeenCalledWith(10);
  });

  it('reveals an existing card on a refreshed first page without requiring reload', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const existing = card('existing-card');
    const context = {
      ...createContext(),
      getCards: () => [existing],
    };
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });

    await pipeline.touchExisting(existing, '2026-08-13T03:00:00.000Z');

    expect(context.resetCatalog).toHaveBeenCalledOnce();
    expect(context.resetCloudPage).toHaveBeenCalledOnce();
    expect(context.focusLibrary).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });

  it.each(['created', 'replayed'] as const)(
    'routes late media to the authoritative card after a %s create settlement',
    async outcome => {
      const candidate = card('temporary-card', {
        createdAt: '2026-08-13T00:00:00.000Z',
        libraryEpoch: 3,
        revision: 0,
      });
      const operation = pendingCreate(candidate);
      const authoritative = card('canonical-card', {
        ...candidate,
        id: 'canonical-card',
        revision: 5,
      });
      const context = {
        ...createContext(),
        upsertDeviceCards: vi.fn(async () => [operation]),
      };
      const pipeline = createCardIntakePipeline({ getContext: () => context });
      await pipeline.persistCards([candidate], 'generate');

      await pipeline.settlePendingCreate({ operation, authoritativeCard: authoritative, outcome });
      const media = {
        imageUrl: 'https://images.pexels.com/canonical-card.jpeg',
        audioUrl: null,
      };
      await pipeline.applyMedia(candidate, media);

      expect(context.patchCard).toHaveBeenCalledWith(authoritative.id, media, authoritative);
    },
  );

  it('ignores late media after the optimistic create resolves as a duplicate', async () => {
    const candidate = card('duplicate-card', {
      createdAt: '2026-08-13T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 0,
    });
    const operation = pendingCreate(candidate);
    const authoritative = card(candidate.id, {
      createdAt: '2026-08-12T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 5,
    });
    const context = {
      ...createContext(),
      getCards: () => [candidate],
      upsertDeviceCards: vi.fn(async () => [operation]),
    };
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    await pipeline.persistCards([candidate], 'generate');

    await pipeline.settlePendingCreate({
      operation,
      authoritativeCard: authoritative,
      outcome: 'duplicate',
    });
    vi.mocked(context.patchCard).mockClear();
    await pipeline.applyMedia(candidate, {
      imageUrl: 'https://images.pexels.com/rejected-candidate.jpeg',
      audioUrl: null,
    });

    expect(context.patchCard).not.toHaveBeenCalled();
  });

  it('compensates an optimistic duplicate settled by another tab', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const candidate = card('cross-tab-duplicate', {
      createdAt: '2026-08-13T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 0,
    });
    const operation = pendingCreate(candidate);
    const authoritative = card(candidate.id, {
      createdAt: '2026-08-12T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 5,
    });
    const context = {
      ...createContext(),
      getCards: () => [candidate],
      upsertDeviceCards: vi.fn(async () => [operation]),
    };
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    await pipeline.persistCards([candidate], 'generate');
    const remoteTab = new FakeBroadcastChannel('lingoflash-pending-create-settlements-v1');

    remoteTab.postMessage({
      operation,
      authoritativeCard: authoritative,
      outcome: 'duplicate',
    });

    await vi.waitFor(() => expect(context.addXp).toHaveBeenCalledTimes(2));
    expect(context.addXp).toHaveBeenNthCalledWith(1, 10);
    expect(context.addXp).toHaveBeenNthCalledWith(2, -10);
    pipeline.dispose();
    remoteTab.close();
    warn.mockRestore();
  });

  it('buffers a cross-tab settlement that arrives while durable staging is completing', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const candidate = card('staging-race-card', {
      createdAt: '2026-08-13T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 0,
    });
    const operation = pendingCreate(candidate);
    const authoritative = card(candidate.id, {
      createdAt: '2026-08-12T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 5,
    });
    const staging = deferred<DevicePendingOperation[]>();
    const context = {
      ...createContext(),
      getCards: () => [candidate],
      upsertDeviceCards: vi.fn(() => staging.promise),
    };
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    const persistence = pipeline.persistCards([candidate], 'generate');
    const remoteTab = new FakeBroadcastChannel('lingoflash-pending-create-settlements-v1');

    remoteTab.postMessage({
      operation,
      authoritativeCard: authoritative,
      outcome: 'duplicate',
    });
    staging.resolve([operation]);
    await persistence;

    expect(context.addXp).toHaveBeenNthCalledWith(1, 10);
    expect(context.addXp).toHaveBeenNthCalledWith(2, -10);
    pipeline.dispose();
    remoteTab.close();
    warn.mockRestore();
  });

  it('retries duplicate compensation after the current epoch catches up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const candidate = card('epoch-race-card', {
      createdAt: '2026-08-13T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 0,
    });
    const operation = pendingCreate(candidate);
    const authoritative = card(candidate.id, {
      createdAt: '2026-08-12T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 5,
    });
    let context = {
      ...createContext(),
      libraryEpoch: 2,
      getCards: () => [candidate],
      upsertDeviceCards: vi.fn(async () => [operation]),
    };
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    await pipeline.persistCards([candidate], 'generate');

    await pipeline.settlePendingCreate({
      operation,
      authoritativeCard: authoritative,
      outcome: 'duplicate',
    });
    expect(context.addXp).toHaveBeenCalledOnce();

    context = { ...context, libraryEpoch: 3 };
    pipeline.replaceOwner('owner-a');

    await vi.waitFor(() => expect(context.addXp).toHaveBeenCalledTimes(2));
    expect(context.addXp).toHaveBeenLastCalledWith(-10);
    pipeline.dispose();
    warn.mockRestore();
  });

  it('promotes a newer current authoritative card instead of stale settlement data', async () => {
    const candidate = card('temporary-card', {
      createdAt: '2026-08-13T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 0,
    });
    const operation = pendingCreate(candidate);
    const settled = card('canonical-card', {
      createdAt: '2026-08-12T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 5,
    });
    const currentAuthoritative = { ...settled, revision: 6, bookmarked: true };
    const context = {
      ...createContext(),
      getCards: () => [candidate, currentAuthoritative],
      upsertDeviceCards: vi.fn(async () => [operation]),
    };
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    await pipeline.persistCards([candidate], 'generate');

    await pipeline.settlePendingCreate({
      operation,
      authoritativeCard: settled,
      outcome: 'duplicate',
    });

    expect(context.hydrateExisting).toHaveBeenCalledWith(expect.objectContaining({
      id: currentAuthoritative.id,
      revision: 6,
      bookmarked: true,
    }));
  });

  it('rejects late optimistic publication after an A-to-B owner switch', async () => {
    const queued = deferred<[]>();
    const ownerA = {
      ...createContext(),
      upsertDeviceCards: vi.fn(() => queued.promise),
    };
    let context: CardIntakePortOptions = ownerA;
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });

    const persistence = pipeline.persistCards([card('late-a-card')], 'shared');
    context = { ...createContext(), ownerId: 'owner-b', libraryEpoch: 4 };
    pipeline.replaceOwner('owner-b');
    queued.resolve([]);

    await expect(persistence).rejects.toBeInstanceOf(StaleIntakeSessionError);
    expect(ownerA.publishCards).not.toHaveBeenCalled();
    expect(ownerA.addXp).not.toHaveBeenCalled();
  });
});

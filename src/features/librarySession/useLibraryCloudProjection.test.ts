import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { EMPTY_LIBRARY_STATS } from './cloudLibraryPageController';
import {
  createLibraryCloudProjectionController,
  type LibraryCloudProjectionCache,
  type LibraryCloudProjectionInput,
  type LibraryCloudProjectionPublication,
} from './useLibraryCloudProjection';

const card = (word: string): CardData => ({
  id: `word-${word}`,
  word,
  normalizedWord: word,
  translation: `${word}-vi`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-08-03T00:00:00.000Z',
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

const session = (ownerId: string | null, options: {
  ownerCards?: CardData[];
  cloudCards?: CardData[];
  cloudError?: string | null;
  ownerError?: string | null;
  cloudLoading?: boolean;
  hasNext?: boolean;
} = {}): LibraryCloudProjectionInput['session'] => ({
  identity: {
    status: ownerId ? 'authenticated' : 'anonymous',
    owner: ownerId ? { id: ownerId, displayName: null, email: null, photoUrl: null } : null,
    ownerEpoch: ownerId ? { ownerId, value: 1 } : null,
    canPublishMutations: Boolean(ownerId),
    isSigningIn: false,
    isSigningOut: false,
    error: null,
  },
  owner: {
    ownerId,
    cards: options.ownerCards ?? [],
    decks: [],
    legacyPending: 0,
    legacyIssue: null,
    isMigratingLegacy: false,
    status: ownerId ? 'ready' : 'idle',
    error: options.ownerError ?? null,
  },
  sync: { isSyncing: false, pendingCount: 0, error: null },
  cloud: {
    ownerId,
    queryKey: 'all',
    page: 1,
    items: options.cloudCards ?? [],
    total: options.cloudCards?.length ?? 0,
    hasNext: options.hasNext ?? false,
    isLoading: options.cloudLoading ?? false,
    cloudUnavailable: false,
    error: options.cloudError ?? null,
    stats: EMPTY_LIBRARY_STATS,
    isStatsLoading: false,
    facets: {},
    facetsComplete: false,
  },
});

const setup = (cacheOverrides: Partial<LibraryCloudProjectionCache> = {}) => {
  const publication: LibraryCloudProjectionPublication = {
    presentCards: vi.fn(),
    presentCloud: vi.fn(),
    resetCloud: vi.fn(),
    resetPage: vi.fn(),
    previousPage: vi.fn(),
    reportError: vi.fn(),
    clearError: vi.fn(),
    notify: vi.fn(),
  };
  const cache: LibraryCloudProjectionCache = {
    readAnonymous: vi.fn(() => ({ ownerId: null, cards: [] })),
    writeAnonymous: vi.fn(),
    loadDeviceBackup: vi.fn(async () => null),
    ...cacheOverrides,
  };
  return {
    publication,
    cache,
    controller: createLibraryCloudProjectionController({ cache, publication }),
  };
};

describe('library cloud projection', () => {
  it('keeps the hook boundary vendor-free and without React setters', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useLibraryCloudProjection.ts', import.meta.url)),
      'utf8',
    );
    const { controller } = setup();

    expect(source).toMatch(/useSyncExternalStore/);
    expect(source).not.toMatch(/firebase|Firestore|Repository|Dispatch|SetStateAction/i);
    expect(Object.keys(controller.actions).some(key => key.startsWith('set'))).toBe(false);
  });

  it('adopts the owner cache once, then lets the matching cloud page win', async () => {
    const ownerCard = card('cached');
    const cloudCard = card('cloud');
    const { controller, publication } = setup();

    await controller.update({
      session: session('owner-1', { ownerCards: [ownerCard], cloudCards: [cloudCard] }),
      cards: [],
      page: 1,
    });

    expect(publication.presentCards).toHaveBeenNthCalledWith(1, [ownerCard]);
    expect(publication.presentCards).toHaveBeenNthCalledWith(2, [cloudCard]);
    expect(publication.resetCloud).toHaveBeenCalledOnce();
    expect(publication.resetPage).toHaveBeenCalledOnce();
    expect(publication.presentCloud).toHaveBeenCalledWith(expect.objectContaining({ total: 1, items: [cloudCard] }));
    expect(controller.getSnapshot()).toMatchObject({ ownerId: 'owner-1', source: 'cloud', status: 'ready' });
  });

  it('projects page exhaustion and forwards each owner/cloud error once', async () => {
    const { controller, publication } = setup();
    const input = {
      session: session('owner-1', {
        cloudCards: [], cloudError: 'Cloud unavailable', ownerError: 'Owner cache failed', hasNext: false,
      }),
      cards: [],
      page: 3,
    };

    await controller.update(input);
    await controller.update(input);

    expect(publication.previousPage).toHaveBeenCalledOnce();
    expect(publication.reportError).toHaveBeenCalledTimes(2);
    expect(publication.reportError).toHaveBeenCalledWith('Owner cache failed');
    expect(publication.reportError).toHaveBeenCalledWith('Cloud unavailable');
  });

  it('clears a cloud page error after the page recovers', async () => {
    const { controller, publication } = setup();

    await controller.update({
      session: session('owner-1', { cloudError: 'Cloud unavailable' }),
      cards: [],
      page: 1,
    });
    await controller.update({
      session: session('owner-1'),
      cards: [],
      page: 1,
    });

    expect(publication.clearError).toHaveBeenCalledWith('Cloud unavailable');
  });

  it('adopts an anonymous local cache before persisting later local changes', async () => {
    const cached = card('cached');
    const edited = card('edited');
    const { controller, publication, cache } = setup({
      readAnonymous: vi.fn(() => ({ ownerId: null, cards: [cached] })),
    });

    await controller.update({ session: session(null), cards: [card('stale-owner')], page: 1 });
    expect(publication.presentCards).toHaveBeenCalledWith([
      expect.objectContaining({ word: cached.word }),
    ]);
    expect(cache.writeAnonymous).not.toHaveBeenCalled();

    await controller.update({ session: session(null), cards: [edited], page: 1 });
    expect(cache.writeAnonymous).toHaveBeenCalledWith([edited]);
  });

  it('ignores a late anonymous device seed after the owner changes', async () => {
    const seed = deferred<{ ownerId: string | null; cards: CardData[] } | null>();
    const { controller, publication } = setup({ loadDeviceBackup: vi.fn(() => seed.promise) });
    const anonymous = controller.update({ session: session(null), cards: [], page: 1 });

    await controller.update({ session: session('owner-1'), cards: [], page: 1 });
    seed.resolve({ ownerId: null, cards: [card('anonymous')] });
    await anonymous;

    expect(vi.mocked(publication.presentCards).mock.calls
      .flatMap(([cards]) => cards).some(value => value.word === 'anonymous')).toBe(false);
    expect(publication.notify).not.toHaveBeenCalled();
  });

  it('seeds a valid anonymous device backup and rejects owner-scoped backups', async () => {
    const restored = card('restored');
    const valid = setup({
      loadDeviceBackup: vi.fn(async () => ({ ownerId: null, cards: [restored] })),
    });
    await valid.controller.update({ session: session(null), cards: [], page: 1 });
    expect(valid.publication.presentCards).toHaveBeenLastCalledWith([
      expect.objectContaining({ word: restored.word }),
    ]);
    expect(valid.cache.writeAnonymous).toHaveBeenCalledWith([
      expect.objectContaining({ word: restored.word }),
    ]);
    expect(valid.publication.notify).toHaveBeenCalledWith('Restored 1 card from the shared local library.');

    const scoped = setup({
      loadDeviceBackup: vi.fn(async () => ({ ownerId: 'owner-2', cards: [restored] })),
    });
    await scoped.controller.update({ session: session(null), cards: [], page: 1 });
    expect(vi.mocked(scoped.publication.presentCards).mock.calls
      .flatMap(([cards]) => cards).some(value => value.word === restored.word)).toBe(false);
  });
});

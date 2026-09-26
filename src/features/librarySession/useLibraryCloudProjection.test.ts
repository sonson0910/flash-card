import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { EMPTY_LIBRARY_STATS } from './cloudLibraryPageController';
import {
  createLibraryCloudProjectionController,
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

const session = (ownerId: string | null, options: {
  cloudCards?: CardData[];
  cloudError?: string | null;
  cloudLoading?: boolean;
  hasNext?: boolean;
  identityLoading?: boolean;
} = {}): LibraryCloudProjectionInput['session'] => ({
  identity: {
    status: options.identityLoading ? 'loading' : ownerId ? 'authenticated' : 'anonymous',
    owner: ownerId ? { id: ownerId, displayName: null, email: null, photoUrl: null } : null,
    ownerEpoch: ownerId ? { ownerId, value: 1 } : null,
    canPublishMutations: Boolean(ownerId),
    isSigningIn: false,
    isSigningOut: false,
    authenticationRecovery: null,
    error: null,
  },
  owner: {
    ownerId,
    decks: [],
    legacyPending: 0,
    legacyIssue: null,
    isMigratingLegacy: false,
    status: ownerId ? 'ready' : 'idle',
    error: null,
  },
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

const setup = () => {
  const publication: LibraryCloudProjectionPublication = {
    presentCards: vi.fn(),
    presentCloud: vi.fn(),
    resetCloud: vi.fn(),
    resetPage: vi.fn(),
    previousPage: vi.fn(),
    reportError: vi.fn(),
    clearError: vi.fn(),
  };
  return {
    publication,
    controller: createLibraryCloudProjectionController({ publication }),
  };
};

describe('library cloud projection', () => {
  it('keeps the hook boundary vendor-free', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useLibraryCloudProjection.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/useSyncExternalStore/);
    expect(source).not.toMatch(/firebase|Firestore|Repository|Dispatch|SetStateAction/i);
  });

  it('forwards the matching cloud page once the owner is authenticated', () => {
    const cloudCard = card('cloud');
    const { controller, publication } = setup();

    controller.update({ session: session('owner-1', { cloudCards: [cloudCard] }), page: 1 });

    expect(publication.presentCards).toHaveBeenLastCalledWith([cloudCard]);
    expect(publication.presentCloud).toHaveBeenCalledWith(expect.objectContaining({ total: 1, items: [cloudCard] }));
    expect(controller.getSnapshot()).toMatchObject({ ownerId: 'owner-1', source: 'cloud', status: 'ready' });
  });

  it('publishes an idle, empty model while identity is loading', () => {
    const { controller, publication } = setup();

    controller.update({ session: session(null, { identityLoading: true }), page: 1 });

    expect(publication.presentCards).toHaveBeenCalledWith([]);
    expect(controller.getSnapshot()).toMatchObject({ ownerId: null, status: 'idle', source: 'none' });
  });

  it('resets to an empty ready model when signed out', () => {
    const { controller, publication } = setup();

    controller.update({ session: session(null), page: 1 });

    expect(publication.presentCards).toHaveBeenCalledWith([]);
    expect(publication.resetCloud).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({ ownerId: null, status: 'ready', source: 'none' });
  });

  it('navigates back exactly once for an exhausted page', () => {
    const { controller, publication } = setup();
    const input = { session: session('owner-1', { cloudCards: [], hasNext: false }), page: 3 };

    controller.update(input);
    controller.update(input);

    expect(publication.previousPage).toHaveBeenCalledOnce();
  });

  it('reports a cloud error once and clears it once the page recovers', () => {
    const { controller, publication } = setup();

    controller.update({ session: session('owner-1', { cloudError: 'Cloud unavailable' }), page: 1 });
    controller.update({ session: session('owner-1', { cloudError: 'Cloud unavailable' }), page: 1 });
    controller.update({ session: session('owner-1'), page: 1 });

    expect(publication.reportError).toHaveBeenCalledOnce();
    expect(publication.reportError).toHaveBeenCalledWith('Cloud unavailable');
    expect(publication.clearError).toHaveBeenCalledWith('Cloud unavailable');
  });

  it('resets and restarts forwarding when the owner switches', () => {
    const { controller, publication } = setup();

    controller.update({ session: session('owner-1', { cloudCards: [card('owner-1-card')] }), page: 1 });
    controller.update({ session: session('owner-2', { cloudCards: [card('owner-2-card')] }), page: 1 });

    expect(publication.resetCloud).toHaveBeenCalledTimes(2);
    expect(publication.presentCards).toHaveBeenLastCalledWith([expect.objectContaining({ word: 'owner-2-card' })]);
    expect(controller.getSnapshot()).toMatchObject({ ownerId: 'owner-2', source: 'cloud' });
  });
});

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
    coverPresets: {},
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
    canRetryAutomatically: false,
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

describe('unchanged cloud projection after local mutation', () => {
  it('does not republish a stale cloud page over a local acknowledged edit', () => {
    const { controller, publication } = setup();
    const cloud = session('owner-a', { cloudCards: [card('focus')] });
    controller.update({ session: cloud, page: 1 });
    const updated = { ...cloud.cloud.items[0], revision: 2, bookmarked: true };
    publication.presentCards([updated]);
    vi.mocked(publication.presentCards).mockClear();
    controller.update({ session: { ...cloud }, page: 1 });
    expect(publication.presentCards).not.toHaveBeenCalled();
    const fresh = { ...cloud, cloud: { ...cloud.cloud, items: [updated] } };
    controller.update({ session: fresh, page: 1 });
    expect(publication.presentCards).toHaveBeenLastCalledWith([updated]);
  });
  it('does not resurrect a locally removed card until Firestore delivers a new snapshot', () => {
    const { controller, publication } = setup();
    const cloud = session('owner-a', { cloudCards: [card('focus')] });
    controller.update({ session: cloud, page: 1 });
    publication.presentCards([]);
    vi.mocked(publication.presentCards).mockClear();
    controller.update({ session: { ...cloud }, page: 1 });
    expect(publication.presentCards).not.toHaveBeenCalled();
    controller.update({ session: { ...cloud, cloud: { ...cloud.cloud, items: [] } }, page: 1 });
    expect(publication.presentCards).toHaveBeenLastCalledWith([]);
  });
});

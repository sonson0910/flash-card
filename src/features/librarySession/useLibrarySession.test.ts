import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardQueryState } from '../../lib/cardQuery';
import type { CardData } from '../../types/card';
import { EMPTY_LIBRARY_STATS } from './cloudLibraryPageController';
import {
  useLibrarySession,
  type LibrarySessionHookDependencies,
  type LibrarySessionInputs,
} from './useLibrarySession';

const query: CardQueryState = {
  category: null,
  customDeck: null,
  difficulty: null,
  partOfSpeech: null,
  bookmarkedOnly: false,
  createdDate: null,
  wordPrefix: '',
};

const card: CardData = {
  id: 'word-apple',
  word: 'apple',
  normalizedWord: 'apple',
  translation: 'táo',
  explanation: '',
  phonetic: '',
  emoji: '🍎',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-08-03T00:00:00.000Z',
};

const inputs: LibrarySessionInputs = {
  catalog: {
    query,
    queryKey: 'all',
    page: 2,
    pageSize: 9,
    refreshKey: 4,
    statsOpen: true,
  },
  library: {
    cards: [card],
    knownTotal: 12,
    cloudTotal: 11,
    cloudStatsTotal: 10,
    browserOnline: true,
    cloudUnavailable: false,
  },
  ports: {
    ownerAdapter: { available: false } as never,
    deviceEvents: {} as never,
    getPromotedCards: () => [card],
  },
};

const createDependencies = (authenticated = true) => {
  const identityActions = {
    signIn: vi.fn(async () => ({ status: 'completed' as const })),
    signOut: vi.fn(async () => ({ status: 'completed' as const })),
    clearError: vi.fn(),
    acceptVerifiedOwnerEpoch: vi.fn(() => true),
  };
  const ownerActions = {
      migrateLegacy: vi.fn(async () => ({
        status: 'completed' as const,
        migrated: 0,
        scanned: 0,
        complete: true,
      })),
    discardCards: vi.fn(),
  };
  const deviceFunctions = {
    getFallback: vi.fn(async () => null),
    refreshPending: vi.fn(async () => 0),
    acknowledge: vi.fn(async () => undefined),
    upsertCards: vi.fn(async () => []),
    patchCards: vi.fn(async () => []),
    removeCard: vi.fn(async () => []),
    flush: vi.fn(async () => ({ settlements: [] })),
    syncMirror: vi.fn(async () => 0),
    syncNow: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
  const dependencies: LibrarySessionHookDependencies = {
    useIdentitySession: vi.fn(() => ({
      status: authenticated ? 'authenticated' as const : 'anonymous' as const,
      owner: authenticated ? { id: 'owner-1', displayName: 'Learner', email: null, photoUrl: null } : null,
      ownerEpoch: authenticated ? { ownerId: 'owner-1', value: 7 } : null,
      canPublishMutations: authenticated,
      isSigningIn: false,
      isSigningOut: false,
      error: null,
      ...identityActions,
    })),
    useOwnerLibrarySession: vi.fn(() => ({
      model: {
        ownerId: authenticated ? 'owner-1' : null,
        cards: [],
        decks: ['IELTS'],
        legacyPending: 3,
        legacyIssue: null,
        isMigratingLegacy: false,
        status: authenticated ? 'ready' as const : 'idle' as const,
        error: null,
      },
      actions: ownerActions,
    })),
    useLibraryDeviceSync: vi.fn(() => ({
      isSyncing: false,
      pendingCount: 2,
      error: null,
      ...deviceFunctions,
    })),
    useCloudLibraryPage: vi.fn(() => ({
      ownerId: authenticated ? 'owner-1' : null,
      queryKey: 'all',
      page: 2,
      items: [card],
      total: 12,
      hasNext: true,
      isLoading: false,
      cloudUnavailable: false,
      error: null,
      stats: EMPTY_LIBRARY_STATS,
      isStatsLoading: false,
      facets: { General: 12 },
      facetsComplete: true,
    })),
  };
  return { dependencies, identityActions, ownerActions, deviceFunctions };
};

describe('useLibrarySession facade', () => {
  it('keeps its contract grouped and free of setters or vendor types', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useLibrarySession.ts', import.meta.url)),
      'utf8',
    );
    const { dependencies } = createDependencies();
    const session = useLibrarySession(inputs, dependencies);

    expect(source).not.toMatch(/firebase|Firestore|QueryDocumentSnapshot|Dispatch|SetStateAction/i);
    expect(Object.keys(session)).toEqual(['model', 'actions', 'ports']);
    expect(Object.keys(session.model)).toEqual(['identity', 'owner', 'sync', 'cloud']);
    expect(Object.keys(session.actions)).toEqual(['identity', 'owner', 'sync']);
    expect(JSON.stringify(Object.keys(session.actions))).not.toMatch(/set[A-Z]/);
  });

  it('derives owner identity once and wires sync fallback into the cloud page', () => {
    const { dependencies, deviceFunctions } = createDependencies();
    const session = useLibrarySession(inputs, dependencies);

    expect(dependencies.useOwnerLibrarySession).toHaveBeenCalledWith({
      ownerId: 'owner-1',
      libraryEpoch: 7,
      cloudTotal: 12,
      adapter: inputs.ports.ownerAdapter,
      cache: undefined,
    });
    expect(dependencies.useLibraryDeviceSync).toHaveBeenCalledWith(expect.objectContaining({
      owner: { uid: 'owner-1' },
      epoch: { userId: 'owner-1', value: 7 },
      cards: [card],
      query,
      currentPage: 2,
      events: inputs.ports.deviceEvents,
    }));
    expect(dependencies.useCloudLibraryPage).toHaveBeenCalledWith({
      ownerId: 'owner-1',
      query,
      queryKey: 'all',
      page: 2,
      pageSize: 9,
      refreshKey: 4,
      statsOpen: true,
      getDeviceFallback: deviceFunctions.getFallback,
      getPromotedCards: inputs.ports.getPromotedCards,
    });
    expect(session.model.sync).toEqual({ isSyncing: false, pendingCount: 2, error: null });
  });

  it('publishes narrow domain actions and consumer ports without re-wrapping them', () => {
    const { dependencies, identityActions, ownerActions, deviceFunctions } = createDependencies();
    const session = useLibrarySession(inputs, dependencies);

    expect(session.actions.identity).toEqual(identityActions);
    expect(session.actions.owner).toEqual(ownerActions);
    expect(session.actions.sync).toEqual({ syncNow: deviceFunctions.syncNow, retry: deviceFunctions.retry });
    expect(session.ports.cards).toEqual({
      acknowledge: deviceFunctions.acknowledge,
      upsert: deviceFunctions.upsertCards,
      patch: deviceFunctions.patchCards,
      remove: deviceFunctions.removeCard,
    });
    expect(session.ports.cloud).toEqual({
      getFallback: deviceFunctions.getFallback,
      flush: deviceFunctions.flush,
      refreshPending: deviceFunctions.refreshPending,
      syncMirror: deviceFunctions.syncMirror,
    });
  });

  it('passes anonymous ownership through every child session', () => {
    const { dependencies } = createDependencies(false);
    const session = useLibrarySession(inputs, dependencies);

    expect(dependencies.useOwnerLibrarySession).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: null,
      libraryEpoch: null,
    }));
    expect(dependencies.useLibraryDeviceSync).toHaveBeenCalledWith(expect.objectContaining({
      owner: null,
      epoch: null,
    }));
    expect(dependencies.useCloudLibraryPage).toHaveBeenCalledWith(expect.objectContaining({ ownerId: null }));
    expect(session.model.identity.owner).toBeNull();
  });
});

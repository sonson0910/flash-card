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
    progressEvidenceOpen: false,
  },
  library: {
    knownTotal: 12,
    cloudTotal: 11,
    cloudStatsTotal: 10,
  },
  ports: {
    ownerAdapter: { available: false } as never,
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
  };
  const dependencies: LibrarySessionHookDependencies = {
    useIdentitySession: vi.fn(() => ({
      status: authenticated ? 'authenticated' as const : 'anonymous' as const,
      owner: authenticated ? { id: 'owner-1', displayName: 'Learner', email: null, photoUrl: null } : null,
      ownerEpoch: authenticated ? { ownerId: 'owner-1', value: 7 } : null,
      canPublishMutations: authenticated,
      isSigningIn: false,
      isSigningOut: false,
      authenticationRecovery: null,
      error: null,
      ...identityActions,
    })),
    useOwnerLibrarySession: vi.fn(() => ({
      model: {
        ownerId: authenticated ? 'owner-1' : null,
        decks: ['IELTS'],
        coverPresets: {},
        legacyPending: 3,
        legacyIssue: null,
        isMigratingLegacy: false,
        status: authenticated ? 'ready' as const : 'idle' as const,
        error: null,
      },
      actions: ownerActions,
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
  return { dependencies, identityActions, ownerActions };
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
    expect(Object.keys(session)).toEqual(['model', 'actions']);
    expect(Object.keys(session.model)).toEqual(['identity', 'owner', 'cloud']);
    expect(Object.keys(session.actions)).toEqual(['identity', 'owner']);
    expect(JSON.stringify(Object.keys(session.actions))).not.toMatch(/set[A-Z]/);
  });

  it('derives owner identity once and wires the cloud page directly', () => {
    const { dependencies } = createDependencies();
    const session = useLibrarySession(inputs, dependencies);

    expect(dependencies.useOwnerLibrarySession).toHaveBeenCalledWith({
      ownerId: 'owner-1',
      libraryEpoch: 7,
      cloudTotal: 12,
      adapter: inputs.ports.ownerAdapter,
    });
    expect(dependencies.useCloudLibraryPage).toHaveBeenCalledWith({
      ownerId: 'owner-1',
      query,
      queryKey: 'all',
      page: 2,
      pageSize: 9,
      refreshKey: 4,
      statsOpen: true,
      progressEvidenceOpen: false,
      getPromotedCards: inputs.ports.getPromotedCards,
    });
    expect(session.model.cloud.items).toEqual([card]);
  });

  it('keeps ownership visible while exposing authentication recovery', () => {
    const { dependencies } = createDependencies();
    const identity = dependencies.useIdentitySession();
    vi.mocked(dependencies.useIdentitySession).mockReturnValue({
      ...identity,
      authenticationRecovery: 'session-lost',
      ownerEpoch: null,
      canPublishMutations: false,
    });

    const session = useLibrarySession(inputs, dependencies);

    expect(session.model.identity).toMatchObject({
      owner: { id: 'owner-1' },
      authenticationRecovery: 'session-lost',
      canPublishMutations: false,
    });
    expect(dependencies.useOwnerLibrarySession).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1',
      libraryEpoch: null,
    }));
  });

  it('publishes narrow domain actions without re-wrapping them', () => {
    const { dependencies, identityActions, ownerActions } = createDependencies();
    const session = useLibrarySession(inputs, dependencies);

    expect(session.actions.identity).toEqual(identityActions);
    expect(session.actions.owner).toEqual(ownerActions);
  });

  it('passes signed-out ownership through every child session', () => {
    const { dependencies } = createDependencies(false);
    const session = useLibrarySession(inputs, dependencies);

    expect(dependencies.useOwnerLibrarySession).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: null,
      libraryEpoch: null,
    }));
    expect(dependencies.useCloudLibraryPage).toHaveBeenCalledWith(expect.objectContaining({ ownerId: null }));
    expect(session.model.identity.owner).toBeNull();
  });
});

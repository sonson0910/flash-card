import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import type { CardData } from '../../types/card';
import { EMPTY_LIBRARY_STATS } from '../librarySession/cloudLibraryPageController';
import { createInitialCardCreatorModel } from '../intake/card-creator-model';
import {
  buildLibraryScreenContract,
  createLibraryScreenContractBuilder,
  type LibraryScreenContractInput,
} from './useLibraryScreenContract';

i18n.load('en', {
  'shell.library-count.cards': '{count, plural, one {# card} other {# cards}}',
  'shell.library-count.cached-cloud': '{cached, number} cached / {cloud, number} cloud',
  'shell.library-count.cloud-paused': 'Cloud paused',
});
beforeEach(() => i18n.activate('en'));

const card = (word: string, category = 'General'): CardData => ({
  id: `word-${word}`,
  word,
  normalizedWord: word,
  translation: `${word}-vi`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category,
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-08-03T00:00:00.000Z',
  difficulty: 'easy',
});

const createInput = () => {
  const apple = card('apple', 'Food');
  const catalogActions = {
    replaceQuery: vi.fn(), changeSearch: vi.fn(), chooseCategory: vi.fn(), chooseDeck: vi.fn(),
    chooseDifficulty: vi.fn(), choosePartOfSpeech: vi.fn(), chooseDate: vi.fn(),
    toggleStarred: vi.fn(), goToPage: vi.fn(), goToNextPage: vi.fn(), goToPreviousPage: vi.fn(),
  };
  const sessionActions = {
    identity: { signIn: vi.fn(), signOut: vi.fn(), clearError: vi.fn(), acceptVerifiedOwnerEpoch: vi.fn() },
    owner: {
      migrateLegacy: vi.fn(async () => ({
        status: 'completed' as const,
        migrated: 2,
        scanned: 2,
        complete: true,
      })),
    },
  };
  const intakeActions = {
    cardCreator: {
      open: vi.fn(), updateDraft: vi.fn(), updatePreview: vi.fn(), createManualDraft: vi.fn(), cancel: vi.fn(),
      generatePreview: vi.fn(async () => ({ status: 'busy' as const })),
      regenerate: vi.fn(async () => ({ status: 'busy' as const })),
      save: vi.fn(async () => ({ status: 'busy' as const })),
    },
    changeDraft: vi.fn(), clearDraft: vi.fn(), generate: vi.fn(async () => ({ status: 'busy' as const })),
    importFile: vi.fn(async () => ({ status: 'missing' as const })), shareCategory: vi.fn(async () => ({ status: 'invalid' as const })),
    acceptShared: vi.fn(async () => ({ status: 'missing' as const })), cancelShared: vi.fn(),
    revokeShare: vi.fn(), dismissShareLink: vi.fn(), showShareDialog: vi.fn(),
    clearShareError: vi.fn(), clearError: vi.fn(), clearNotice: vi.fn(), invalidateCard: vi.fn(),
  };
  const learningActions = {
    toggleBookmark: vi.fn(async () => undefined), assignDeck: vi.fn(async () => undefined),
    reviewCard: vi.fn(async () => ({ status: 'published' as const, result: {} as never })),
    updateCard: vi.fn(async () => ({ status: 'published' as const, result: {} as never })),
    deleteCard: vi.fn(async () => undefined), clearLibrary: vi.fn(async () => undefined),
  };
  const commands = {
    startStudy: vi.fn(async () => undefined),
    openCardCreator: vi.fn(),
    openPaths: vi.fn(),
    changeNewDeckInput: vi.fn(),
    createCustomDeck: vi.fn(async () => undefined),
    deleteCustomDeck: vi.fn(async () => undefined),
  };
  const input: LibraryScreenContractInput = {
    workspace: {
      catalog: {
        model: {
          search: '', debouncedSearch: '', category: 'All', deck: 'All', difficulty: 'All',
          partOfSpeech: 'All', starred: false, date: 'All', page: 1,
        },
        actions: catalogActions,
      },
      session: {
        model: {
          identity: {
            status: 'authenticated',
            owner: { id: 'owner-1', displayName: 'Learner', email: null, photoUrl: null },
            ownerEpoch: { ownerId: 'owner-1', value: 3 },
            canPublishMutations: true,
            isSigningIn: false,
            isSigningOut: false,
            authenticationRecovery: null,
            error: null,
          },
          owner: {
            ownerId: 'owner-1', decks: ['IELTS'], legacyPending: 2,
            legacyIssue: null, isMigratingLegacy: false, status: 'ready', error: null,
          },
          cloud: {
            ownerId: 'owner-1', queryKey: 'all', page: 1, items: [apple], total: 4,
            hasNext: false, isLoading: false, cloudUnavailable: false, error: null,
            stats: { ...EMPTY_LIBRARY_STATS, total: 4, easy: 3, due: 1 },
            isStatsLoading: false, facets: { Food: 4 }, facetsComplete: true,
          },
        },
        actions: sessionActions,
      },
      intake: {
        model: {
          draft: 'pear', importProgress: null, importResult: null, error: null, notice: null, isBusy: false,
          cardCreator: createInitialCardCreatorModel(),
          isSubmitting: false, isImporting: false, isAdoptingSharedDeck: false,
          share: {
            error: null, isLoading: false, isShareDialogOpen: false, activeShareId: null,
            shareLink: null, shareWarning: null, outgoingPreview: null, incomingPreview: null, expiresAt: null,
          },
        },
        actions: intakeActions,
      },
      learning: { actions: learningActions },
    },
    library: {
      cards: [apple], knownTotal: 4, usesCloudPagination: true, customDecks: ['IELTS'], pageSize: 9,
    },
    gamification: { streak: 5, level: 3, xp: 240, xpHistory: { 'Aug 3, 2026': 20 } },
    ui: {
      isLibraryBusy: false, newDeckInput: 'Week 1',
    },
    commands,
  };
  return { input, apple, catalogActions, sessionActions, intakeActions, learningActions, commands };
};

describe('library screen contract', () => {
  it('is a compact presentation boundary without setters or vendor imports', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useLibraryScreenContract.ts', import.meta.url)),
      'utf8',
    );
    const { input } = createInput();
    const contract = buildLibraryScreenContract(input);

    expect(source).not.toMatch(/firebase|Firestore|QueryDocumentSnapshot|Dispatch|SetStateAction/i);
    expect(Object.keys(contract)).toEqual(['model', 'actions', 'navigation', 'overlays']);
    expect(JSON.stringify(Object.keys(contract.actions))).not.toMatch(/set[A-Z]/);
  });

  it('uses LibraryViewModel to map workspace state into screen and derived navigation fields', () => {
    const { input, apple } = createInput();
    const contract = buildLibraryScreenContract(input);

    expect(contract.model).toMatchObject({
      isAuthenticated: true,
      overview: { total: 4, due: 1, mastered: 3, streak: 5, level: 3, xp: 240, canStudy: true },
      grid: { filteredCards: [apple], paginatedCards: [apple], legacyCardsPending: 2, legacyIssue: null, libraryCount: 4 },
      tools: {
        wordInput: 'pear', isGenerating: false, isImporting: false, importResult: null,
        newDeckInput: 'Week 1', categoryCounts: { All: 4, Food: 4 },
      },
    });
    expect(contract.navigation).toEqual({
      canUseVisibleLibrary: true,
      practiceLibraryCount: 4,
      libraryCountLabel: '4 cards',
    });
    expect(contract.overlays).toMatchObject({ visibleLibraryCount: 1, stats: { total: 4, dueToday: 1 } });
  });

  it('publishes truthful signed-out access for protected production AI generation', () => {
    const { input } = createInput();
    input.workspace.session.model.identity = {
      ...input.workspace.session.model.identity,
      status: 'anonymous',
      owner: null,
      ownerEpoch: null,
      canPublishMutations: false,
    };
    input.ui.aiGenerationRuntime = 'protected-production';

    const contract = buildLibraryScreenContract(input);

    expect(contract.model.tools.generationAccess).toEqual({
      available: false,
      reason: 'authentication-required',
      message: 'Sign in to generate smart cards.',
    });
  });

  it('keeps global sync feedback out of the library content contract', () => {
    const { input } = createInput();

    const contract = buildLibraryScreenContract(input);

    expect('sync' in contract.model).toBe(false);
    expect('retrySync' in contract.actions).toBe(false);
  });

  it('adapts domain actions to UI events and active catalog context', async () => {
    const { input, catalogActions, sessionActions, intakeActions, learningActions, commands } = createInput();
    input.workspace.catalog.model.category = 'IELTS';
    const contract = buildLibraryScreenContract(input);
    const preventDefault = vi.fn();
    const file = { name: 'cards.xlsx' } as File;

    await contract.actions.tools.generateCard({ preventDefault } as never);
    contract.actions.tools.importCards({ target: { files: [file] } } as never);
    await contract.actions.grid.shareCategory();
    await contract.actions.grid.migrateLegacyCards();
    contract.actions.grid.clearFilters();
    await contract.actions.grid.deleteCard('word-apple');

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(commands.openCardCreator).toHaveBeenCalledOnce();
    expect(intakeActions.cardCreator.generatePreview).toHaveBeenCalledOnce();
    expect(commands.openCardCreator.mock.invocationCallOrder[0]).toBeLessThan(intakeActions.cardCreator.generatePreview.mock.invocationCallOrder[0]);
    expect(intakeActions.generate).not.toHaveBeenCalled();
    expect(intakeActions.importFile).toHaveBeenCalledWith(file);
    expect(intakeActions.shareCategory).toHaveBeenCalledWith('IELTS');
    expect(sessionActions.owner.migrateLegacy).toHaveBeenCalledOnce();
    expect(catalogActions.replaceQuery).toHaveBeenCalledWith(expect.objectContaining({ category: 'All', page: 1 }));
    expect(learningActions.deleteCard).toHaveBeenCalledWith('word-apple');
    expect(contract.actions.startStudy).toBe(commands.startStudy);
    contract.actions.tools.openPaths();
    expect(commands.openPaths).toHaveBeenCalledOnce();
  });

  it('reuses the full contract while immutable input groups are unchanged', () => {
    const { input } = createInput();
    const builder = createLibraryScreenContractBuilder();
    const first = builder.build(input);
    const second = builder.build({ ...input });
    expect(second).toBe(first);

    const changed = builder.build({ ...input, ui: { ...input.ui, isLibraryBusy: true } });
    expect(changed).not.toBe(first);
    expect(changed.model.tools.isLoading).toBe(true);
  });

  it('rebuilds the presentation contract when the active locale changes', () => {
    const { input } = createInput();
    const builder = createLibraryScreenContractBuilder();
    const english = builder.build(input, 'en');
    const vietnamese = builder.build(input, 'vi');

    expect(vietnamese).not.toBe(english);
    expect(builder.build(input, 'vi')).toBe(vietnamese);
  });
});

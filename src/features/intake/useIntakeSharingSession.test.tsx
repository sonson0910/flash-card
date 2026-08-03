import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { CardIntakePortOptions } from './useCardIntakePort';
import {
  useIntakeSharingSession,
  type IntakeSharingSessionActions,
  type IntakeSharingSessionModel,
} from './useIntakeSharingSession';

const card = (id: string): CardData => ({
  id,
  word: id,
  translation: `${id}-vi`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
});

const intakeOptions = (): CardIntakePortOptions => ({
  ownerId: null,
  libraryEpoch: null,
  knownLibraryTotal: 0,
  cloudStats: { total: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0 },
  cardsPerPage: 9,
  getCards: () => [],
  publishCards: vi.fn(),
  upsertDeviceCards: async () => [],
  acknowledgeDevicePending: async () => undefined,
  patchCard: async () => undefined,
  hydrateExisting: vi.fn(),
  rememberPromoted: vi.fn(),
  resetCatalog: vi.fn(),
  resetCloudPage: vi.fn(),
  updateCloudStats: vi.fn(),
  updateCloudTotal: vi.fn(),
  updateCategoryFacets: async () => undefined,
  setCloudUnavailable: vi.fn(),
  notify: vi.fn(),
  focusLibrary: vi.fn(),
  addXp: vi.fn(),
});

describe('useIntakeSharingSession', () => {
  it('composes the three hooks behind a compact vendor-free boundary', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useIntakeSharingSession.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/useCardIntakePort\(/);
    expect(source).toMatch(/useCardIntake\(/);
    expect(source).toMatch(/useSharedDeckSession\(/);
    expect(source).not.toMatch(/firebase|firestore|cardRepository|Repository/);
    expect(source).not.toMatch(/Dispatch|SetStateAction/);
  });

  it('exposes draft, file, progress, busy, feedback and share state through model/actions', async () => {
    const draft = { read: vi.fn(() => 'bonjour'), write: vi.fn(), clear: vi.fn() };
    const loadShareCards = vi.fn(async () => [card('share')]);
    let model: IntakeSharingSessionModel | null = null;
    let actions: IntakeSharingSessionActions | null = null;

    function Harness() {
      const session = useIntakeSharingSession({
        ownerKey: null,
        intake: intakeOptions(),
        draft,
        resetSpreadsheetSource: vi.fn(),
        sharing: {
          adapter: {
            load: async () => ({ cards: [] }),
            create: async () => ({ shareId: 'share-1', expiresAt: '2026-09-01T00:00:00.000Z' }),
            revoke: async () => undefined,
          },
          browser: {
            getCurrentUrl: () => 'https://example.test/library',
            replaceLocation: vi.fn(),
          },
          loadCards: loadShareCards,
        },
      });
      model = session.model;
      actions = session.actions;
      return null;
    }

    renderToStaticMarkup(<Harness />);

    expect(model).toMatchObject({
      draft: 'bonjour',
      importProgress: null,
      error: null,
      notice: null,
      isBusy: false,
      share: { isLoading: false, activeShareId: null, shareLink: null, expiresAt: null },
    });
    expect(Object.keys(actions!)).toEqual([
      'changeDraft', 'clearDraft', 'generate', 'importFile', 'shareCategory',
      'revokeShare', 'dismissShareLink', 'clearError', 'clearNotice', 'invalidateCard',
    ]);
    actions!.changeDraft('salut');
    expect(draft.write).toHaveBeenCalledWith('salut');
    actions!.clearDraft();
    expect(draft.clear).toHaveBeenCalledOnce();
    await expect(actions!.importFile(null)).resolves.toEqual({ status: 'missing' });
    await expect(actions!.shareCategory('IELTS')).resolves.toEqual({ status: 'unavailable' });
    expect(loadShareCards).toHaveBeenCalledWith('IELTS');
  });
});

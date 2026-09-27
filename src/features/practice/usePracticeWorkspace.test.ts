import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const doubles = vi.hoisted(() => ({
  gamification: vi.fn(),
  session: vi.fn(),
}));

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useRef: <T,>(initial: T) => ({ current: initial }),
}));

vi.mock('../gamification/verifiedGamificationClient', () => ({
  useVerifiedGamificationState: doubles.gamification,
}));

vi.mock('./usePracticeSession', () => ({
  usePracticeSession: doubles.session,
}));

import { createPracticePoolLoader, usePracticeWorkspace } from './usePracticeWorkspace';

const card = (id: string, nextReviewDate?: string): CardData => ({
  id,
  word: id,
  translation: `${id}-translation`,
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  nextReviewDate,
});

describe('createPracticePoolLoader', () => {
  it('bounds cloud requests and responses to fifty cards', async () => {
    const cloudCards = Array.from({ length: 60 }, (_, index) => card(`cloud-${index}`));
    const source = { load: vi.fn(async () => cloudCards) };
    const load = createPracticePoolLoader({
      ownerId: 'owner-1',
      cloudBackoffActive: false,
      cards: [],
      source,
      targetLanguage: 'en',
      reportError: vi.fn(),
    });

    const result = await load(500, true);

    expect(source.load).toHaveBeenCalledWith('owner-1', 50, { includeFuture: true, targetLanguage: 'en' });
    expect(result).toHaveLength(50);
  });

  it('falls back to a bounded due-only local queue when cloud loading fails', async () => {
    const reportError = vi.fn();
    const due = card('due', '2020-01-01T00:00:00.000Z');
    const future = { ...card('future', '2999-01-01T00:00:00.000Z'), difficulty: 'good' as const };
    const source = {
      load: vi.fn(async () => { throw new Error('offline'); }),
      classifyFailure: vi.fn(() => 'quota' as const),
    };
    const load = createPracticePoolLoader({
      ownerId: 'owner-1',
      cloudBackoffActive: false,
      cards: [due, future],
      source,
      targetLanguage: 'en',
      reportError,
    });

    const result = await load(1, false);

    expect(result).toEqual([due]);
    expect(reportError).toHaveBeenCalledWith(
      'The cloud read quota has been reached. Practice is using cards cached on this device.',
    );
  });

  it('uses local cards without contacting cloud for anonymous or backed-off sessions', async () => {
    const source = { load: vi.fn(async () => [card('cloud')]) };
    const local = card('local');
    const anonymousLoad = createPracticePoolLoader({
      ownerId: null,
      cloudBackoffActive: false,
      cards: [local],
      source,
      targetLanguage: 'en',
      reportError: vi.fn(),
    });
    const backedOffLoad = createPracticePoolLoader({
      ownerId: 'owner-1',
      cloudBackoffActive: true,
      cards: [local],
      source,
      targetLanguage: 'en',
      reportError: vi.fn(),
    });

    expect(await anonymousLoad()).toEqual([local]);
    expect(await backedOffLoad()).toEqual([local]);
    expect(source.load).not.toHaveBeenCalled();
  });

  it('keeps unscheduled legacy and unrated cards in a due-or-new local practice queue', async () => {
    const newCard = { ...card('new'), difficulty: 'unrated' as const };
    const legacy = { ...card('legacy'), difficulty: 'good' as const };
    const future = { ...card('future', '2999-01-01T00:00:00.000Z'), difficulty: 'good' as const };
    const load = createPracticePoolLoader({
      ownerId: null,
      cloudBackoffActive: false,
      cards: [newCard, legacy, future],
      source: null,
      targetLanguage: 'en',
      reportError: vi.fn(),
    });

    await expect(load(50, false)).resolves.toEqual([newCard, legacy]);
  });
});

describe('usePracticeWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes one compact model/action contract and keeps controller internals private', () => {
    const commands = { startStudy: vi.fn() };
    const snapshot = { getCards: vi.fn(() => []) };
    const session = { mode: 'library', commands, snapshot };
    const gamification = { streak: 2, xp: 320, xpHistory: {}, level: 2, acceptAuthoritativeOutcome: vi.fn(), equipFrame: vi.fn() };
    doubles.session.mockReturnValue(session);
    doubles.gamification.mockReturnValue(gamification);
    const learning = {
      reviewCard: vi.fn(async () => ({ status: 'published' as const, result: {} as never })),
      toggleBookmark: vi.fn(),
      assignDeck: vi.fn(),
      updateCard: vi.fn(),
    };
    const languageProfile = {
      id: 'en-vi',
      source: { code: 'en', displayName: 'English' },
      target: { code: 'vi', displayName: 'Vietnamese' },
      speechLocale: 'en-US',
      normalize: (value: unknown) => String(value),
    };

    const workspace = usePracticeWorkspace({
      mode: 'library',
      openView: vi.fn(),
      ownerId: 'owner-1',
      cloudBackoffActive: false,
      cards: [card('local')],
      poolSource: null,
      gamificationDatabase: null,
      learning,
      languageProfile,
      reportError: vi.fn(),
    });

    expect(workspace).toEqual({
      model: {
        session: {
          mode: session.mode,
          study: undefined,
          quiz: undefined,
          learning: undefined,
        },
        gamification,
      },
      actions: commands,
      ports: { loadPracticePool: expect.any(Function) },
      snapshotRef: { current: snapshot },
    });
    expect(workspace.model.session).not.toHaveProperty('commands');
    expect(workspace.model.session).not.toHaveProperty('snapshot');
    expect(doubles.session).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1',
      learning,
      onAuthoritativeOutcome: expect.any(Function),
      languageProfile,
    }));
    expect(doubles.gamification).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1',
      database: null,
    }));

    const onAuthoritativeOutcome = doubles.session.mock.calls[0][0].onAuthoritativeOutcome;
    onAuthoritativeOutcome({ xp: 20, level: 1, streak: 0, events: [] }, 'op-a', 1);
    expect(gamification.acceptAuthoritativeOutcome).not.toHaveBeenCalled();
    onAuthoritativeOutcome({ xp: 20, level: 1, streak: 0, events: [] }, 'op-a', 0);
    expect(gamification.acceptAuthoritativeOutcome).toHaveBeenCalledWith({ xp: 20, level: 1, streak: 0, events: [] });
  });

  it('keeps the composition boundary free of provider and persistence vocabulary', () => {
    const source = readFileSync(new URL('./usePracticeWorkspace.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/firebase|firestore|repository|Dispatch|SetStateAction/i);
  });

  it('keeps App consumers on the workspace action surface', () => {
    const source = readFileSync(new URL('../../app/useAppLearningCoordination.ts', import.meta.url), 'utf8');

    expect(source).toContain('practiceWorkspace.actions');
    expect(source).not.toContain('practiceWorkspace.model.session.commands');
    expect(source).not.toContain('practiceSession.commands');
  });
});

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

vi.mock('../gamification/useGamification', () => ({
  useGamificationState: doubles.gamification,
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
      reportError: vi.fn(),
    });

    const result = await load(500, true);

    expect(source.load).toHaveBeenCalledWith('owner-1', 50, { includeFuture: true });
    expect(result).toHaveLength(50);
  });

  it('falls back to a bounded due-only local queue when cloud loading fails', async () => {
    const reportError = vi.fn();
    const due = card('due', '2020-01-01T00:00:00.000Z');
    const future = card('future', '2999-01-01T00:00:00.000Z');
    const source = {
      load: vi.fn(async () => { throw new Error('offline'); }),
      classifyFailure: vi.fn(() => 'quota' as const),
    };
    const load = createPracticePoolLoader({
      ownerId: 'owner-1',
      cloudBackoffActive: false,
      cards: [due, future],
      source,
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
      reportError: vi.fn(),
    });
    const backedOffLoad = createPracticePoolLoader({
      ownerId: 'owner-1',
      cloudBackoffActive: true,
      cards: [local],
      source,
      reportError: vi.fn(),
    });

    expect(await anonymousLoad()).toEqual([local]);
    expect(await backedOffLoad()).toEqual([local]);
    expect(source.load).not.toHaveBeenCalled();
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
    const gamification = { streak: 2, xp: 320, xpHistory: {}, level: 2, addXp: vi.fn() };
    doubles.session.mockReturnValue(session);
    doubles.gamification.mockReturnValue(gamification);
    const learning = {
      reviewCard: vi.fn(async () => undefined),
      toggleBookmark: vi.fn(),
      assignDeck: vi.fn(),
      updateCard: vi.fn(),
    };
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
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
      gamificationStore: null,
      gamificationStorage: storage,
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
      snapshotRef: { current: snapshot },
    });
    expect(workspace.model.session).not.toHaveProperty('commands');
    expect(workspace.model.session).not.toHaveProperty('snapshot');
    expect(doubles.session).toHaveBeenCalledWith(expect.objectContaining({
      learning,
      addXp: gamification.addXp,
      languageProfile,
    }));
    expect(doubles.gamification).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1',
      cloudBackoffActive: false,
      store: null,
      storage,
    }));
  });

  it('keeps the composition boundary free of provider and persistence vocabulary', () => {
    const source = readFileSync(new URL('./usePracticeWorkspace.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/firebase|firestore|repository|Dispatch|SetStateAction/i);
  });

  it('keeps App consumers on the workspace action surface', () => {
    const source = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('practiceWorkspace.actions');
    expect(source).not.toContain('practiceWorkspace.model.session.commands');
    expect(source).not.toContain('practiceSession.commands');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { createLexemeId } from '../multilingual/lexemeIdentity';

type EffectRecord = {
  cleanup?: () => void;
  dependencies?: readonly unknown[];
};

type PendingEffect = {
  callback: () => void | (() => void);
  dependencies?: readonly unknown[];
  index: number;
};

const hookRuntime = vi.hoisted(() => ({
  effectCursor: 0,
  effects: [] as EffectRecord[],
  pendingEffects: [] as PendingEffect[],
  refCursor: 0,
  refs: [] as Array<{ current: unknown }>,
  stateCursor: 0,
  states: [] as unknown[],
}));

const audio = vi.hoisted(() => ({
  correct: vi.fn(),
  incorrect: vi.fn(),
  word: vi.fn(),
}));
const feedbackSounds = vi.hoisted(() => ({ reward: vi.fn(), success: vi.fn() }));

const gemini = vi.hoisted(() => ({
  generateStoryContext: vi.fn(),
}));

const practiceSessions = vi.hoisted(() => ({
  start: vi.fn(async (request: { opId: string; game: 'quiz' | 'spelling' | 'match'; cardIds: string[] }) => ({
    sessionId: request.opId,
    game: request.game,
    challenge: request.game === 'quiz'
      ? { kind: 'quiz' as const, questions: request.cardIds.map(cardId => ({ cardId, prompt: cardId.replace('card-', 'word-'), options: [cardId.replace('card-', 'translation-')] })) }
      : request.game === 'spelling'
        ? { kind: 'spelling' as const, prompts: request.cardIds.map(cardId => ({ cardId, prompt: cardId.replace('card-', 'translation-'), word: cardId.replace('card-', 'word-') })) }
        : { kind: 'match' as const, cards: request.cardIds.map(cardId => ({ cardId, word: cardId.replace('card-', 'word-'), translation: cardId.replace('card-', 'translation-') })) },
    expiresAt: '2026-09-27T00:00:00.000Z',
  })),
  complete: vi.fn(async (request: { sessionId: string }) => ({
    sessionId: request.sessionId,
    correct: 4,
    total: 4,
    awardedXp: 20,
    outcome: { xp: 20, level: 1, streak: 0, studyDay: '2026-09-27', events: ['levelup'] as const },
  })),
}));

const dependenciesChanged = (
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
) => previous === undefined
  || next === undefined
  || previous.length !== next.length
  || previous.some((value, index) => !Object.is(value, next[index]));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useEffect: (callback: () => void | (() => void), dependencies?: readonly unknown[]) => {
      const index = hookRuntime.effectCursor++;
      if (dependenciesChanged(hookRuntime.effects[index]?.dependencies, dependencies)) {
        hookRuntime.pendingEffects.push({ callback, dependencies, index });
      }
    },
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(initial: T) => {
      const index = hookRuntime.refCursor++;
      if (!(index in hookRuntime.refs)) hookRuntime.refs[index] = { current: initial };
      return hookRuntime.refs[index] as { current: T };
    },
    useState: <T,>(initial: T | (() => T)) => {
      const index = hookRuntime.stateCursor++;
      if (!(index in hookRuntime.states)) {
        hookRuntime.states[index] = typeof initial === 'function'
          ? (initial as () => T)()
          : initial;
      }
      const setState = (next: T | ((previous: T) => T)) => {
        const previous = hookRuntime.states[index] as T;
        hookRuntime.states[index] = typeof next === 'function'
          ? (next as (value: T) => T)(previous)
          : next;
      };
      return [hookRuntime.states[index] as T, setState] as const;
    },
  };
});

vi.mock('../../lib/audio', () => ({
  playCorrectSound: audio.correct,
  playIncorrectSound: audio.incorrect,
  playWordAudio: audio.word,
}));
vi.mock('../courses/CourseGate', () => ({
  useCourseSession: () => ({ model: { activeCourse: null } }),
}));
vi.mock('../../lib/interactionSounds', () => ({
  playRewardSound: feedbackSounds.reward,
  playSuccessSound: feedbackSounds.success,
}));

vi.mock('../../lib/gemini', () => ({
  generateStoryContext: gemini.generateStoryContext,
}));

vi.mock('./practiceSessionService', () => ({
  firebasePracticeSessionService: practiceSessions,
  practiceTimeZone: () => 'Asia/Ho_Chi_Minh',
}));

import { usePracticeSession } from './usePracticeSession';

const card = (index: number): CardData => ({
  id: `card-${index}`,
  word: `word-${index}`,
  translation: `translation-${index}`,
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  difficulty: 'good',
});

const canonicalCard = (index: number, language = 'en'): CardData => {
  const normalizedLemma = `word-${index}`;
  const partOfSpeech = 'noun';
  const senseKey = `sense-${index}`;
  return {
    ...card(index),
    language,
    normalizedLemma,
    partOfSpeech,
    senseKey,
    lexemeId: createLexemeId({ language, normalizedLemma, partOfSpeech, senseKey }),
  };
};

const flushEffects = () => {
  const pending = hookRuntime.pendingEffects.splice(0);
  pending.forEach(({ callback, dependencies, index }) => {
    hookRuntime.effects[index]?.cleanup?.();
    const cleanup = callback();
    hookRuntime.effects[index] = {
      dependencies,
      cleanup: typeof cleanup === 'function' ? cleanup : undefined,
    };
  });
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
};

type SessionOptions = Parameters<typeof usePracticeSession>[0] & {
  ownerId: string | null;
};

const createSessionHarness = (pool: CardData[]) => {
  const openView = vi.fn();
  const onEmptyStudy = vi.fn();
  const learning = {
    reviewCard: vi.fn(async () => ({ status: 'published' as const, result: { xpAwarded: 2 } as never })),
    toggleBookmark: vi.fn(),
    assignDeck: vi.fn(),
    updateCard: vi.fn(),
  };
  let options: SessionOptions = {
    ownerId: 'owner-a',
    mode: 'library',
    openView,
    loadPracticePool: vi.fn(async () => pool),
    languageDrillCards: pool,
    languageDrillScopeKey: 'owner-a:en',
    learning,
    languageProfile: {
      id: 'en-vi',
      source: { code: 'en', displayName: 'English' },
      target: { code: 'vi', displayName: 'Vietnamese' },
      speechLocale: 'en-US',
      normalize: (value: unknown) => typeof value === 'string'
        ? value.trim().toLocaleLowerCase()
        : '',
    },
    onAuthoritativeOutcome: vi.fn(),
    onEmptyStudy,
    reportError: vi.fn(),
  };

  const render = (overrides: Partial<SessionOptions> = {}) => {
    options = { ...options, ...overrides };
    hookRuntime.stateCursor = 0;
    hookRuntime.refCursor = 0;
    hookRuntime.effectCursor = 0;
    return usePracticeSession(options);
  };

  return { learning, onEmptyStudy, openView, render };
};

const renderAfterEffects = (render: ReturnType<typeof createSessionHarness>['render']) => {
  flushEffects();
  render();
  flushEffects();
  return render();
};

const expectEmptyPracticeState = (session: ReturnType<typeof usePracticeSession>) => {
  expect(session.study).toEqual({
    sessionKey: expect.any(Number),
    cards: [],
    index: 0,
    recallMode: 'adaptive',
    revealed: false,
    reviewedCardId: null,
    isStarting: false,
    reviewStatus: 'idle',
    reviewError: null,
    isPaused: false,
  });
  expect(session.quiz).toMatchObject({
    quizQuestions: [],
    currentQuizIndex: 0,
    selectedAnswer: null,
    answeredCorrectly: null,
    quizScore: 0,
    showQuizResults: false,
    spellingCards: [],
    currentSpellingIndex: 0,
    spellingInput: '',
    spellingChecked: false,
    spellingCorrect: false,
    spellingScore: 0,
    showSpellingResults: false,
    languageDrillCards: [],
    currentLanguageDrillIndex: 0,
    languageDrillCorrect: 0,
    showLanguageDrillResults: false,
    story: null,
    isGeneratingStory: false,
  });
  expect(session.snapshot.getCards()).toEqual([]);
};

describe('usePracticeSession owner isolation', () => {
  beforeEach(() => {
    hookRuntime.effectCursor = 0;
    hookRuntime.effects = [];
    hookRuntime.pendingEffects = [];
    hookRuntime.refCursor = 0;
    hookRuntime.refs = [];
    hookRuntime.stateCursor = 0;
    hookRuntime.states = [];
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout.bind(globalThis),
    });
    gemini.generateStoryContext.mockResolvedValue({
      story: 'A generated story.',
      translation: 'Một câu chuyện được tạo.',
    });
  });

  it('starts an ordered unit study without loading the practice pool', async () => {
    const { openView, render } = createSessionHarness([card(1)]);
    const loadPracticePool = vi.fn(async () => [card(99)]);
    const unitCards = [canonicalCard(2), canonicalCard(1)];
    let session = render({ loadPracticePool });
    flushEffects();

    await expect(session.commands.startStudyWithCards(unitCards)).resolves.toBe(true);
    session = renderAfterEffects(render);

    expect(session.study.cards).toEqual(unitCards);
    const firstSessionKey = session.study.sessionKey;
    await expect(session.commands.startStudyWithCards(unitCards)).resolves.toBe(true);
    expect(renderAfterEffects(render).study.sessionKey).toBe(firstSessionKey + 1);
    expect(openView).toHaveBeenCalledWith('study');
    expect(loadPracticePool).not.toHaveBeenCalled();
  });

  it('rejects unit study cards that exceed the cap, repeat a lexeme, or target another language', async () => {
    const { openView, render } = createSessionHarness([card(1)]);
    const reportError = vi.fn();
    let session = render({ reportError });
    flushEffects();

    await expect(session.commands.startStudyWithCards(Array.from({ length: 21 }, (_, index) => canonicalCard(index)))).resolves.toBe(false);
    await expect(session.commands.startStudyWithCards([canonicalCard(1), canonicalCard(1)])).resolves.toBe(false);
    await expect(session.commands.startStudyWithCards([canonicalCard(1, 'ko')])).resolves.toBe(false);
    session = renderAfterEffects(render);

    expect(session.study.cards).toEqual([]);
    expect(openView).not.toHaveBeenCalledWith('study');
    expect(reportError).toHaveBeenCalledTimes(3);
  });

  it('ignores a unit-study command retained across an owner or target-language change', async () => {
    const { openView, render } = createSessionHarness([card(1)]);
    let session = render();
    flushEffects();
    const staleOwnerStart = session.commands.startStudyWithCards;
    render({ ownerId: 'owner-b', languageDrillScopeKey: 'owner-b:en' });
    renderAfterEffects(render);

    await expect(staleOwnerStart([canonicalCard(1)])).resolves.toBe(false);

    session = render();
    const staleLanguageStart = session.commands.startStudyWithCards;
    const koreanProfile = {
      id: 'ko-en',
      source: { code: 'ko', displayName: 'Korean' },
      target: { code: 'en', displayName: 'English' },
      speechLocale: 'ko-KR',
      normalize: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    };
    render({ languageProfile: koreanProfile, languageDrillScopeKey: 'owner-b:ko' });
    renderAfterEffects(render);

    await expect(staleLanguageStart([canonicalCard(1)])).resolves.toBe(false);

    expect(render().study.cards).toEqual([]);
    expect(openView).not.toHaveBeenCalledWith('study');
  });

  it('does not activate unit study when its catalog scope changes during preparation', async () => {
    const { openView, render } = createSessionHarness([]);
    const session = render();
    flushEffects();
    let isCurrent = true;

    const starting = session.commands.startStudyWithCards([canonicalCard(1)], () => isCurrent);
    isCurrent = false;

    await expect(starting).resolves.toBe(false);
    expect(openView).not.toHaveBeenCalledWith('study');
  });

  it('pauses review and navigation while editing, then resumes the same revealed card', async () => {
    const { render, learning } = createSessionHarness([card(1), card(2)]);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render();
    const activeId = session.study.cards[session.study.index].id;
    session.commands.setStudyEditorOpen(activeId, true);
    session.commands.setStudyIndex(1);
    session.commands.setRecallMode('native-to-target');
    expect(await session.commands.startStudyWithCards([canonicalCard(3)])).toBe(false);
    expect(await session.commands.submitStudyRating('good')).toBe('ignored');
    expect(learning.reviewCard).not.toHaveBeenCalled();
    session = render();
    expect(session.study).toMatchObject({ index: 0, revealed: true, recallMode: 'adaptive', isPaused: true });
    session.commands.setStudyEditorOpen('another-card', false);
    expect(render().study.isPaused).toBe(true);
    session.snapshot.updateCard(activeId, { translation: 'edited meaning' });
    session.commands.setStudyEditorOpen(activeId, false);
    session = renderAfterEffects(render);
    expect(session.study).toMatchObject({ index: 0, revealed: true, recallMode: 'adaptive', isPaused: false });
    expect(session.study.cards[0]).toMatchObject({ id: activeId, translation: 'edited meaning' });
    expect(await session.commands.submitStudyRating('good')).toEqual({ status: 'committed', xpAwarded: 2 });
    expect(learning.reviewCard).toHaveBeenCalledWith(activeId, 'good', expect.any(String));
  });

  it('ignores an editor from a replaced owner session', async () => {
    const { render } = createSessionHarness([card(1)]);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    const staleEditor = session.commands.setStudyEditorOpen;
    staleEditor(session.study.cards[0].id, true);
    render({ ownerId: 'owner-b' });
    session = renderAfterEffects(render);
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    staleEditor(session.study.cards[0].id, true);
    expect(render().study.isPaused).toBe(false);
  });

  it('clamps to a remaining Study card and exits after the final card is removed', async () => {
    const { onEmptyStudy, openView, render } = createSessionHarness([card(1), card(2)]);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.setStudyIndex(1);
    session = renderAfterEffects(render);

    session.snapshot.removeCard('card-2');
    session = renderAfterEffects(render);
    expect(session.study).toMatchObject({ index: 0, cards: [expect.objectContaining({ id: 'card-1' })] });

    session.snapshot.removeCard('card-1');
    session = renderAfterEffects(render);
    expect(session.study.cards).toEqual([]);
    expect(openView).toHaveBeenLastCalledWith('library');
    expect(onEmptyStudy).toHaveBeenCalledOnce();
  });

  it('uses the active course pair for stories despite stale card translation metadata', async () => {
    const pool = [
      { ...card(1), language: 'ko', translationLanguage: 'en' },
      { ...card(2), language: 'ko', translationLanguage: 'vi' },
      { ...card(3), language: 'en', translationLanguage: 'vi' },
    ];
    const koreanProfile = {
      id: 'ko-vi',
      source: { code: 'ko', displayName: 'Korean' },
      target: { code: 'vi', displayName: 'Vietnamese' },
      speechLocale: 'ko-KR',
      normalize: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    };
    const { render } = createSessionHarness(pool);
    let session = render({ languageProfile: koreanProfile, languageDrillScopeKey: 'owner-a:ko' });
    flushEffects();

    await session.commands.generateStory();
    session = render();

    expect(gemini.generateStoryContext).toHaveBeenCalledWith(
      expect.arrayContaining(['word-1', 'word-2']),
      { targetLanguage: 'ko', translationLanguage: 'vi' },
    );
    expect(session.quiz.story).toMatchObject({ language: 'ko', translationLanguage: 'vi' });
  });

  it('cancels a pending story and returns to the library when the meaning language changes', async () => {
    const koreanVi = {
      id: 'ko-vi', source: { code: 'ko', displayName: 'Korean' }, target: { code: 'vi', displayName: 'Vietnamese' },
      speechLocale: 'ko-KR', normalize: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    };
    const koreanEn = { ...koreanVi, id: 'ko-en', target: { code: 'en', displayName: 'English' } };
    const pendingStory = deferred<{ story: string; translation: string }>();
    gemini.generateStoryContext.mockReturnValueOnce(pendingStory.promise);
    const pool = [1, 2, 3, 4].map(index => ({ ...card(index), language: 'ko', translationLanguage: 'vi' }));
    const { openView, render } = createSessionHarness(pool);
    let session = render({ mode: 'story', languageProfile: koreanVi, languageDrillScopeKey: 'owner-a:ko:vi' });
    flushEffects();

    const generation = session.commands.generateStory();
    for (let attempt = 0; attempt < 10 && gemini.generateStoryContext.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(gemini.generateStoryContext).toHaveBeenCalledOnce();

    render({ mode: 'story', languageProfile: koreanEn, languageDrillScopeKey: 'owner-a:ko:en' });
    session = renderAfterEffects(render);
    pendingStory.resolve({ story: 'A stale Korean story.', translation: 'Một bản dịch cũ.' });
    await generation;
    session = renderAfterEffects(render);

    expect(openView).toHaveBeenLastCalledWith('library');
    expect(session.quiz).toMatchObject({ story: null, storyError: null, isGeneratingStory: false });
  });

  it('does not start Gemini for a pending Story pool after only the meaning language changes', async () => {
    const koreanVi = {
      id: 'ko-vi', source: { code: 'ko', displayName: 'Korean' }, target: { code: 'vi', displayName: 'Vietnamese' },
      speechLocale: 'ko-KR', normalize: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    };
    const koreanEn = { ...koreanVi, id: 'ko-en', target: { code: 'en', displayName: 'English' } };
    const pendingPool = deferred<CardData[]>();
    const pool = [1, 2, 3, 4].map(index => ({ ...card(index), language: 'ko', translationLanguage: 'vi' }));
    const { render } = createSessionHarness([]);
    let session = render({
      mode: 'story', languageProfile: koreanVi, languageDrillScopeKey: 'owner-a:ko:vi',
      loadPracticePool: vi.fn(() => pendingPool.promise),
    });
    flushEffects();

    const generation = session.commands.generateStory();
    render({ mode: 'story', languageProfile: koreanEn, languageDrillScopeKey: 'owner-a:ko:en' });
    pendingPool.resolve(pool);
    await generation;
    session = renderAfterEffects(render);

    expect(gemini.generateStoryContext).not.toHaveBeenCalled();
    expect(session.quiz).toMatchObject({ story: null, storyError: null, isGeneratingStory: false });
  });

  it('clears a rendered story and returns to the library when only the meaning language changes', async () => {
    const koreanVi = {
      id: 'ko-vi', source: { code: 'ko', displayName: 'Korean' }, target: { code: 'vi', displayName: 'Vietnamese' },
      speechLocale: 'ko-KR', normalize: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    };
    const koreanEn = { ...koreanVi, id: 'ko-en', target: { code: 'en', displayName: 'English' } };
    const pool = [1, 2, 3, 4].map(index => ({ ...card(index), language: 'ko', translationLanguage: 'vi' }));
    const { openView, render } = createSessionHarness(pool);
    let session = render({ mode: 'story', languageProfile: koreanVi, languageDrillScopeKey: 'owner-a:ko:vi' });
    flushEffects();

    await session.commands.generateStory();
    session = renderAfterEffects(render);
    expect(session.quiz.story).toMatchObject({ language: 'ko', translationLanguage: 'vi' });

    render({ mode: 'story', languageProfile: koreanEn, languageDrillScopeKey: 'owner-a:ko:en' });
    session = renderAfterEffects(render);

    expect(openView).toHaveBeenLastCalledWith('library');
    expect(session.quiz).toMatchObject({ story: null, storyError: null, isGeneratingStory: false });
  });

  it.each(['quiz', 'spelling', 'match'] as const)('clears an active %s game when the meaning language changes', async game => {
    const koreanVi = {
      id: 'ko-vi', source: { code: 'ko', displayName: 'Korean' }, target: { code: 'vi', displayName: 'Vietnamese' },
      speechLocale: 'ko-KR', normalize: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    };
    const koreanEn = { ...koreanVi, id: 'ko-en', target: { code: 'en', displayName: 'English' } };
    const pool = [1, 2, 3, 4].map(index => ({ ...card(index), language: 'ko', translationLanguage: 'vi' }));
    const { render } = createSessionHarness(pool);
    let session = render({ languageProfile: koreanVi, languageDrillScopeKey: 'owner-a:ko' });
    flushEffects();

    if (game === 'quiz') await session.commands.startQuiz();
    else if (game === 'spelling') await session.commands.startSpelling();
    else await session.commands.startMatch();
    session = renderAfterEffects(render);
    expect(game === 'quiz' ? session.quiz.quizQuestions : session.quiz.spellingCards).toHaveLength(4);

    render({ languageProfile: koreanEn, languageDrillScopeKey: 'owner-a:ko' });
    session = renderAfterEffects(render);

    expect(session.quiz.quizQuestions).toEqual([]);
    expect(session.quiz.spellingCards).toEqual([]);
  });

  it.each(['quiz', 'spelling', 'match'] as const)('returns an active %s route to the library when its pair changes', async game => {
    const koreanVi = {
      id: 'ko-vi', source: { code: 'ko', displayName: 'Korean' }, target: { code: 'vi', displayName: 'Vietnamese' },
      speechLocale: 'ko-KR', normalize: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    };
    const koreanEn = { ...koreanVi, id: 'ko-en', target: { code: 'en', displayName: 'English' } };
    const pool = [1, 2, 3, 4].map(index => ({ ...card(index), language: 'ko', translationLanguage: 'vi' }));
    const { openView, render } = createSessionHarness(pool);
    let session = render({ mode: game, languageProfile: koreanVi, languageDrillScopeKey: 'owner-a:ko' });
    flushEffects();

    if (game === 'quiz') await session.commands.startQuiz();
    else if (game === 'spelling') await session.commands.startSpelling();
    else await session.commands.startMatch();
    renderAfterEffects(render);

    render({ mode: game, languageProfile: koreanEn, languageDrillScopeKey: 'owner-a:ko' });
    session = renderAfterEffects(render);

    expect(openView).toHaveBeenLastCalledWith('library');
    expect(session.quiz.quizQuestions).toEqual([]);
    expect(session.quiz.spellingCards).toEqual([]);
  });

  it('leaves an active language drill when the meaning language changes', async () => {
    const koreanVi = {
      id: 'ko-vi', source: { code: 'ko', displayName: 'Korean' }, target: { code: 'vi', displayName: 'Vietnamese' },
      speechLocale: 'ko-KR', normalize: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    };
    const koreanEn = { ...koreanVi, id: 'ko-en', target: { code: 'en', displayName: 'English' } };
    const pool = [1, 2].map(index => ({ ...card(index), language: 'ko', translationLanguage: 'vi' }));
    const { openView, render } = createSessionHarness(pool);
    let session = render({ mode: 'language-drill', languageProfile: koreanVi, languageDrillScopeKey: 'owner-a:ko:vi' });
    flushEffects();
    await session.commands.startLanguageDrill();
    session = renderAfterEffects(render);
    expect(session.quiz.languageDrillCards).toHaveLength(2);

    session = render({ languageProfile: koreanEn, languageDrillScopeKey: 'owner-a:ko:en' });
    expect(session.quiz.languageDrillCards).toEqual([]);
    session = renderAfterEffects(render);

    expect(openView).toHaveBeenLastCalledWith('library');
    expect(session.quiz.languageDrillCards).toEqual([]);
  });

  it('keeps Study cards available when only the meaning language changes', async () => {
    const koreanVi = {
      id: 'ko-vi', source: { code: 'ko', displayName: 'Korean' }, target: { code: 'vi', displayName: 'Vietnamese' },
      speechLocale: 'ko-KR', normalize: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    };
    const koreanEn = { ...koreanVi, id: 'ko-en', target: { code: 'en', displayName: 'English' } };
    const pool = [1, 2, 3, 4].map(index => ({ ...card(index), language: 'ko', translationLanguage: 'vi' }));
    const { render } = createSessionHarness(pool);
    let session = render({ languageProfile: koreanVi, languageDrillScopeKey: 'owner-a:ko' });
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);

    render({ languageProfile: koreanEn, languageDrillScopeKey: 'owner-a:ko' });
    session = renderAfterEffects(render);

    expect(session.study.cards).toHaveLength(4);
    expect(session.study.cards.every(card => card.translationLanguage === 'vi')).toBe(true);
  });

  it('masks a pending quiz completion before a pair-scope reset effect runs', async () => {
    const pending = deferred<never>();
    practiceSessions.complete.mockReturnValueOnce(pending.promise);
    const pool = [card(1), card(2), card(3), card(4)];
    const { render } = createSessionHarness(pool);
    let session = render();
    flushEffects();
    await session.commands.startQuiz();
    session = renderAfterEffects(render);
    for (let index = 0; index < session.quiz.quizQuestions.length; index += 1) {
      session.quiz.selectQuizAnswer(session.quiz.quizQuestions[session.quiz.currentQuizIndex].correctAnswer);
      session = render();
      session.quiz.nextQuizQuestion();
      session = render();
    }
    expect(session.quiz.quizCompletionSaving).toBe(true);

    const switched = render({
      languageProfile: {
        id: 'en-fr',
        source: { code: 'en', displayName: 'English' },
        target: { code: 'fr', displayName: 'French' },
        speechLocale: 'en-US',
        normalize: (value: unknown) => typeof value === 'string' ? value.trim().toLocaleLowerCase() : '',
      },
      languageDrillScopeKey: 'owner-a:en:fr',
    });
    expect(switched.quiz.quizCompletionSaving).toBe(false);
    expect(switched.quiz.spellingCompletionSaving).toBe(false);

    pending.resolve({} as never);
    await Promise.resolve();
    await Promise.resolve();
  });

  it('masks a pending spelling completion before an owner reset effect runs', async () => {
    const pending = deferred<never>();
    practiceSessions.complete.mockReturnValueOnce(pending.promise);
    const pool = [card(1), card(2), card(3), card(4)];
    const { render } = createSessionHarness(pool);
    let session = render();
    flushEffects();
    await session.commands.startSpelling();
    session = renderAfterEffects(render);
    for (let index = 0; index < session.quiz.spellingCards.length; index += 1) {
      session.quiz.setSpellingInput(session.quiz.spellingCards[session.quiz.currentSpellingIndex].word);
      session = render();
      session.quiz.checkSpelling({ preventDefault: vi.fn() } as never);
      session = render();
      session.quiz.nextSpelling();
      session = render();
    }
    expect(session.quiz.spellingCompletionSaving).toBe(true);

    const switched = render({ ownerId: 'owner-b' });
    expect(switched.quiz.quizCompletionSaving).toBe(false);
    expect(switched.quiz.spellingCompletionSaving).toBe(false);

    pending.resolve({} as never);
    await Promise.resolve();
    await Promise.resolve();
  });

  it.each([
    ['account switch', 'owner-b'],
    ['sign-out', null],
  ])('resets all study and game state on %s', async (_scenario, nextOwnerId) => {
    const pool = [card(1), card(2), card(3), card(4)];
    const { render } = createSessionHarness(pool);
    let session = render();
    flushEffects();

    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.setStudyIndex(1);
    session.commands.setRecallMode('native-to-target');
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render();
    await session.commands.submitStudyRating('good');

    await session.commands.startQuiz();
    session = renderAfterEffects(render);
    for (let index = 0; index < session.quiz.quizQuestions.length; index += 1) {
      session.quiz.selectQuizAnswer(session.quiz.quizQuestions[index].correctAnswer);
      session = render();
      session.quiz.nextQuizQuestion();
      session = render();
    }

    await session.commands.startSpelling();
    session = render();
    for (let index = 0; index < session.quiz.spellingCards.length; index += 1) {
      session.quiz.setSpellingInput(session.quiz.spellingCards[index].word);
      session = render();
      session.quiz.checkSpelling({ preventDefault: vi.fn() } as never);
      session = render();
      session.quiz.nextSpelling();
      session = render();
    }
    await Promise.resolve();
    await Promise.resolve();

    await session.commands.generateStory();
    session = render();
    expect(session.study).toMatchObject({
      index: 1,
      recallMode: 'native-to-target',
      revealed: true,
    });
    expect(session.study.cards.map(item => item.id).sort()).toEqual(pool.map(item => item.id).sort());
    expect(session.study.reviewedCardId).toBe(session.study.cards[1].id);
    expect(session.quiz).toMatchObject({
      currentQuizIndex: 3,
      selectedAnswer: expect.any(String),
      answeredCorrectly: true,
      quizScore: 4,
      showQuizResults: true,
      currentSpellingIndex: 3,
      spellingInput: expect.any(String),
      spellingChecked: true,
      spellingCorrect: true,
      spellingScore: 4,
      showSpellingResults: true,
      story: {
        story: 'A generated story.',
        translation: 'Một câu chuyện được tạo.',
      },
    });

    const firstNextOwnerRender = render({ ownerId: nextOwnerId });
    expectEmptyPracticeState(firstNextOwnerRender);

    session = renderAfterEffects(render);

    expectEmptyPracticeState(session);
  });

  it.each([
    ['study', (session: ReturnType<typeof usePracticeSession>) => session.commands.startStudy()],
    ['quiz', (session: ReturnType<typeof usePracticeSession>) => session.commands.startQuiz()],
    ['spelling', (session: ReturnType<typeof usePracticeSession>) => session.commands.startSpelling()],
    ['story', (session: ReturnType<typeof usePracticeSession>) => session.commands.generateStory()],
  ])('ignores a late owner-a practice pool while starting %s after switching to owner-b', async (
    activity,
    start,
  ) => {
    const ownerAPool = deferred<CardData[]>();
    const { openView, render } = createSessionHarness([card(9)]);
    const sessionA = render({
      ownerId: 'owner-a',
      loadPracticePool: vi.fn(() => ownerAPool.promise),
    });
    flushEffects();
    const pendingStart = start(sessionA);

    render({
      ownerId: 'owner-b',
      loadPracticePool: vi.fn(async () => [card(10), card(11), card(12), card(13)]),
    });
    renderAfterEffects(render);
    ownerAPool.resolve([card(1), card(2), card(3), card(4)]);
    await pendingStart;
    const sessionB = render();

    expect(sessionB.study.cards).toEqual([]);
    expect(sessionB.quiz.quizQuestions).toEqual([]);
    expect(sessionB.quiz.spellingCards).toEqual([]);
    expect(sessionB.quiz.story).toBeNull();
    expect(sessionB.quiz.isGeneratingStory).toBe(false);
    if (activity === 'story') {
      expect(openView).toHaveBeenCalledTimes(1);
      expect(openView).toHaveBeenCalledWith('story');
    } else {
      expect(openView).not.toHaveBeenCalledWith(activity);
    }
  });

  it('does not emit an owner-a quiz outcome to owner-b before reset effects flush', async () => {
    const pool = [card(1), card(2), card(3), card(4)];
    const ownerAOutcome = vi.fn();
    const ownerBOutcome = vi.fn();
    const { render } = createSessionHarness(pool);
    let session = render({ ownerId: 'owner-a', onAuthoritativeOutcome: ownerAOutcome });
    flushEffects();
    await session.commands.startQuiz();
    session = render();
    const ownerAAnswer = session.quiz.quizQuestions[0].correctAnswer;

    const sessionB = render({ ownerId: 'owner-b', onAuthoritativeOutcome: ownerBOutcome });
    sessionB.quiz.selectQuizAnswer(ownerAAnswer);

    expect(ownerAOutcome).not.toHaveBeenCalled();
    expect(ownerBOutcome).not.toHaveBeenCalled();
  });

  it('does not emit an owner-a spelling outcome to owner-b before reset effects flush', async () => {
    const pool = [card(1), card(2), card(3), card(4)];
    const ownerAOutcome = vi.fn();
    const ownerBOutcome = vi.fn();
    const { render } = createSessionHarness(pool);
    let session = render({ ownerId: 'owner-a', onAuthoritativeOutcome: ownerAOutcome });
    flushEffects();
    await session.commands.startSpelling();
    session = render();
    session.quiz.setSpellingInput(session.quiz.spellingCards[0].word);
    render();

    const sessionB = render({ ownerId: 'owner-b', onAuthoritativeOutcome: ownerBOutcome });
    sessionB.quiz.checkSpelling({ preventDefault: vi.fn() } as never);

    expect(ownerAOutcome).not.toHaveBeenCalled();
    expect(ownerBOutcome).not.toHaveBeenCalled();
  });

  it('does not let deferred owner-a quiz work publish, clear, or mutate the returned owner-a session', async () => {
    const stalePool = deferred<CardData[]>();
    const returnedPool = [card(10), card(11), card(12), card(13)];
    const loadPracticePool = vi.fn()
      .mockImplementationOnce(() => stalePool.promise)
      .mockResolvedValue(returnedPool);
    const onAuthoritativeOutcome = vi.fn();
    const { openView, render } = createSessionHarness([]);
    const sessionA = render({ ownerId: 'owner-a', loadPracticePool, onAuthoritativeOutcome });
    flushEffects();
    const staleStart = sessionA.commands.startQuiz();

    render({ ownerId: 'owner-b' });
    flushEffects();
    let returnedSession = render({ ownerId: 'owner-a' });
    flushEffects();

    await returnedSession.commands.startQuiz();
    returnedSession = render();
    const returnedQuestion = returnedSession.quiz.quizQuestions[0];
    expect(returnedQuestion).toBeDefined();
    expect(openView).toHaveBeenCalledTimes(1);
    expect(openView).toHaveBeenLastCalledWith('quiz');

    stalePool.resolve([card(1), card(2), card(3), card(4)]);
    await expect(staleStart).resolves.toBeUndefined();
    returnedSession = render();

    expect(returnedSession.quiz.quizQuestions.map(question => question.card.id))
      .toContain(returnedQuestion.card.id);
    expect(returnedSession.quiz.currentQuizIndex).toBe(0);
    expect(returnedSession.quiz.showQuizResults).toBe(false);
    expect(openView).toHaveBeenCalledTimes(1);
    expect(onAuthoritativeOutcome).not.toHaveBeenCalled();

    for (let index = 0; index < returnedSession.quiz.quizQuestions.length; index += 1) {
      returnedSession.quiz.selectQuizAnswer(returnedSession.quiz.quizQuestions[returnedSession.quiz.currentQuizIndex].correctAnswer);
      returnedSession = render();
      returnedSession.quiz.nextQuizQuestion();
      returnedSession = render();
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(render().quiz.showQuizResults).toBe(true);
    expect(onAuthoritativeOutcome).toHaveBeenCalledOnce();
    expect(onAuthoritativeOutcome).toHaveBeenCalledWith(
      { xp: 20, level: 1, streak: 0, studyDay: '2026-09-27', events: ['levelup'] },
      expect.stringMatching(/^practice-quiz-/), 2,
    );
  });

  it('does not let a deferred owner-a review settle into a new owner-a session', async () => {
    const persistence = deferred<{ status: 'published'; result: never }>();
    const returnedPool = [card(10)];
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard.mockImplementationOnce(() => persistence.promise);
    let sessionA = render({ ownerId: 'owner-a' });
    flushEffects();
    await sessionA.commands.startStudy();
    sessionA = renderAfterEffects(render);
    sessionA.commands.reveal();
    sessionA = render();
    const staleReview = sessionA.commands.submitStudyRating('good');
    expect(render().study.reviewStatus).toBe('saving');

    render({ ownerId: 'owner-b', loadPracticePool: vi.fn(async () => returnedPool) });
    flushEffects();
    let returnedSession = render({ ownerId: 'owner-a' });
    flushEffects();
    await returnedSession.commands.startStudy();
    returnedSession = renderAfterEffects(render);
    returnedSession.commands.reveal();
    returnedSession = render();

    persistence.resolve({ status: 'published', result: { xpAwarded: 2 } as never });
    await expect(staleReview).resolves.toBe('ignored');
    returnedSession = render();

    expect(returnedSession.study.cards.map(item => item.id)).toEqual(['card-10']);
    expect(returnedSession.study.revealed).toBe(true);
    expect(returnedSession.study.reviewedCardId).toBeNull();
    expect(returnedSession.study.reviewStatus).toBe('idle');
  });

  it('marks a review saved only after persistence settles', async () => {
    const persistence = deferred<{ status: 'published'; result: never }>();
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard.mockImplementation(() => persistence.promise);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render();

    const saving = session.commands.submitStudyRating('good');
    session = render();

    expect(session.study.reviewStatus).toBe('saving');
    expect(session.study.reviewedCardId).toBeNull();
    expect(feedbackSounds.success).not.toHaveBeenCalled();

    persistence.resolve({ status: 'published', result: { xpAwarded: 2 } as never });
    await expect(saving).resolves.toEqual({ status: 'committed', xpAwarded: 2 });
    session = render();

    expect(session.study.reviewStatus).toBe('saved');
    expect(session.study.reviewedCardId).toBe('card-1');
    expect(feedbackSounds.success).toHaveBeenCalledOnce();
  });

  it('reuses the original rating and operation when a review is retried', async () => {
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 2 } as never } as never);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render();

    await expect(session.commands.submitStudyRating('good')).resolves.toBe('retryable-error');
    await expect(session.commands.submitStudyRating('again')).resolves.toEqual({
      status: 'committed', xpAwarded: 2, rating: 'good',
    });

    const firstCall = learning.reviewCard.mock.calls[0];
    expect(firstCall).toEqual([card(1).id, 'good', expect.any(String)]);
    const firstOperationId = (firstCall as readonly unknown[])[2];
    expect(learning.reviewCard.mock.calls[1]).toEqual([card(1).id, 'good', firstOperationId]);
  });

  it('ignores an old same-owner Study result after close and reopen while the new claim is pending', async () => {
    const first = deferred<{ status: 'published'; result: never }>();
    const second = deferred<{ status: 'published'; result: never }>();
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    const stale = session.commands.submitStudyRating('good');

    session.commands.close();
    session = render({ mode: 'library' });
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    const current = session.commands.submitStudyRating('again');
    const firstCall = learning.reviewCard.mock.calls[0];
    expect(learning.reviewCard.mock.calls[1]).toEqual([card(1).id, 'good', (firstCall as readonly unknown[])[2]]);

    first.resolve({ status: 'published', result: { xpAwarded: 2 } as never });
    await expect(stale).resolves.toBe('ignored');
    expect(render({ mode: 'study' }).study.reviewStatus).toBe('saving');

    second.resolve({ status: 'published', result: { xpAwarded: 2 } as never });
    await expect(current).resolves.toEqual({ status: 'committed', xpAwarded: 2, rating: 'good' });
    expect(render({ mode: 'study' }).study.reviewStatus).toBe('saved');
  });

  it('retries the same intent after an old response is lost across close and reopen', async () => {
    const first = deferred<{ status: 'published'; result: never }>();
    const second = deferred<{ status: 'published'; result: never }>();
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    const stale = session.commands.submitStudyRating('good');
    const firstCall = learning.reviewCard.mock.calls[0];

    session.commands.close();
    session = render({ mode: 'library' });
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    const current = session.commands.submitStudyRating('again');

    expect(learning.reviewCard.mock.calls[1]).toEqual([card(1).id, 'good', (firstCall as readonly unknown[])[2]]);
    first.reject(new Error('lost response after commit'));
    await expect(stale).resolves.toBe('ignored');
    expect(render({ mode: 'study' }).study.reviewStatus).toBe('saving');

    second.resolve({ status: 'published', result: { xpAwarded: 2 } as never });
    await expect(current).resolves.toEqual({ status: 'committed', xpAwarded: 2, rating: 'good' });
    expect(render({ mode: 'study' }).study.reviewStatus).toBe('saved');
  });

  it('consumes a late confirmed result before the reopened Study claim starts', async () => {
    const first = deferred<{ status: 'published'; result: never }>();
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard.mockImplementationOnce(() => first.promise);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    const stale = session.commands.submitStudyRating('good');

    session.commands.close();
    session = render({ mode: 'library' });
    first.resolve({ status: 'published', result: { xpAwarded: 2 } as never });
    await expect(stale).resolves.toBe('ignored');

    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    await expect(session.commands.submitStudyRating('again')).resolves.toEqual({
      status: 'committed', xpAwarded: 2, rating: 'good',
    });
    expect(learning.reviewCard).toHaveBeenCalledOnce();
    expect(render({ mode: 'study' }).study.reviewStatus).toBe('saved');
  });

  it('retains a confirmed receipt through a partial pool omission', async () => {
    const first = deferred<{ status: 'published'; result: never }>();
    let pool: CardData[] = [card(1)];
    const loadPracticePool = vi.fn(async () => pool);
    const { learning, render } = createSessionHarness(pool);
    learning.reviewCard.mockImplementationOnce(() => first.promise);
    let session = render({ loadPracticePool });
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    const stale = session.commands.submitStudyRating('good');

    session.commands.close();
    session = render({ mode: 'library' });
    first.resolve({ status: 'published', result: { xpAwarded: 2 } as never });
    await expect(stale).resolves.toBe('ignored');

    pool = [card(2)];
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.close();
    session = render({ mode: 'library' });
    pool = [card(1)];
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });

    await expect(session.commands.submitStudyRating('again')).resolves.toEqual({
      status: 'committed', xpAwarded: 2, rating: 'good',
    });
    expect(learning.reviewCard).toHaveBeenCalledOnce();
  });

  it('evicts a prior receipt when an intent becomes the 101st confirmed receipt', async () => {
    const cards = Array.from({ length: 101 }, (_, index) => canonicalCard(index));
    const pendingReviews = cards.map(() => deferred<{ status: 'published'; result: never }>());
    const { learning, render } = createSessionHarness(cards);
    let reviewIndex = 0;
    learning.reviewCard.mockImplementation(() => pendingReviews[reviewIndex++].promise);
    let session = render();
    flushEffects();

    for (let start = 0; start < 100; start += 20) {
      const batch = cards.slice(start, start + 20);
      await session.commands.startStudyWithCards(batch);
      session = renderAfterEffects(render);
      const submitted = batch.map((_, index) => {
        session.commands.setStudyIndex(index);
        session = render({ mode: 'study' });
        session.commands.reveal();
        session = render({ mode: 'study' });
        return session.commands.submitStudyRating('good');
      });
      session.commands.close();
      session = render({ mode: 'library' });
      pendingReviews.slice(start, start + 20)
        .forEach(review => review.resolve({ status: 'published', result: { xpAwarded: 2 } as never }));
      await Promise.all(submitted);
    }

    await session.commands.startStudyWithCards([cards[100]]);
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    const newest = session.commands.submitStudyRating('good');
    session.commands.close();
    session = render({ mode: 'library' });
    pendingReviews[100].resolve({ status: 'published', result: { xpAwarded: 2 } as never });
    await newest;

    learning.reviewCard.mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 2 } as never });
    await session.commands.startStudyWithCards([cards[0]]);
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    await expect(session.commands.submitStudyRating('good')).resolves.toEqual({ status: 'committed', xpAwarded: 2 });
    expect(learning.reviewCard).toHaveBeenCalledTimes(102);
  });

  it('consumes a reopened activation receipt after its snapshot receives the authoritative patch', async () => {
    const first = deferred<{ status: 'published'; result: never }>();
    let pool: CardData[] = [card(1)];
    const reviewedCard: CardData = {
      ...card(1),
      reviews: 1,
      reviewHistory: [{
        rating: 'good',
        reviewedAt: '2026-10-03T00:00:00.000Z',
        scheduledDays: 1,
        elapsedDays: 0,
      }],
    };
    const loadPracticePool = vi.fn(async () => pool);
    const { learning, render } = createSessionHarness(pool);
    learning.reviewCard
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 2 } as never } as never);
    let session = render({ loadPracticePool });
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    const stale = session.commands.submitStudyRating('good');
    const firstCall = learning.reviewCard.mock.calls[0] as readonly unknown[];

    session.commands.close();
    session = render({ mode: 'library' });
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });

    session.snapshot.updateCard(reviewedCard.id, reviewedCard);
    session = render({ mode: 'study' });
    first.resolve({ status: 'published', result: { xpAwarded: 2 } as never });
    await expect(stale).resolves.toBe('ignored');
    expect(render({ mode: 'study' }).study.reviewStatus).toBe('idle');

    await expect(session.commands.submitStudyRating('again')).resolves.toEqual({
      status: 'committed', xpAwarded: 2, rating: 'good',
    });
    expect(learning.reviewCard).toHaveBeenCalledOnce();

    session.commands.close();
    session = render({ mode: 'library' });
    pool = [reviewedCard];
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    await expect(session.commands.submitStudyRating('again')).resolves.toEqual({
      status: 'committed', xpAwarded: 2,
    });
    const secondCall = learning.reviewCard.mock.calls[1] as readonly unknown[];
    expect(secondCall[1]).toBe('again');
    expect(secondCall[2]).not.toBe(firstCall[2]);
  });

  it('keeps an unresolved intent when a partial Study pool omits its card', async () => {
    let pool: CardData[] = [card(1)];
    const loadPracticePool = vi.fn(async () => pool);
    const { learning, render } = createSessionHarness(pool);
    learning.reviewCard
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 2 } as never } as never);
    let session = render({ loadPracticePool });
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    await expect(session.commands.submitStudyRating('good')).resolves.toBe('retryable-error');
    const firstCall = learning.reviewCard.mock.calls[0];

    session.commands.close();
    session = render({ mode: 'library' });
    pool = [card(2)];
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session = render({ mode: 'study' });
    session.commands.close();
    session = render({ mode: 'library' });
    pool = [card(1)];
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });

    await expect(session.commands.submitStudyRating('again')).resolves.toEqual({
      status: 'committed', xpAwarded: 2, rating: 'good',
    });
    expect(learning.reviewCard.mock.calls[1]).toEqual([card(1).id, 'good', (firstCall as readonly unknown[])[2]]);
  });

  it('starts a new operation when a confirmed card already reflects its review', async () => {
    const first = deferred<{ status: 'published'; result: never }>();
    let pool: CardData[] = [card(1)];
    const reviewedCard: CardData = {
      ...card(1),
      reviews: 1,
      reviewHistory: [{
        rating: 'good',
        reviewedAt: '2026-10-03T00:00:00.000Z',
        scheduledDays: 1,
        elapsedDays: 0,
      }],
    };
    const loadPracticePool = vi.fn(async () => pool);
    const { learning, render } = createSessionHarness(pool);
    learning.reviewCard
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 2 } as never } as never);
    let session = render({ loadPracticePool });
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    const stale = session.commands.submitStudyRating('good');
    const firstCall = learning.reviewCard.mock.calls[0];

    session.commands.close();
    session = render({ mode: 'library' });
    first.resolve({ status: 'published', result: { xpAwarded: 2 } as never });
    await expect(stale).resolves.toBe('ignored');

    pool = [reviewedCard];
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    await expect(session.commands.submitStudyRating('again')).resolves.toEqual({
      status: 'committed', xpAwarded: 2,
    });
    const secondCall = learning.reviewCard.mock.calls[1] as readonly unknown[];
    expect(secondCall[0]).toBe(card(1).id);
    expect(secondCall[1]).toBe('again');
    expect(secondCall[2]).not.toBe((firstCall as readonly unknown[])[2]);
  });

  it('retries an unresolved intent when a present card reflects a newer review', async () => {
    let pool: CardData[] = [card(1)];
    const reviewedCard: CardData = {
      ...card(1),
      reviews: 1,
      reviewHistory: [{
        rating: 'good',
        reviewedAt: '2026-10-03T00:00:00.000Z',
        scheduledDays: 1,
        elapsedDays: 0,
      }],
    };
    const loadPracticePool = vi.fn(async () => pool);
    const { learning, render } = createSessionHarness(pool);
    learning.reviewCard
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({
        status: 'review-conflict',
        result: { reviewConflictTerminal: true } as never,
      } as never)
      .mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 2 } as never } as never);
    let session = render({ loadPracticePool });
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    await expect(session.commands.submitStudyRating('good')).resolves.toBe('retryable-error');
    const firstCall = learning.reviewCard.mock.calls[0] as readonly unknown[];

    session.commands.close();
    session = render({ mode: 'library' });
    pool = [reviewedCard];
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    await expect(session.commands.submitStudyRating('again')).resolves.toBe('retryable-error');
    const secondCall = learning.reviewCard.mock.calls[1] as readonly unknown[];
    expect(secondCall).toEqual([card(1).id, 'good', firstCall[2]]);

    await expect(session.commands.submitStudyRating('again')).resolves.toEqual({
      status: 'committed', xpAwarded: 2,
    });
    const thirdCall = learning.reviewCard.mock.calls[2] as readonly unknown[];
    expect(thirdCall[0]).toBe(card(1).id);
    expect(thirdCall[1]).toBe('again');
    expect(thirdCall[2]).not.toBe(firstCall[2]);
  });

  it('keeps an adopted unresolved intent when an active card changes without its operation marker', async () => {
    const reviewedCard: CardData = {
      ...card(1),
      reviews: 1,
      reviewHistory: [{
        rating: 'good',
        reviewedAt: '2026-10-03T00:00:00.000Z',
        scheduledDays: 1,
        elapsedDays: 0,
      }],
    };
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({
        status: 'review-conflict',
        result: { reviewConflictTerminal: true } as never,
      } as never)
      .mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 2 } as never } as never);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    await expect(session.commands.submitStudyRating('good')).resolves.toBe('retryable-error');
    const firstCall = learning.reviewCard.mock.calls[0] as readonly unknown[];

    session.snapshot.updateCard(reviewedCard.id, reviewedCard);
    session = render({ mode: 'study' });
    await expect(session.commands.submitStudyRating('again')).resolves.toBe('retryable-error');
    const secondCall = learning.reviewCard.mock.calls[1] as readonly unknown[];
    expect(secondCall).toEqual([card(1).id, 'good', firstCall[2]]);

    await expect(session.commands.submitStudyRating('again')).resolves.toEqual({
      status: 'committed', xpAwarded: 2,
    });
    const thirdCall = learning.reviewCard.mock.calls[2] as readonly unknown[];
    expect(thirdCall[1]).toBe('again');
    expect(thirdCall[2]).not.toBe(firstCall[2]);
  });

  it('reuses an adopted unresolved intent when the active card carries its operation marker', async () => {
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 2, reviewRating: 'good' } as never } as never);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    await expect(session.commands.submitStudyRating('good')).resolves.toBe('retryable-error');
    const firstCall = learning.reviewCard.mock.calls[0] as readonly unknown[];
    const operationId = firstCall[2] as string;
    const reviewedCard: CardData = {
      ...card(1),
      reviews: 1,
      reviewHistory: [{
        rating: 'good',
        reviewedAt: '2026-10-03T00:00:00.000Z',
        scheduledDays: 1,
        elapsedDays: 0,
      }],
      appliedReviewOperationIds: [operationId],
    };

    session.snapshot.updateCard(reviewedCard.id, reviewedCard);
    session = render({ mode: 'study' });
    await expect(session.commands.submitStudyRating('again')).resolves.toEqual({
      status: 'committed', xpAwarded: 2, rating: 'good',
    });
    expect(learning.reviewCard.mock.calls[1]).toEqual([card(1).id, 'good', operationId]);
  });

  it('keeps an old error from clearing the reopened Study claim or changing its payload', async () => {
    const first = deferred<{ status: 'published'; result: never }>();
    const second = deferred<{ status: 'published'; result: never }>();
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    const stale = session.commands.submitStudyRating('good');
    const firstCall = learning.reviewCard.mock.calls[0];

    session.commands.close();
    session = render({ mode: 'library' });
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render({ mode: 'study' });
    const current = session.commands.submitStudyRating('again');

    first.reject(new Error('old request failed'));
    await expect(stale).resolves.toBe('ignored');
    expect(learning.reviewCard.mock.calls[1]).toEqual([card(1).id, 'good', (firstCall as readonly unknown[])[2]]);
    expect(render({ mode: 'study' }).study.reviewStatus).toBe('saving');

    second.resolve({ status: 'published', result: { xpAwarded: 0 } as never });
    await expect(current).resolves.toEqual({ status: 'committed', xpAwarded: 0, rating: 'good' });
    expect(render({ mode: 'study' }).study.reviewStatus).toBe('saved');
  });

  it('returns the server XP award and rejects a missing award', async () => {
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 0 } as never } as never)
      .mockResolvedValueOnce({ status: 'published', result: {} as never } as never);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render();

    await expect(session.commands.submitStudyRating('good')).resolves.toEqual({ status: 'committed', xpAwarded: 0 });
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render();
    await expect(session.commands.submitStudyRating('good')).resolves.toBe('retryable-error');
  });

  it('leaves a final conflict retryable without marking it committed', async () => {
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockResolvedValueOnce({ status: 'review-conflict', result: {} as never } as never)
      .mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 2 } as never } as never);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render();

    await expect(session.commands.submitStudyRating('good')).resolves.toBe('retryable-error');
    session = render();

    expect(session.study.reviewedCardId).toBeNull();
    expect(session.study.reviewStatus).toBe('error');
    expect(session.study.reviewError).toContain('Choose a rating to try again');
    expect(feedbackSounds.success).not.toHaveBeenCalled();
    await expect(session.commands.submitStudyRating('good')).resolves.toEqual({ status: 'committed', xpAwarded: 2 });
    expect(learning.reviewCard).toHaveBeenCalledTimes(2);
    expect(feedbackSounds.success).toHaveBeenCalledOnce();
  });

  it('retires a terminal conflict intent before the next Study retry', async () => {
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockResolvedValueOnce({
        status: 'review-conflict',
        result: { reviewConflictTerminal: true } as never,
      } as never)
      .mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 2 } as never } as never);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render();

    await expect(session.commands.submitStudyRating('good')).resolves.toBe('retryable-error');
    await expect(session.commands.submitStudyRating('again')).resolves.toEqual({
      status: 'committed', xpAwarded: 2,
    });

    const firstCall = learning.reviewCard.mock.calls[0] as readonly unknown[];
    const secondCall = learning.reviewCard.mock.calls[1] as readonly unknown[];
    expect(secondCall[1]).toBe('again');
    expect(secondCall[2]).not.toBe(firstCall[2]);
  });

  it('leaves a final persistence error retryable without marking it committed', async () => {
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockRejectedValueOnce(new Error('permanent failure'))
      .mockResolvedValueOnce({ status: 'published', result: { xpAwarded: 2 } as never } as never);
    let session = render();
    flushEffects();
    await session.commands.startStudy();
    session = renderAfterEffects(render);
    session.commands.reveal();
    session = render();

    await expect(session.commands.submitStudyRating('good')).resolves.toBe('retryable-error');
    session = render();

    expect(session.study.reviewedCardId).toBeNull();
    expect(session.study.reviewStatus).toBe('error');
    await expect(session.commands.submitStudyRating('good')).resolves.toEqual({ status: 'committed', xpAwarded: 2 });
    expect(learning.reviewCard).toHaveBeenCalledTimes(2);
  });
});

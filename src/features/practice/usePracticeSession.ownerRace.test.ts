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

vi.mock('react', () => ({
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
}));

vi.mock('../../lib/audio', () => ({
  playCorrectSound: audio.correct,
  playIncorrectSound: audio.incorrect,
  playWordAudio: audio.word,
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
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
};

type SessionOptions = Parameters<typeof usePracticeSession>[0] & {
  ownerId: string | null;
};

const createSessionHarness = (pool: CardData[]) => {
  const openView = vi.fn();
  const learning = {
    reviewCard: vi.fn(async () => ({ status: 'published' as const, result: {} as never })),
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
    reportError: vi.fn(),
  };

  const render = (overrides: Partial<SessionOptions> = {}) => {
    options = { ...options, ...overrides };
    hookRuntime.stateCursor = 0;
    hookRuntime.refCursor = 0;
    hookRuntime.effectCursor = 0;
    return usePracticeSession(options);
  };

  return { learning, openView, render };
};

const renderAfterEffects = (render: ReturnType<typeof createSessionHarness>['render']) => {
  flushEffects();
  render();
  flushEffects();
  return render();
};

const expectEmptyPracticeState = (session: ReturnType<typeof usePracticeSession>) => {
  expect(session.study).toEqual({
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
    expect(await session.commands.submitStudyRating('good')).toBe('committed');
    expect(learning.reviewCard).toHaveBeenCalledWith(activeId, 'good');
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

    while (!returnedSession.quiz.showQuizResults) {
      returnedSession.quiz.selectQuizAnswer(returnedSession.quiz.quizQuestions[returnedSession.quiz.currentQuizIndex].correctAnswer);
      returnedSession = render();
      returnedSession.quiz.nextQuizQuestion();
      returnedSession = render();
    }
    await Promise.resolve();
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

    persistence.resolve({ status: 'published', result: {} as never });
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

    persistence.resolve({ status: 'published', result: {} as never });
    await expect(saving).resolves.toBe('committed');
    session = render();

    expect(session.study.reviewStatus).toBe('saved');
    expect(session.study.reviewedCardId).toBe('card-1');
  });

  it('leaves a final conflict retryable without marking it committed', async () => {
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockResolvedValueOnce({ status: 'review-conflict', result: {} as never } as never)
      .mockResolvedValueOnce({ status: 'published', result: {} as never } as never);
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
    await expect(session.commands.submitStudyRating('good')).resolves.toBe('committed');
    expect(learning.reviewCard).toHaveBeenCalledTimes(2);
  });

  it('leaves a final persistence error retryable without marking it committed', async () => {
    const { learning, render } = createSessionHarness([card(1)]);
    learning.reviewCard
      .mockRejectedValueOnce(new Error('permanent failure'))
      .mockResolvedValueOnce({ status: 'published', result: {} as never } as never);
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
    await expect(session.commands.submitStudyRating('good')).resolves.toBe('committed');
    expect(learning.reviewCard).toHaveBeenCalledTimes(2);
  });
});

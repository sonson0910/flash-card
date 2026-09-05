import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

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

const storyResult = {
  title: 'A generated story',
  segments: [
    { english: 'A generated scene.', vietnamese: 'Một cảnh được tạo.' },
    { english: 'The lesson continues.', vietnamese: 'Bài học tiếp tục.' },
  ],
  comprehension: {
    question: 'What continues?',
    options: ['The lesson', 'The rain', 'The train'],
    correctIndex: 0 as const,
    explanationVi: 'Bài học tiếp tục.',
  },
  grammar: {
    label: 'Past simple',
    explanationVi: 'Dùng thì quá khứ đơn.',
    sourceSentence: 'The lesson continues.',
    prompt: 'Rewrite in the past.',
    acceptedAnswer: 'The lesson continued.',
  },
  retellPrompt: 'Retell the lesson briefly.',
  targetPhrases: ['word-1'],
};

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
    reviewCard: vi.fn(async () => undefined),
    toggleBookmark: vi.fn(),
    assignDeck: vi.fn(),
    updateCard: vi.fn(),
  };
  let options: SessionOptions = {
    ownerId: 'owner-a',
    mode: 'library',
    openView,
    loadPracticePool: vi.fn(async () => pool),
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
    addXp: vi.fn(),
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
    gemini.generateStoryContext.mockResolvedValue(storyResult);
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
    session.commands.setRecallMode('vi-to-en');
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
      recallMode: 'vi-to-en',
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
        title: 'A generated story',
        segments: storyResult.segments,
        comprehension: storyResult.comprehension,
        grammar: storyResult.grammar,
        retellPrompt: storyResult.retellPrompt,
        targetPhrases: storyResult.targetPhrases,
      },
    });
    expect(gemini.generateStoryContext).toHaveBeenCalledWith(expect.any(Array), 'owner-a');

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

  it('does not award owner-b quiz XP from an owner-a question before reset effects flush', async () => {
    const pool = [card(1), card(2), card(3), card(4)];
    const ownerAXp = vi.fn();
    const ownerBXp = vi.fn();
    const { render } = createSessionHarness(pool);
    let session = render({ ownerId: 'owner-a', addXp: ownerAXp });
    flushEffects();
    await session.commands.startQuiz();
    session = render();
    const ownerAAnswer = session.quiz.quizQuestions[0].correctAnswer;

    const sessionB = render({ ownerId: 'owner-b', addXp: ownerBXp });
    sessionB.quiz.selectQuizAnswer(ownerAAnswer);

    expect(ownerAXp).not.toHaveBeenCalled();
    expect(ownerBXp).not.toHaveBeenCalled();
  });

  it('does not award owner-b spelling XP from an owner-a card before reset effects flush', async () => {
    const pool = [card(1), card(2), card(3), card(4)];
    const ownerAXp = vi.fn();
    const ownerBXp = vi.fn();
    const { render } = createSessionHarness(pool);
    let session = render({ ownerId: 'owner-a', addXp: ownerAXp });
    flushEffects();
    await session.commands.startSpelling();
    session = render();
    session.quiz.setSpellingInput(session.quiz.spellingCards[0].word);
    render();

    const sessionB = render({ ownerId: 'owner-b', addXp: ownerBXp });
    sessionB.quiz.checkSpelling({ preventDefault: vi.fn() } as never);

    expect(ownerAXp).not.toHaveBeenCalled();
    expect(ownerBXp).not.toHaveBeenCalled();
  });

  it('marks a review saved only after persistence settles', async () => {
    const persistence = deferred<undefined>();
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

    persistence.resolve(undefined);
    await saving;
    session = render();

    expect(session.study.reviewStatus).toBe('saved');
    expect(session.study.reviewedCardId).toBe('card-1');
  });
});

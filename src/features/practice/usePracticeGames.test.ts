import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { classifyProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { createPracticeSessionLifecycle } from './practiceSessionLifecycle';

type EffectRecord = {
  cleanup?: () => void;
  dependencies?: readonly unknown[];
};

const hookRuntime = vi.hoisted(() => ({
  cursor: 0,
  effectCursor: 0,
  effects: [] as EffectRecord[],
  refCursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
}));

const audio = vi.hoisted(() => ({
  correct: vi.fn(),
  incorrect: vi.fn(),
  word: vi.fn(),
}));

const gemini = vi.hoisted(() => ({
  generateStoryContext: vi.fn(),
}));

const dependenciesChanged = (
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
) => previous === undefined
  || next === undefined
  || previous.length !== next.length
  || previous.some((value, index) => !Object.is(value, next[index]));

vi.mock('react', () => ({
  useEffect: (callback: () => void | (() => void), dependencies?: readonly unknown[]) => {
    const index = hookRuntime.effectCursor++;
    if (!dependenciesChanged(hookRuntime.effects[index]?.dependencies, dependencies)) return;
    hookRuntime.effects[index]?.cleanup?.();
    const cleanup = callback();
    hookRuntime.effects[index] = {
      dependencies,
      cleanup: typeof cleanup === 'function' ? cleanup : undefined,
    };
  },
  useState: <T,>(initial: T | (() => T)) => {
    const index = hookRuntime.cursor++;
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
  useRef: <T,>(initial: T) => {
    const index = hookRuntime.refCursor++;
    if (!(index in hookRuntime.refs)) hookRuntime.refs[index] = { current: initial };
    return hookRuntime.refs[index] as { current: T };
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

import { usePracticeGames } from './usePracticeGames';

const card = (index: number, difficulty: CardData['difficulty'] = 'good'): CardData => ({
  id: `card-${index}`,
  word: `word-${index}`,
  translation: `translation-${index}`,
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  difficulty,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
};

const renderPracticeGames = (pool: CardData[]) => {
  const dependencies = {
    lifecycle: createPracticeSessionLifecycle('owner-a'),
    loadPracticePool: vi.fn(async () => pool),
    addXp: vi.fn(),
    openView: vi.fn(),
    reportError: vi.fn(),
  };
  const render = () => {
    hookRuntime.cursor = 0;
    hookRuntime.effectCursor = 0;
    hookRuntime.refCursor = 0;
    return usePracticeGames(dependencies);
  };
  const unmount = () => {
    hookRuntime.effects.forEach(effect => effect.cleanup?.());
    hookRuntime.effects = [];
  };
  return { dependencies, render, unmount };
};

describe('usePracticeGames', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hookRuntime.cursor = 0;
    hookRuntime.effectCursor = 0;
    hookRuntime.effects = [];
    hookRuntime.refCursor = 0;
    hookRuntime.states = [];
    hookRuntime.refs = [];
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
    });
  });

  afterEach(() => {
    hookRuntime.effects.forEach(effect => effect.cleanup?.());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not open quiz or spelling practice with fewer than four cards', async () => {
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3)]);
    const games = render();

    await games.startQuiz();
    await games.startSpelling();

    expect(dependencies.openView).not.toHaveBeenCalled();
    expect(dependencies.reportError).toHaveBeenCalledWith('You need at least 4 cards to start a quiz.');
    expect(dependencies.reportError).toHaveBeenCalledWith('You need at least 4 cards for spelling practice.');
  });

  it('does not open Word Match when fewer than four pairs are eligible', async () => {
    const pool = [
      card(1),
      card(2),
      { ...card(3), word: 'word-2', translation: 'another translation' },
      { ...card(4), word: '', translation: 'missing word' },
      { ...card(5), word: 'same', translation: 'same' },
    ];
    const { dependencies, render } = renderPracticeGames(pool);

    await render().startMatch();

    expect(dependencies.openView).not.toHaveBeenCalledWith('match');
    expect(dependencies.reportError).toHaveBeenCalledWith('You need at least 4 cards to play Word Match.');
  });

  it('keeps quiz preparation single-flight and exposes a settling busy state', async () => {
    const pool = deferred<CardData[]>();
    const { dependencies, render } = renderPracticeGames([]);
    dependencies.loadPracticePool.mockImplementation(() => pool.promise);
    const games = render();

    const firstStart = games.startQuiz();
    const duplicateStart = games.startQuiz();

    expect(dependencies.loadPracticePool).toHaveBeenCalledTimes(1);
    expect(render().isStartingQuiz).toBe(true);

    pool.resolve([card(1), card(2), card(3), card(4)]);
    await Promise.all([firstStart, duplicateStart]);

    expect(render().isStartingQuiz).toBe(false);
    expect(dependencies.openView).toHaveBeenCalledTimes(1);
  });

  it('awards quiz XP only once when the same answer is submitted twice before rendering', async () => {
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startQuiz();
    const games = render();
    const correctAnswer = games.quizQuestions[0].correctAnswer;

    games.selectQuizAnswer(correctAnswer);
    games.selectQuizAnswer(correctAnswer);

    expect(dependencies.addXp).toHaveBeenCalledTimes(1);
    expect(render().quizScore).toBe(1);
  });

  it('awards spelling XP only once when the same answer is submitted twice before rendering', async () => {
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startSpelling();
    let games = render();
    games.setSpellingInput(games.spellingCards[0].word);
    games = render();
    const event = { preventDefault: vi.fn() } as never;

    games.checkSpelling(event);
    games.checkSpelling(event);

    expect(dependencies.addXp).toHaveBeenCalledTimes(1);
    expect(render().spellingScore).toBe(1);
  });

  it('plays delayed quiz audio while the quiz remains active', async () => {
    const { render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startQuiz();
    const games = render();
    const question = games.quizQuestions[0];

    games.selectQuizAnswer(question.correctAnswer);
    vi.advanceTimersByTime(399);
    expect(audio.word).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(audio.word).toHaveBeenCalledWith(question.card.word, question.card.audioUrl);
  });

  it('cancels delayed quiz audio when quiz state is cleared', async () => {
    const { render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startQuiz();
    const games = render();

    games.selectQuizAnswer(games.quizQuestions[0].correctAnswer);
    games.clearQuiz();
    vi.advanceTimersByTime(400);

    expect(audio.word).not.toHaveBeenCalled();
  });

  it('cancels delayed spelling audio when spelling state is cleared', async () => {
    const { render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startSpelling();
    let games = render();
    games.setSpellingInput(games.spellingCards[0].word);
    games = render();
    games.checkSpelling({ preventDefault: vi.fn() } as never);

    games.clearSpelling();
    vi.advanceTimersByTime(400);

    expect(audio.word).not.toHaveBeenCalled();
  });

  it('cancels delayed practice audio when all game state is reset', async () => {
    const { render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startQuiz();
    const games = render();

    games.selectQuizAnswer(games.quizQuestions[0].correctAnswer);
    games.reset();
    vi.advanceTimersByTime(400);

    expect(audio.word).not.toHaveBeenCalled();
  });

  it('cancels delayed practice audio when the hook unmounts', async () => {
    const { render, unmount } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startQuiz();
    const games = render();

    games.selectQuizAnswer(games.quizQuestions[0].correctAnswer);
    unmount();
    vi.advanceTimersByTime(400);

    expect(audio.word).not.toHaveBeenCalled();
  });

  it('cancels delayed quiz audio when switching to spelling practice', async () => {
    const { render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startQuiz();
    const games = render();

    games.selectQuizAnswer(games.quizQuestions[0].correctAnswer);
    await games.startSpelling();
    vi.advanceTimersByTime(400);

    expect(audio.word).not.toHaveBeenCalled();
  });

  it('does not persist the removed legacy activity key after completing games', async () => {
    const legacyStorage = { setItem: vi.fn() };
    vi.stubGlobal('localStorage', legacyStorage);
    const { render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);

    await render().startQuiz();
    let games = render();
    while (!games.showQuizResults) {
      games.selectQuizAnswer(games.quizQuestions[games.currentQuizIndex].correctAnswer);
      games = render();
      games.nextQuizQuestion();
      games = render();
    }

    games.reset();
    await render().startSpelling();
    games = render();
    while (!games.showSpellingResults) {
      games.setSpellingInput(games.spellingCards[games.currentSpellingIndex].word);
      games = render();
      games.checkSpelling({ preventDefault: vi.fn() } as never);
      games = render();
      games.nextSpelling();
      games = render();
    }

    expect(legacyStorage.setItem).not.toHaveBeenCalledWith(
      'lingoflash_last_active',
      expect.any(String),
    );
  });

  it('uses non-easy cards for a story when at least three are available', async () => {
    gemini.generateStoryContext.mockResolvedValue({ story: 'Story', translation: 'Translation' });
    const pool = [card(1, 'easy'), card(2, 'hard'), card(3, 'good'), card(4, 'unrated'), card(5, 'easy')];
    const { dependencies, render } = renderPracticeGames(pool);

    await render().generateStory();

    const selectedWords = gemini.generateStoryContext.mock.calls[0][0] as string[];
    expect(selectedWords.sort()).toEqual(['word-2', 'word-3', 'word-4']);
    expect(dependencies.openView).toHaveBeenCalledWith('story');
  });

  it('opens the story loading view before waiting for the practice pool', async () => {
    const pool = deferred<CardData[]>();
    gemini.generateStoryContext.mockResolvedValue({ story: 'Story', translation: 'Translation' });
    const { dependencies, render } = renderPracticeGames([]);
    dependencies.loadPracticePool.mockImplementation(() => pool.promise);

    const generation = render().generateStory();

    expect(dependencies.openView).toHaveBeenCalledWith('story');
    expect(render().isGeneratingStory).toBe(true);
    pool.resolve([card(1), card(2), card(3), card(4)]);
    await generation;
  });

  it('cancels story generation before the protected adapter after the view is cleared', async () => {
    const pool = deferred<CardData[]>();
    const { dependencies, render } = renderPracticeGames([]);
    dependencies.loadPracticePool.mockImplementation(() => pool.promise);

    const generation = render().generateStory();
    const games = render();
    games.clearStory();
    pool.resolve([card(1), card(2), card(3), card(4)]);
    await generation;

    expect(gemini.generateStoryContext).not.toHaveBeenCalled();
    expect(render()).toMatchObject({
      story: null,
      storyError: null,
      isGeneratingStory: false,
    });
  });

  it('finishes loading with a retryable error instead of presenting failure as a story', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    gemini.generateStoryContext.mockRejectedValue(new Error('service unavailable'));
    const { render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);

    await render().generateStory();
    const games = render();

    expect(games.isGeneratingStory).toBe(false);
    expect(games.story).toBeNull();
    expect(games.storyError).toBe('Could not generate a story right now. Please try again.');
    expect(consoleError).toHaveBeenCalledWith('Story generation failed.', expect.any(Error));
    consoleError.mockRestore();
  });

  it('shows the classified App Check failure instead of a generic story error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    gemini.generateStoryContext.mockRejectedValue(classifyProtectedFunctionError(
      Object.assign(new Error('private backend detail'), { code: 'functions/permission-denied' }),
      'Story generation',
    ));
    const { render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);

    await render().generateStory();

    expect(render().storyError).toBe(
      'Story generation was rejected by the protected cloud service. Reload and sign in again; if it continues, App Check or access rules need administrator attention.',
    );
    expect(render().storyError).not.toContain('private backend detail');
    consoleError.mockRestore();
  });
});

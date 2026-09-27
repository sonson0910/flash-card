import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { messages as enPractice } from '../../i18n/locales/en/practice.po';
import { messages as viPractice } from '../../i18n/locales/vi/practice.po';
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

import { shuffleQuizOptions, usePracticeGames } from './usePracticeGames';

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
    languageDrillCards: pool,
    languageDrillScopeKey: 'owner-a:en',
    practiceSessionService: {
      start: vi.fn(async (request: { opId: string; game: 'quiz' | 'spelling' | 'match'; cardIds: string[] }) => ({
        sessionId: request.opId,
        game: request.game,
        challenge: request.game === 'quiz'
          ? { kind: 'quiz' as const, questions: request.cardIds.map(cardId => ({ cardId, prompt: `word-${cardId.slice(5)}`, options: [`translation-${cardId.slice(5)}`] })) }
          : request.game === 'spelling'
            ? { kind: 'spelling' as const, prompts: request.cardIds.map(cardId => ({ cardId, prompt: `translation-${cardId.slice(5)}`, word: `word-${cardId.slice(5)}` })) }
            : { kind: 'match' as const, cards: request.cardIds.map(cardId => ({ cardId, word: `word-${cardId.slice(5)}`, translation: `translation-${cardId.slice(5)}` })) },
        expiresAt: '2026-09-27T00:00:00.000Z',
      })),
      complete: vi.fn(async (request: { sessionId: string; completionId: string; answers: unknown }) => ({
        sessionId: request.sessionId, correct: 0, total: 0, awardedXp: 0,
        outcome: { xp: 0, level: 1, streak: 0, studyDay: '2026-09-27', events: [] },
      })),
    },
    openView: vi.fn(),
    reportError: vi.fn(),
    onAuthoritativeOutcome: vi.fn(),
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
    i18n.load('en', enPractice);
    i18n.load('vi', viPractice);
    i18n.activate('en');
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

  it('shuffles server quiz options without changing the authoritative first answer', () => {
    const serverOptions = ['correct', 'decoy-a', 'decoy-b'];

    expect(shuffleQuizOptions(serverOptions, () => 0)).toEqual(['decoy-a', 'decoy-b', 'correct']);
    expect(serverOptions[0]).toBe('correct');
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

  it('starts a language drill from its supplied course cards without loading a practice pool', async () => {
    const drillCards = [{ ...card(1), language: 'ko' }, { ...card(2), language: 'ko' }];
    const { dependencies, render } = renderPracticeGames(drillCards);
    const games = render();

    await games.startLanguageDrill();
    render().completeLanguageDrill(true);

    expect(dependencies.loadPracticePool).not.toHaveBeenCalled();
    expect(dependencies.openView).toHaveBeenCalledWith('language-drill');
    expect(render().languageDrillCorrect).toBe(1);
    expect(render().currentLanguageDrillIndex).toBe(1);
  });

  it('reports a preparation error in the active Vietnamese UI locale', async () => {
    i18n.activate('vi');
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3)]);

    await render().startQuiz();

    expect(dependencies.reportError).toHaveBeenCalledWith('Bạn cần ít nhất 4 thẻ để bắt đầu bài kiểm tra.');
  });

  it('requires four unique nonblank pairs before opening Word Match', async () => {
    const pool = [
      card(1), card(2), card(3),
      { ...card(1), id: 'duplicate', word: ' WORD-1 ', translation: ' translation-1 ' },
      { ...card(4), word: ' ' },
      { ...card(5), translation: ' ' },
    ];
    const { dependencies, render } = renderPracticeGames(pool);

    await render().startMatch();

    expect(dependencies.openView).not.toHaveBeenCalled();
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

  it('renders quiz prompts and options from the server session snapshot', async () => {
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    dependencies.practiceSessionService.start.mockResolvedValueOnce({
      sessionId: 'session-a', game: 'quiz', expiresAt: '2026-09-27T00:00:00.000Z',
      challenge: { kind: 'quiz', questions: [
        { cardId: 'card-1', prompt: 'server word', options: ['server meaning', 'other meaning'] },
        { cardId: 'card-2', prompt: 'server word 2', options: ['server meaning 2'] },
        { cardId: 'card-3', prompt: 'server word 3', options: ['server meaning 3'] },
        { cardId: 'card-4', prompt: 'server word 4', options: ['server meaning 4'] },
      ] },
    });

    await render().startQuiz();

    expect(render().quizQuestions[0]).toMatchObject({
      card: { id: 'card-1', word: 'server word', translation: 'server meaning' },
      options: expect.arrayContaining(['server meaning', 'other meaning']), correctAnswer: 'server meaning',
    });
  });

  it('renders spelling and match values from the server session snapshot', async () => {
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    dependencies.practiceSessionService.start.mockResolvedValueOnce({
      sessionId: 'spelling-a', game: 'spelling', expiresAt: '2026-09-27T00:00:00.000Z',
      challenge: { kind: 'spelling', prompts: [
        { cardId: 'card-1', prompt: 'server spelling prompt', word: 'server spelling word' }, { cardId: 'card-2', prompt: 'two', word: 'two' },
        { cardId: 'card-3', prompt: 'three', word: 'three' }, { cardId: 'card-4', prompt: 'four', word: 'four' },
      ] },
    });
    await render().startSpelling();
    expect(render().spellingCards[0]).toMatchObject({ id: 'card-1', word: 'server spelling word', translation: 'server spelling prompt' });

    dependencies.practiceSessionService.start.mockResolvedValueOnce({
      sessionId: 'match-a', game: 'match', expiresAt: '2026-09-27T00:00:00.000Z',
      challenge: { kind: 'match', cards: [
        { cardId: 'card-1', word: 'server match word', translation: 'server match meaning' },
        { cardId: 'card-2', word: 'two', translation: 'hai' }, { cardId: 'card-3', word: 'three', translation: 'ba' },
        { cardId: 'card-4', word: 'four', translation: 'bốn' },
      ] },
    });
    await render().startMatch();
    expect(render().spellingCards).toContainEqual(expect.objectContaining({
      id: 'card-1', word: 'server match word', translation: 'server match meaning',
    }));
  });

  it('retries a failed Word Match completion with the same session and completion IDs', async () => {
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    dependencies.practiceSessionService.complete
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        sessionId: 'match-a', correct: 4, total: 4, awardedXp: 20,
        outcome: { xp: 20, level: 1, streak: 0, studyDay: '2026-09-27', events: [] },
      });
    await render().startMatch();
    const pairs = render().spellingCards.map(({ id: cardId, word, translation }) => ({ cardId, word, translation }));

    expect(await render().completeMatch(pairs)).toBeNull();
    expect(await render().completeMatch(pairs)).toEqual({ awardedXp: 20 });

    const [first, second] = dependencies.practiceSessionService.complete.mock.calls.map(([request]) => request);
    expect(second).toMatchObject({ sessionId: first.sessionId, completionId: first.completionId, answers: first.answers });
    expect(dependencies.onAuthoritativeOutcome).toHaveBeenCalledTimes(1);
  });

  it('starts a new Word Match session before a new round after completion', async () => {
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startMatch();
    const firstSessionId = dependencies.practiceSessionService.start.mock.calls[0][0].opId;

    expect(await render().restartMatch()).toBe(true);

    const secondSessionId = dependencies.practiceSessionService.start.mock.calls[1][0].opId;
    expect(secondSessionId).not.toBe(firstSessionId);
    expect(dependencies.loadPracticePool).toHaveBeenCalledTimes(1);
  });

  it('records a quiz answer once when the same answer is submitted twice before rendering', async () => {
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startQuiz();
    const games = render();
    const correctAnswer = games.quizQuestions[0].correctAnswer;

    games.selectQuizAnswer(correctAnswer);
    games.selectQuizAnswer(correctAnswer);

    expect(dependencies.practiceSessionService.complete).not.toHaveBeenCalled();
    expect(render().quizScore).toBe(1);
  });

  it('records a spelling answer once when the same answer is submitted twice before rendering', async () => {
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startSpelling();
    let games = render();
    games.setSpellingInput(games.spellingCards[0].word);
    games = render();
    const event = { preventDefault: vi.fn() } as never;

    games.checkSpelling(event);
    games.checkSpelling(event);

    expect(dependencies.practiceSessionService.complete).not.toHaveBeenCalled();
    expect(render().spellingScore).toBe(1);
  });

  it('forwards the stable completion ID with the server outcome', async () => {
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startQuiz();
    let games = render();
    while (!games.showQuizResults) {
      games.selectQuizAnswer(games.quizQuestions[games.currentQuizIndex].correctAnswer);
      games = render();
      games.nextQuizQuestion();
      games = render();
    }
    await Promise.resolve();

    const completionId = dependencies.practiceSessionService.complete.mock.calls[0][0].completionId;
    expect(dependencies.onAuthoritativeOutcome).toHaveBeenCalledWith(
      { xp: 0, level: 1, streak: 0, studyDay: '2026-09-27', events: [] }, completionId, 0,
    );
  });

  it('drops a late Word Match completion result after the lifecycle owner changes', async () => {
    const pending = deferred<{
      sessionId: string; correct: number; total: number; awardedXp: number;
      outcome: { xp: number; level: number; streak: number; studyDay: string; events: never[] };
    }>();
    const { dependencies, render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    dependencies.practiceSessionService.complete.mockReturnValueOnce(pending.promise);
    await render().startMatch();
    const pairs = render().spellingCards.map(({ id: cardId, word, translation }) => ({ cardId, word, translation }));
    const completion = render().completeMatch(pairs);

    dependencies.lifecycle.replaceOwner('owner-b');
    pending.resolve({
      sessionId: 'practice-quiz-a', correct: 4, total: 4, awardedXp: 20,
      outcome: { xp: 20, level: 1, streak: 0, studyDay: '2026-09-27', events: [] },
    });
    await expect(completion).resolves.toBeNull();

    expect(dependencies.onAuthoritativeOutcome).not.toHaveBeenCalled();
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
    expect(audio.word).toHaveBeenCalledWith(question.card.word, question.card.audioUrl, 'en-US');
  });

  it('cancels owned playback when navigating away after delayed audio starts', async () => {
    const playback = { cancel: vi.fn() };
    audio.word.mockReturnValue(playback);
    const { render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);
    await render().startQuiz();
    let games = render();

    games.selectQuizAnswer(games.quizQuestions[0].correctAnswer);
    vi.advanceTimersByTime(400);
    games = render();
    games.nextQuizQuestion();

    expect(playback.cancel).toHaveBeenCalledOnce();
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

  it('carries the selected cards\' languages into the generated story view', async () => {
    gemini.generateStoryContext.mockResolvedValue({ story: 'Story', translation: 'Translation' });
    const pool = [card(1), card(2), card(3), card(4)].map(item => ({
      ...item, language: 'ko', translationLanguage: 'vi',
    }));
    const { render } = renderPracticeGames(pool);

    await render().generateStory();

    expect(render().story).toMatchObject({ language: 'ko', translationLanguage: 'vi' });
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

  it.each([
    ['en', 'service-daily-cap', 'shared limit', '00:00'],
    ['vi', 'service-daily-cap', 'hạn mức chung', '00:00'],
    ['en', 'ai-card-quota', 'manual cards still work', 'next period'],
    ['vi', 'ai-card-quota', 'thẻ thủ công', 'kỳ tiếp theo'],
  ])('preserves %s guidance for %s story quota errors', async (locale, reason, guidance, reset) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    i18n.activate(locale);
    gemini.generateStoryContext.mockRejectedValue(classifyProtectedFunctionError(
      Object.assign(new Error('private backend detail'), { code: 'functions/resource-exhausted', details: { reason } }),
      'Story generation',
    ));
    const { render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);

    await render().generateStory();

    expect(render().storyError).toContain(guidance);
    expect(render().storyError).toContain(reset);
    expect(render().storyError).not.toContain('private backend detail');
    consoleError.mockRestore();
  });
});

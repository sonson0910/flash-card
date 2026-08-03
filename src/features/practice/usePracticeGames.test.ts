import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const hookRuntime = vi.hoisted(() => ({
  cursor: 0,
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

vi.mock('react', () => ({
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

const renderPracticeGames = (pool: CardData[]) => {
  const dependencies = {
    loadPracticePool: vi.fn(async () => pool),
    addXp: vi.fn(),
    openView: vi.fn(),
    reportError: vi.fn(),
  };
  const render = () => {
    hookRuntime.cursor = 0;
    hookRuntime.refCursor = 0;
    return usePracticeGames(dependencies);
  };
  return { dependencies, render };
};

describe('usePracticeGames', () => {
  beforeEach(() => {
    hookRuntime.cursor = 0;
    hookRuntime.refCursor = 0;
    hookRuntime.states = [];
    hookRuntime.refs = [];
    vi.clearAllMocks();
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout.bind(globalThis) });
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

  it('uses non-easy cards for a story when at least three are available', async () => {
    gemini.generateStoryContext.mockResolvedValue({ story: 'Story', translation: 'Translation' });
    const pool = [card(1, 'easy'), card(2, 'hard'), card(3, 'good'), card(4, 'unrated'), card(5, 'easy')];
    const { dependencies, render } = renderPracticeGames(pool);

    await render().generateStory();

    const selectedWords = gemini.generateStoryContext.mock.calls[0][0] as string[];
    expect(selectedWords.sort()).toEqual(['word-2', 'word-3', 'word-4']);
    expect(dependencies.openView).toHaveBeenCalledWith('story');
  });

  it('finishes loading with readable fallback content when story generation fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    gemini.generateStoryContext.mockRejectedValue(new Error('service unavailable'));
    const { render } = renderPracticeGames([card(1), card(2), card(3), card(4)]);

    await render().generateStory();
    const games = render();

    expect(games.isGeneratingStory).toBe(false);
    expect(games.story).toEqual({
      story: 'Could not generate a story right now.',
      translation: 'The translated story is unavailable right now.',
    });
    expect(consoleError).toHaveBeenCalledWith('Story generation failed.', expect.any(Error));
    consoleError.mockRestore();
  });
});

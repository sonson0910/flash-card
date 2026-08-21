import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import {
  buildExercise,
  evaluateExerciseAnswer,
  getEligibleExerciseModes,
} from './exerciseEngine';

const card = (id: string, overrides: Partial<CardData> = {}): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `meaning ${id}`,
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  ...overrides,
});

const pool = ['one', 'two', 'three', 'four'].map(value => card(value));

describe('exercise engine', () => {
  it('builds all six discriminated exercise modes with bounded prompts', () => {
    const source = card('learn', {
      translation: 'học',
      audioUrl: 'https://ssl.gstatic.com/dictionary/static/sounds/learn.mp3',
      exampleSentence: 'We learn when we learn together',
      exampleTranslation: 'Chúng ta học cùng nhau',
    });
    const candidates = [source, ...pool];

    expect(getEligibleExerciseModes(source, candidates)).toEqual([
      'recognition', 'active-recall', 'listening', 'spelling', 'cloze', 'sentence-building',
    ]);
    expect(buildExercise(source, candidates, 'recognition').mode).toBe('recognition');
    expect(buildExercise(source, candidates, 'active-recall').mode).toBe('active-recall');
    expect(buildExercise(source, candidates, 'listening').mode).toBe('listening');
    expect(buildExercise(source, candidates, 'spelling').mode).toBe('spelling');
    expect(buildExercise(source, candidates, 'cloze').mode).toBe('cloze');
    expect(buildExercise(source, candidates, 'sentence-building').mode).toBe('sentence-building');
  });

  it('falls back honestly when recognition, listening, cloze or sentence content is unavailable', () => {
    const source = card('solo', { translation: 'một mình' });
    for (const requested of ['recognition', 'listening', 'cloze', 'sentence-building'] as const) {
      expect(buildExercise(source, [source], requested)).toMatchObject({
        mode: 'active-recall',
        fallbackFrom: requested,
      });
    }
    expect(buildExercise(card('unsafe', { audioUrl: 'http://attacker.test/audio.mp3' }), [], 'listening'))
      .toMatchObject({ mode: 'active-recall', fallbackFrom: 'listening' });
  });

  it('does not leak typed answers before submission', () => {
    const source = card('allocate', { translation: 'phân bổ', exampleSentence: 'We allocate time carefully.' });
    const active = buildExercise(source, [source], 'active-recall');
    const cloze = buildExercise(source, [source], 'cloze');

    expect(active.prompt.toLocaleLowerCase()).not.toContain('allocate');
    expect(cloze.prompt.toLocaleLowerCase()).not.toContain('allocate');
    expect(cloze.prompt).toContain('_____');

    const identical = buildExercise(card('same', { word: 'same', translation: 'same' }), [], 'spelling');
    expect(identical.prompt.toLocaleLowerCase()).not.toContain('same');
    const substring = buildExercise(card('he', { exampleSentence: 'The theme is here.' }), [], 'cloze');
    expect(substring).toMatchObject({ mode: 'active-recall', fallbackFrom: 'cloze' });
  });

  it('labels Vietnamese prompts and English fallbacks explicitly', () => {
    const translated = card('learn', {
      translation: 'học', exampleSentence: 'We learn together', exampleTranslation: 'Chúng ta học cùng nhau',
    });

    expect(buildExercise(translated, [translated], 'active-recall').promptLanguage).toBe('vi');
    expect(buildExercise(translated, [translated], 'spelling').promptLanguage).toBe('vi');
    expect(buildExercise(translated, [translated], 'sentence-building').promptLanguage).toBe('vi');
    expect(buildExercise(card('fallback', { translation: '' }), [], 'active-recall').promptLanguage).toBe('en');
  });

  it('carries Arabic and Hebrew answer languages through text, sentence and placement exercises', () => {
    const source = card('rtl', {
      word: 'تحليل',
      translation: 'ניתוח',
      exampleSentence: 'يقدم التقرير تحليلاً مفصلاً',
      exampleTranslation: 'הדוח מציג ניתוח מפורט',
    });
    const candidates = [
      source,
      card('rtl-2', { word: 'دليل', translation: 'ראיה' }),
      card('rtl-3', { word: 'سياق', translation: 'הקשר' }),
      card('rtl-4', { word: 'معرفة', translation: 'ידע' }),
    ];

    expect(buildExercise(source, candidates, 'spelling')).toMatchObject({
      promptLanguage: 'he', answerLanguage: 'ar',
    });
    expect(buildExercise(source, candidates, 'sentence-building')).toMatchObject({
      promptLanguage: 'he', answerLanguage: 'ar',
    });
    expect(buildExercise(source, candidates, 'recognition')).toMatchObject({
      promptLanguage: 'ar', answerLanguage: 'he',
    });
  });

  it('uses a deterministic option shuffle instead of leaking recognition at a fixed position', () => {
    const positions = ['alpha', 'bravo', 'charlie', 'delta'].map(id => {
      const source = card(id, { translation: `correct ${id}` });
      const exercise = buildExercise(source, [source, ...pool], 'recognition');
      if (exercise.mode !== 'recognition') throw new Error('Expected recognition exercise');
      return exercise.options.indexOf(exercise.answer);
    });
    expect(new Set(positions).size).toBeGreaterThan(1);
  });

  it('keeps repeated sentence tokens as distinct stable occurrences and scores order exactly', () => {
    const source = card('learn', { exampleSentence: 'We learn when we learn together.' });
    const exercise = buildExercise(source, [source], 'sentence-building');
    expect(exercise.mode).toBe('sentence-building');
    if (exercise.mode !== 'sentence-building') throw new Error('Expected sentence exercise');

    const learnTokens = exercise.answerTokens.filter(token => token.text.toLocaleLowerCase() === 'learn');
    expect(learnTokens).toHaveLength(2);
    expect(learnTokens[0].id).not.toBe(learnTokens[1].id);
    expect(new Set(exercise.tokens.map(token => token.id)).size).toBe(exercise.tokens.length);
    expect(evaluateExerciseAnswer(exercise, exercise.answerTokens.map(token => token.id)).correct).toBe(true);
    expect(evaluateExerciseAnswer(exercise, [...exercise.answerTokens].reverse().map(token => token.id)).correct).toBe(false);
  });

  it('scores typed and recognition answers without choosing an FSRS rating', () => {
    const source = card('hello', { translation: 'xin chào' });
    const recognition = buildExercise(source, [source, ...pool], 'recognition');
    const spelling = buildExercise(source, [source], 'spelling');

    expect(evaluateExerciseAnswer(recognition, 'xin chào')).toEqual(expect.objectContaining({ correct: true }));
    expect(evaluateExerciseAnswer(spelling, 'Hello')).toEqual(expect.objectContaining({ correct: true }));
    expect(evaluateExerciseAnswer(spelling, 'goodbye')).not.toHaveProperty('rating');
  });

  it('infers the typed-answer policy from the expected vocabulary script', () => {
    const kana = buildExercise(card('kana', { word: '学び', translation: 'learning' }), [], 'spelling');
    expect(kana).toMatchObject({ mode: 'spelling', scoringPolicy: 'kana' });
    expect(evaluateExerciseAnswer(kana, '学び').correct).toBe(true);
    expect(evaluateExerciseAnswer(kana, 'manabi')).toMatchObject({ correct: false, wrongScript: true });
  });
});

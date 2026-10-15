import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CardData } from '../../types/card';
import { LanguagePracticeDrill, resolveOnScreenHangulKey } from './LanguagePracticeDrill';
import { composeHangulBlocks, createLanguagePracticeDrill, evaluateJapaneseSentenceCloze, evaluateToneLanguagePracticeDrill, evaluateTypedLanguagePracticeDrill, findHangulFinalCorrection, languagePracticeDrillSurfaceState, shouldRevealLanguagePracticeReading, shouldStartJapaneseSentenceCloze } from './languagePracticeDrill';
import { jaLanguagePack } from './packs/ja';

type TestElement = { readonly type: unknown; readonly props: Record<string, unknown> };

const findElement = (element: unknown, matches: (element: TestElement) => boolean): TestElement | undefined => {
  if (typeof element !== 'object' || element === null || !('props' in element)) return undefined;
  const testElement = element as TestElement;
  if (matches(testElement)) return testElement;
  const children = testElement.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, matches);
    if (found) return found;
  }
  return undefined;
};

const card = (language: string, word: string): CardData => ({
  id: `${language}-card`, language, word, translation: 'meaning', explanation: '', phonetic: '', emoji: '', category: '', audioUrl: null, imageUrl: null,
});

describe('language practice drill model', () => {
  i18n.load('en', {});
  i18n.activate('en');
  it.each([
    ['en', 'word', 'spelling'],
    ['ko', '한글', 'hangul-blocks'],
    ['ja', 'かな', 'kana-reading'],
    ['zh', '汉字', 'tone-melody'],
  ] as const)('selects the %s drill for %s', (language, word, kind) => {
    expect(createLanguagePracticeDrill(card(language, word), []).kind).toBe(kind);
  });

  it('grades a Kanji word against its stored kana reading', () => {
    const model = createLanguagePracticeDrill({ ...card('ja', '学校'), phonetic: 'がっこう' }, []);
    expect(evaluateTypedLanguagePracticeDrill(model, 'がっこう', 'がっこう').correct).toBe(true);
    expect(evaluateTypedLanguagePracticeDrill(model, 'かっこう', 'がっこう').correct).toBe(false);
  });

  it('keeps a verified kana reading as one annotation for the complete Kanji headword', () => {
    const reading = jaLanguagePack.rendering.buildReadingPlan({ word: '学校', phonetic: 'がっこう' });
    expect(reading.readingText).toBe('がっこう');
    expect(reading.readingText).not.toContain(' ');
  });

  it('keeps the Japanese reading hidden until a hint or answer check', () => {
    expect(shouldRevealLanguagePracticeReading(false, false)).toBe(false);
    expect(shouldRevealLanguagePracticeReading(true, false)).toBe(true);
    expect(shouldRevealLanguagePracticeReading(false, true)).toBe(true);
  });

  it('unlocks a Japanese sentence cloze only after a correct kana answer', () => {
    const current = { ...card('ja', '日本'), phonetic: 'にっぽん', exampleSentence: '日本で日本語を勉強します。' };
    const sameLanguage = card('ja', '毎朝');
    const otherLanguage = card('zh', '每天');
    const model = createLanguagePracticeDrill(current, [current, sameLanguage, otherLanguage]);

    expect(model.sentenceCloze).toEqual({ before: '', after: 'で日本語を勉強します。', answer: '日本', choices: [{ word: '日本', reading: 'にっぽん', meaning: 'meaning' }, { word: '毎朝', meaning: 'meaning' }] });
    expect(shouldStartJapaneseSentenceCloze(model, evaluateTypedLanguagePracticeDrill(model, 'にほん', 'にっぽん'))).toBe(false);
    expect(shouldStartJapaneseSentenceCloze(model, evaluateTypedLanguagePracticeDrill(model, 'にっぽん', 'にっぽん'))).toBe(true);
    expect(evaluateJapaneseSentenceCloze(model, '日本').correct).toBe(true);
    expect(evaluateJapaneseSentenceCloze(model, '毎朝').correct).toBe(false);
  });

  it('places Japanese cloze answers in stable positions across cards', () => {
    const words = ['日本', '毎朝', '学校', '先生'];
    const cards = [...words.map(word => ({ ...card('ja', word), id: `choice-${word}` })), card('zh', '每天')];
    const models = words.map((word, index) => createLanguagePracticeDrill({
      ...card('ja', word),
      id: `ja-card-${index}`,
      phonetic: 'かな',
      exampleSentence: `${word}です。`,
    }, cards));

    expect(models.map(model => model.sentenceCloze?.choices.map(choice => choice.word))).toEqual([
      ['毎朝', '学校', '先生', '日本'],
      ['学校', '先生', '毎朝', '日本'],
      ['先生', '学校', '日本', '毎朝'],
      ['先生', '日本', '毎朝', '学校'],
    ]);
    expect(models.map(model => model.sentenceCloze?.choices.findIndex(choice => choice.word === model.card.word))).toEqual([3, 2, 1, 0]);
    expect(models.map(model => new Set(model.sentenceCloze?.choices.map(choice => choice.word)).size)).toEqual([4, 4, 4, 4]);
    expect(models[0].sentenceCloze?.choices.map(choice => choice.word)).toEqual(createLanguagePracticeDrill(models[0].card, cards).sentenceCloze?.choices.map(choice => choice.word));
  });

  it('uses typed Japanese sentence completion when the scope has one card', () => {
    const current = { ...card('ja', '学校'), phonetic: 'がっこう', exampleSentence: '学校へ行きます。' };
    const model = createLanguagePracticeDrill(current, [current]);

    expect(model.sentenceCloze?.choices).toEqual([{ word: '学校', reading: 'がっこう', meaning: 'meaning' }]);
    expect(createLanguagePracticeDrill({ ...current, exampleSentence: '今日は休みです。' }, [current]).sentenceCloze).toBeUndefined();
  });

  it('requires a whole Japanese word segment and chooses the first repeated segment', () => {
    const current = { ...card('ja', '毎朝'), phonetic: 'まいあさ', exampleSentence: '毎朝、毎朝コーヒーを飲みます。' };
    expect(createLanguagePracticeDrill(current, [current]).sentenceCloze).toMatchObject({ before: '', after: '、毎朝コーヒーを飲みます。' });
    expect(createLanguagePracticeDrill({ ...current, word: '日本', exampleSentence: '日本語を勉強します。' }, [current]).sentenceCloze).toBeUndefined();
  });

  it('composes two-set Hangul jamo into displayed syllable blocks before grading', () => {
    expect(composeHangulBlocks('ㅎㅏㄴㄱㅡㄹ')).toBe('한글');
    expect(composeHangulBlocks('ㄱㅏㄱㅏ')).toBe('가가');
    expect(composeHangulBlocks('ㄱㅏㄴ')).toBe('간');
    const model = createLanguagePracticeDrill(card('ko', '한글'), []);
    expect(evaluateTypedLanguagePracticeDrill(model, composeHangulBlocks('ㅎㅏㄴㄱㅡㄹ')).correct).toBe(true);
  });

  it('offers all shifted two-set jamo through the on-screen keyboard', () => {
    expect(['ㅂ', 'ㅈ', 'ㄷ', 'ㄱ', 'ㅅ', 'ㅐ', 'ㅔ'].map(key => resolveOnScreenHangulKey(key as 'ㅂ' | 'ㅈ' | 'ㄷ' | 'ㄱ' | 'ㅅ' | 'ㅐ' | 'ㅔ', true))).toEqual(['ㅃ', 'ㅉ', 'ㄸ', 'ㄲ', 'ㅆ', 'ㅒ', 'ㅖ']);
    expect(composeHangulBlocks(`${resolveOnScreenHangulKey('ㅂ', true)}ㅏ`)).toBe('빠');
    expect(resolveOnScreenHangulKey('ㅂ', false)).toBe('ㅂ');
  });

  it('identifies only a single final-consonant correction', () => {
    expect(findHangulFinalCorrection('결십', '결심')).toEqual({ typed: 'ㅂ', expected: 'ㅁ' });
    expect(findHangulFinalCorrection('결심', '결심')).toBeNull();
    expect(findHangulFinalCorrection('결싯', '결심')).toEqual({ typed: 'ㅅ', expected: 'ㅁ' });
    expect(findHangulFinalCorrection('걀십', '결심')).toBeNull();
    expect(findHangulFinalCorrection('결시', '결심')).toBeNull();
  });

  it('requires every stored pinyin tone to be selected correctly', () => {
    const expected = [{ text: 'nǐ', tone: 3 }, { text: 'hǎo', tone: 3 }] as const;
    expect(evaluateToneLanguagePracticeDrill('zh-card', expected, [3, 3]).correct).toBe(true);
    expect(evaluateToneLanguagePracticeDrill('zh-card', expected, [3, 2]).correct).toBe(false);
  });

  it('keeps tone exercises unavailable through loading, errors, and missing metadata', () => {
    expect(languagePracticeDrillSurfaceState('tone-melody', null, false, false)).toBe('loading');
    expect(languagePracticeDrillSurfaceState('tone-melody', null, true, true)).toBe('error');
    expect(languagePracticeDrillSurfaceState('tone-melody', null, true, false)).toBe('missing-tone-data');
    expect(languagePracticeDrillSurfaceState('tone-melody', { readingText: 'nǐ', readingLang: 'zh-Latn', kind: 'pinyin', toneSyllables: [{ text: 'nǐ', tone: 3 }] }, true, false)).toBe('ready');
  });

  it('renders an accessible, card-backed drill surface', () => {
    const current = card('ko', '한글');
    const html = renderToStaticMarkup(
      createElement(I18nProvider, { i18n }, createElement(LanguagePracticeDrill, {
        card: current, cards: [current], currentIndex: 1, total: 4, onClose: () => {}, onNext: () => {},
      })),
    );
    expect(html).toContain('Build the syllable blocks');
    expect(html).toContain('Item 2 of 4');
    expect(html).toContain('Korean pack');
    expect(html).toContain('Loading this language exercise');
    expect(html).not.toContain('type="text"');
  });

  it('retries the same language pack after a rejected load', async () => {
    const state: unknown[] = [];
    const effects: Array<() => void | (() => void)> = [];
    let cursor = 0;
    const loadLanguagePack = vi.fn()
      .mockRejectedValueOnce(new Error('temporary language pack load failure'))
      .mockResolvedValue(jaLanguagePack);

    vi.resetModules();
    vi.doMock('react', async importOriginal => ({
      ...(await importOriginal<typeof import('react')>()),
      useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
      useMemo: <T,>(factory: () => T) => factory(),
      useRef: <T,>(initial: T) => ({ current: initial }),
      useState: <T,>(initial: T) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index] as T, (next: T | ((current: T) => T)) => { state[index] = typeof next === 'function' ? (next as (current: T) => T)(state[index] as T) : next; }];
      },
    }));
    vi.doMock('@lingui/react', () => ({
      Trans: () => null,
      useLingui: () => ({ i18n: { _: (descriptor: { message: string }) => descriptor.message } }),
    }));
    vi.doMock('../courses/CourseGate', () => ({ useCourseSession: () => ({ model: { activeCourse: null } }) }));
    vi.doMock('./registry', async importOriginal => ({
      ...(await importOriginal<typeof import('./registry')>()),
      loadLanguagePack,
    }));

    try {
      const { LanguagePracticeDrill: ClientLanguagePracticeDrill } = await import('./LanguagePracticeDrill');
      const render = () => {
        cursor = 0;
        effects.length = 0;
        return ClientLanguagePracticeDrill({ card: card('ja', 'かな'), cards: [], onClose: () => {}, onNext: () => {} });
      };

      render();
      effects.at(-1)?.();
      await Promise.resolve();
      await Promise.resolve();
      let view = render();
      const retry = findElement(view, element => element.type === 'button'
        && (element.props.children as TestElement | undefined)?.props?.id === 'languagePractice.action.retry');
      expect(retry).toBeDefined();

      (retry?.props.onClick as () => void)();
      render();
      effects.at(-1)?.();
      await Promise.resolve();
      view = render();

      expect(loadLanguagePack).toHaveBeenCalledTimes(2);
      expect(findElement(view, element => element.type === 'input')).toBeDefined();
      expect(findElement(view, element => element.type === 'button'
        && (element.props.children as TestElement | undefined)?.props?.id === 'languagePractice.action.retry')).toBeUndefined();
    } finally {
      vi.doUnmock('react');
      vi.doUnmock('@lingui/react');
      vi.doUnmock('../courses/CourseGate');
      vi.doUnmock('./registry');
      vi.resetModules();
    }
  });

});

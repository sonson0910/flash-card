import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { messages as enPractice } from '../../i18n/locales/en/practice.po';
import { messages as viPractice } from '../../i18n/locales/vi/practice.po';
import type { CardData } from '../../types/card';
import { QuizView } from './QuizView';
import type { QuizQuestion } from './practiceModel';

const examples = [
  { code: 'en', word: 'hello', englishName: 'English', vietnameseName: 'Tiếng Anh' },
  { code: 'ko', word: '안녕', englishName: 'Korean', vietnameseName: 'Tiếng Hàn' },
] as const;

function renderQuestion(locale: 'en' | 'vi', target: typeof examples[number], direction: QuizQuestion['type']) {
  i18n.load('en', enPractice);
  i18n.load('vi', viPractice);
  i18n.activate(locale);
  const card: CardData = {
    id: `${target.code}-${direction}`,
    word: target.word,
    translation: 'xin chào',
    explanation: '',
    phonetic: '',
    emoji: '',
    category: 'Greeting',
    audioUrl: null,
    imageUrl: null,
    language: target.code,
    translationLanguage: 'vi',
  };
  const question: QuizQuestion = {
    card,
    type: direction,
    options: direction === 'target-to-native' ? ['xin chào', 'tạm biệt'] : [target.word, 'khác'],
    correctAnswer: direction === 'target-to-native' ? 'xin chào' : target.word,
  };
  const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><QuizView questions={[question]} currentIndex={0} selectedAnswer={null} answeredCorrectly={null} score={0} showResults={false} onSelect={() => undefined} onNext={() => undefined} onRestart={() => undefined} onClose={() => undefined} /></I18nProvider>);
  return html.match(/<h3[^>]*id="quiz-question-heading"[^>]*>(.*?)<\/h3>/s)?.[1] ?? '';
}

describe('quiz copy with real UI catalogs', () => {
  for (const locale of ['en', 'vi'] as const) for (const target of examples) {
    it(`${locale} UI names ${target.code} and scopes target/native words in both directions`, () => {
      const targetName = locale === 'en' ? target.englishName : target.vietnameseName;
      const nativeName = locale === 'en' ? 'Vietnamese' : 'Tiếng Việt';
      const targetToNative = renderQuestion(locale, target, 'target-to-native');
      expect(targetToNative).toContain(nativeName);
      expect(targetToNative).toContain(`<span lang="${target.code}">“${target.word}”</span>`);
      expect(targetToNative).toContain(locale === 'en' ? 'What does' : 'có nghĩa là gì');

      const nativeToTarget = renderQuestion(locale, target, 'native-to-target');
      expect(nativeToTarget).toContain(targetName);
      expect(nativeToTarget).toContain('<span lang="vi">“xin chào”</span>');
      expect(nativeToTarget).not.toContain('““');
      expect(nativeToTarget).toContain(locale === 'en' ? 'Which' : 'Từ');
    });
  }
});

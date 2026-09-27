import { createRoot } from 'react-dom/client';
import { Suspense, useEffect, useState } from 'react';
import '../../src/index.css';
import { LanguagePracticeDrill } from '../../src/features/languagePacks/LanguagePracticeDrill';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';
import type { CardData } from '../../src/types/card';

const cards: Record<string, CardData> = {
  en: { id: 'language-visual-en', language: 'en', translationLanguage: 'vi', word: 'luminous', translation: 'phát sáng', explanation: 'Giving off light.', phonetic: '/ˈluːmɪnəs/', emoji: '✨', category: 'Science', audioUrl: null, imageUrl: null },
  ko: { id: 'language-visual-ko', language: 'ko', translationLanguage: 'vi', word: '결심', translation: 'quyết tâm', explanation: 'A firm decision to do something.', phonetic: '', emoji: '💪', category: 'TOPIK I', audioUrl: null, imageUrl: null },
  ja: { id: 'language-visual-ja', language: 'ja', translationLanguage: 'vi', word: '学校', translation: 'trường học', explanation: 'A place for learning.', phonetic: 'がっこう', emoji: '🏫', category: 'JLPT N5', audioUrl: null, imageUrl: null, exampleSentence: '毎朝、学校まで歩きます。', exampleTranslation: 'Sáng nào tôi cũng đi bộ đến trường.' },
  zh: { id: 'language-visual-zh', language: 'zh', translationLanguage: 'vi', word: '汉语', translation: 'tiếng Hán, tiếng Trung', explanation: 'The Chinese language.', phonetic: 'hàn yǔ', emoji: '🀄', category: 'HSK 1', audioUrl: null, imageUrl: null },
};

function Fixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);
  const kind = new URLSearchParams(location.search).get('kind') || 'en';
  const card = cards[kind] ?? cards.en;
  useEffect(() => { void loadCatalog(locale, 'practice').then(() => setReady(true)); }, [locale]);
  if (!ready) return null;
  return <main data-language-practice-visual-view={kind} className="min-h-screen grid place-items-center p-0 sm:p-6">
    <Suspense fallback={null}>
      <LanguagePracticeDrill card={card} cards={[card]} currentIndex={1} total={4} onClose={() => undefined} onNext={() => undefined} />
    </Suspense>
  </main>;
}

createRoot(document.getElementById('root')!).render(<ThemeProvider><I18nProvider><Fixture /></I18nProvider></ThemeProvider>);

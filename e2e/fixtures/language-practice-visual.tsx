import { createRoot } from 'react-dom/client';
import { Suspense, useEffect, useState } from 'react';
import '../../src/index.css';
import { LanguagePracticeDrill } from '../../src/features/languagePacks/LanguagePracticeDrill';
import { resolveStaticJapanesePitchAccent } from '../../src/features/languagePacks/japanesePitch';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';
import type { CardData } from '../../src/types/card';

const cards: Record<string, CardData> = {
  en: { id: 'language-visual-en', language: 'en', translationLanguage: 'vi', word: 'luminous', translation: 'phát sáng', explanation: 'Giving off light.', phonetic: '/ˈluːmɪnəs/', emoji: '✨', category: 'Science', audioUrl: null, imageUrl: null },
  ko: { id: 'language-visual-ko', language: 'ko', translationLanguage: 'vi', word: '결심', translation: 'quyết tâm', explanation: 'A firm decision to do something.', phonetic: '', emoji: '💪', category: 'TOPIK I', audioUrl: null, imageUrl: null },
  ja: { id: 'language-visual-ja', language: 'ja', translationLanguage: 'vi', word: '日本', translation: 'Nhật Bản', explanation: 'The country of Japan.', phonetic: 'にっぽん', japanesePitchAccent: resolveStaticJapanesePitchAccent({ word: '日本', phonetic: 'にっぽん' }), emoji: '🗾', category: 'JLPT N5', audioUrl: null, imageUrl: null, exampleSentence: '日本で日本語を勉強します。', exampleTranslation: 'Tôi học tiếng Nhật ở Nhật Bản.' },
  'ja-sentence': { id: 'language-visual-ja-sentence', language: 'ja', translationLanguage: 'vi', word: '毎朝', translation: 'mỗi sáng', explanation: 'Every morning.', phonetic: 'まいあさ', emoji: '☀️', category: 'JLPT N5', audioUrl: null, imageUrl: null, exampleSentence: '私は毎朝コーヒーを飲みます。', exampleTranslation: 'Sáng nào tôi cũng uống cà phê.' },
  'ja-evening': { id: 'language-visual-ja-evening', language: 'ja', translationLanguage: 'vi', word: '毎晩', translation: 'mỗi tối', explanation: 'Every night.', phonetic: 'まいばん', emoji: '🌙', category: 'JLPT N5', audioUrl: null, imageUrl: null },
  'ja-this-morning': { id: 'language-visual-ja-this-morning', language: 'ja', translationLanguage: 'vi', word: '今朝', translation: 'sáng nay', explanation: 'This morning.', phonetic: 'けさ', emoji: '🌅', category: 'JLPT N5', audioUrl: null, imageUrl: null },
  'ja-every-day': { id: 'language-visual-ja-every-day', language: 'ja', translationLanguage: 'vi', word: '毎日', translation: 'mỗi ngày', explanation: 'Every day.', phonetic: 'まいにち', emoji: '📅', category: 'JLPT N5', audioUrl: null, imageUrl: null },
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
      <LanguagePracticeDrill card={card} cards={kind === 'ja-sentence' ? [card, cards['ja-evening'], cards['ja-this-morning'], cards['ja-every-day']] : [card]} currentIndex={1} total={4} onClose={() => undefined} onNext={() => undefined} />
    </Suspense>
  </main>;
}

createRoot(document.getElementById('root')!).render(<ThemeProvider><I18nProvider><Fixture /></I18nProvider></ThemeProvider>);

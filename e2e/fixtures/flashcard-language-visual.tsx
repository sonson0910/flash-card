import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../../src/index.css';
import '../../src/styles/app-bootstrap.css';
import { Flashcard } from '../../src/components/Flashcard';
import { ActiveRecallPrompt } from '../../src/components/flashcard/ActiveRecallPrompt';
import { ReviewControls } from '../../src/components/study/ReviewControls';
import { resolveStaticJapanesePitchAccent } from '../../src/features/languagePacks/japanesePitch';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';
import type { CardData } from '../../src/types/card';

// The photo URL is on a trusted image host; the spec answers it with a Canvas board photo.
const fixturePhotoUrl = 'https://images.pexels.com/photos/123/flashcard-language.jpg';

// Sample cards follow the Canvas language-card boards (one per script family).
const cards: Record<string, CardData> = {
  en: {
    id: 'flashcard-language-en', language: 'en', translationLanguage: 'vi', word: 'immediate', translation: 'ngay lập tức',
    explanation: 'Happening or done without delay; acting or occurring at once.', explanationTranslation: 'Xảy ra hoặc được thực hiện ngay, không chậm trễ.',
    phonetic: '/ɪˈmiːdiət/', emoji: '⚡', category: 'Time and action', partOfSpeech: 'adjective', audioUrl: null, imageUrl: fixturePhotoUrl,
    exampleSentence: 'The new policy takes immediate effect.', exampleTranslation: 'Chính sách mới có hiệu lực ngay lập tức.',
    collocations: ['immediate effect', 'immediate action', 'an immediate response'],
  },
  ko: {
    id: 'flashcard-language-ko', language: 'ko', translationLanguage: 'vi', word: '결심하다', translation: 'quyết tâm',
    explanation: 'To make a firm decision to do something.', phonetic: 'gyeol-sim-ha-da', emoji: '💪', category: 'TOPIK II', partOfSpeech: 'verb',
    audioUrl: null, imageUrl: null, exampleSentence: '올해는 한국어를 꼭 배우기로 결심했어요.', exampleTranslation: 'Năm nay tôi đã quyết tâm nhất định học tiếng Hàn.',
  },
  ja: {
    id: 'flashcard-language-ja', language: 'ja', translationLanguage: 'vi', word: '経験', translation: 'kinh nghiệm',
    explanation: 'Knowledge or skill gained from doing something.', phonetic: 'けいけん', emoji: '🧭', category: 'JLPT N3', partOfSpeech: 'noun',
    audioUrl: null, imageUrl: null, exampleSentence: '日本で働いた経験があります。', exampleTranslation: 'Tôi đã có kinh nghiệm làm việc ở Nhật.',
  },
  zh: {
    id: 'flashcard-language-zh', language: 'zh', translationLanguage: 'vi', word: '机会', translation: 'cơ hội',
    explanation: 'A favourable time or set of circumstances for doing something.', phonetic: 'jī huì', emoji: '🚪', category: 'HSK 3', partOfSpeech: 'noun',
    audioUrl: null, imageUrl: null, exampleSentence: '这是一个很好的机会。', exampleTranslation: 'Đây là một cơ hội rất tốt.',
  },
};
cards.ja.japanesePitchAccent = resolveStaticJapanesePitchAccent(cards.ja);

function Fixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);
  const params = new URLSearchParams(location.search);
  const kind = params.get('kind') || 'en';
  const side = params.get('side') === 'back' ? 'back' : 'front';
  const view = params.get('view') === 'review' ? 'review' : 'card';
  const card = cards[kind] ?? cards.en;
  const [starred, setStarred] = useState(false);
  useEffect(() => {
    void Promise.all([loadCatalog(locale, 'components'), loadCatalog(locale, 'practice')]).then(() => setReady(true));
  }, [locale]);
  if (!ready) return null;
  if (view === 'review') {
    return <main data-flashcard-language-view={`${kind}-review-${side}`} className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-6">
      {side === 'front'
        ? <ActiveRecallPrompt card={card} mode="target-to-native" onReveal={() => undefined} />
        : <div data-study-card className="w-full max-w-[460px]"><Flashcard data={card} initialSide="back" onToggleBookmark={() => setStarred(value => !value)} /></div>}
      <ReviewControls revealed={side === 'back'} reviewed={false} onRate={() => undefined} />
    </main>;
  }
  return <main data-flashcard-language-view={`${kind}-${side}`} className="grid min-h-screen place-items-center px-4 py-6">
    <div className="w-full max-w-[460px]">
      <Flashcard data={{ ...card, bookmarked: starred }} initialSide={side} onToggleBookmark={() => setStarred(value => !value)} onDelete={() => undefined} />
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<ThemeProvider><I18nProvider><Fixture /></I18nProvider></ThemeProvider>);

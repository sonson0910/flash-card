import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../../src/index.css';
import '../../src/styles/themes/crystal-motion.css';
import '../../src/styles/themes/classic-motion.css';
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
const baseEnglishPictureCard: CardData = {
  id: 'flashcard-language-en-picture', language: 'en', translationLanguage: 'vi', word: 'immediate', translation: 'ngay lập tức',
  explanation: 'Happening or done without delay; acting or occurring at once.', explanationTranslation: 'Xảy ra hoặc được thực hiện ngay, không chậm trễ.',
  phonetic: '/ɪˈmiːdiət/', emoji: '⚡', category: 'Time and action', partOfSpeech: 'adjective', audioUrl: null, imageUrl: fixturePhotoUrl,
  exampleSentence: 'The new policy takes immediate effect.', exampleTranslation: 'Chính sách mới có hiệu lực ngay lập tức.',
  collocations: ['immediate effect', 'immediate action', 'an immediate response'],
};

const cards: Record<string, CardData> = {
  en: {
    ...baseEnglishPictureCard,
    id: 'flashcard-language-en',
    category: 'IELTS · B2',
    imageUrl: null,
    explanationTranslation: 'Hay đi với effect, action, response. Trạng từ: immediately.',
    wordFamily: { adv: 'immediately', noun: 'immediacy' },
    antonyms: ['delayed'],
    languageDetails: {
      pronunciations: [{ tag: 'UK', ipa: '/ɪˈmiːdiət/' }, { tag: 'US', ipa: '/ɪˈmidiət/' }],
      syllables: ['im', 'me', 'di', 'ate'],
      stressIndex: 1,
    },
  },
  'en-plain': {
    ...baseEnglishPictureCard,
    id: 'flashcard-language-en-plain',
    imageUrl: null,
  },
  'en-picture': {
    ...baseEnglishPictureCard,
    id: 'flashcard-language-en',
  },
  fr: {
    id: 'flashcard-language-fr', language: 'fr', translationLanguage: 'en', word: 'la décision', translation: 'decision',
    explanation: 'prendre une décision = to make a decision. Nouns ending in -sion are feminine.',
    explanationTranslation: 'prendre une décision = to make a decision. Nouns ending in -sion are feminine.',
    phonetic: '/de.si.zjɔ̃/', emoji: '🧭', category: 'DELF B1', partOfSpeech: 'noun', audioUrl: null, imageUrl: null,
    exampleSentence: 'Elle a pris une décision importante.', exampleTranslation: 'She made an important decision.',
    collocations: ['prendre une décision', 'une décision difficile'],
    wordFamily: { verb: 'décider', adj: 'décisif' },
    languageDetails: {
      pronunciations: [{ tag: 'FR', ipa: '/de.si.zjɔ̃/' }],
      syllables: ['dé', 'ci', 'sion'],
      stressIndex: 2,
      article: 'la',
      indefiniteArticle: 'une',
      gender: 'f',
      plural: 'les décisions',
      hints: ['-sion → feminine'],
    },
  },
  de: {
    id: 'flashcard-language-de', language: 'de', translationLanguage: 'en', word: 'die Entscheidung', translation: 'decision',
    explanation: 'eine Entscheidung treffen = to make a decision. Nouns ending in -ung are always feminine.',
    explanationTranslation: 'eine Entscheidung treffen = to make a decision. Nouns ending in -ung are always feminine.',
    phonetic: '/ɛntˈʃaɪ̯dʊŋ/', emoji: '🧭', category: 'Goethe B1', partOfSpeech: 'noun', audioUrl: null, imageUrl: null,
    exampleSentence: 'Wir müssen eine Entscheidung treffen.', exampleTranslation: 'We have to make a decision.',
    collocations: ['eine Entscheidung treffen', 'die richtige Entscheidung'],
    wordFamily: { verb: 'entscheiden', adj: 'entscheidend' },
    languageDetails: {
      pronunciations: [{ tag: 'DE', ipa: '/ɛntˈʃaɪ̯dʊŋ/' }],
      syllables: ['Ent', 'schei', 'dung'],
      stressIndex: 1,
      article: 'die',
      indefiniteArticle: 'eine',
      gender: 'f',
      plural: 'die Entscheidungen',
      hints: ['-ung → always die'],
    },
  },
  es: {
    id: 'flashcard-language-es', language: 'es', translationLanguage: 'en', word: 'la decisión', translation: 'decision',
    explanation: 'tomar una decisión = to make a decision. The written accent drops in the plural: decisiones.',
    explanationTranslation: 'tomar una decisión = to make a decision. The written accent drops in the plural: decisiones.',
    phonetic: '/de.θiˈsjon/', emoji: '🧭', category: 'DELE B1', partOfSpeech: 'noun', audioUrl: null, imageUrl: null,
    exampleSentence: 'Tomé una decisión difícil.', exampleTranslation: 'I made a difficult decision.',
    collocations: ['tomar una decisión', 'una decisión difícil'],
    wordFamily: { verb: 'decidir', adj: 'decisivo' },
    languageDetails: {
      pronunciations: [{ tag: 'ES', ipa: '/de.θiˈsjon/' }, { tag: 'LatAm', ipa: '/de.siˈsjon/' }],
      syllables: ['de', 'ci', 'sión'],
      stressIndex: 2,
      article: 'la',
      indefiniteArticle: 'una',
      gender: 'f',
      plural: 'las decisiones',
      hints: ['Accent drops in plural'],
    },
  },
  ko: {
    id: 'flashcard-language-ko', language: 'ko', translationLanguage: 'vi', word: '결심하다', translation: 'quyết tâm',
    explanation: 'To make a firm decision to do something.',
    explanationTranslation: 'Cấu trúc -기로 결심하다: quyết tâm làm gì. 결심 đọc là [결씸] vì âm căng hoá sau ㄹ.',
    phonetic: 'gyeol-sim-ha-da', emoji: '💪', category: 'TOPIK II', partOfSpeech: 'verb',
    audioUrl: null, imageUrl: null, exampleSentence: '올해는 한국어를 꼭 배우기로 결심했어요.', exampleTranslation: 'Năm nay tôi đã quyết tâm nhất định học tiếng Hàn.',
    collocations: ['결심을 하다', '굳게 결심하다', '-기로 결심하다'],
    synonyms: ['결정하다 · quyết định', '다짐하다 · tự hứa', '결심 · danh từ'],
    languageDetails: {
      sinoForm: { source: '決心', reading: 'quyết tâm' },
      spokenForm: '[결씸하다]',
      exampleReading: 'Olhaeneun hangugeoreul kkok baeugiro gyeolsimhaesseoyo.',
      hints: ['Động từ 하다'],
    },
  },
  ja: {
    id: 'flashcard-language-ja', language: 'ja', translationLanguage: 'vi', word: '経験', translation: 'kinh nghiệm',
    explanation: 'Knowledge or skill gained from doing something.',
    explanationTranslation: '〜た経験がある: đã từng làm gì. Âm điệu bằng (heiban): け thấp, các âm sau cao và không hạ.',
    phonetic: 'けいけん', emoji: '🧭', category: 'JLPT N3', partOfSpeech: 'noun',
    audioUrl: null, imageUrl: null, exampleSentence: '日本で働いた経験があります。', exampleTranslation: 'Tôi đã có kinh nghiệm làm việc ở Nhật.',
    collocations: ['経験がある', '経験を積む', '経験者'],
    synonyms: ['経験する · trải qua', '経験者 · người có kinh nghiệm', '体験 · trải nghiệm'],
    languageDetails: {
      sinoForm: { source: '經驗', reading: 'kinh nghiệm' },
      exampleReading: 'Nihon de hataraita keiken ga arimasu.',
      hints: ['Động từ: 経験する'],
    },
  },
  zh: {
    id: 'flashcard-language-zh', language: 'zh', translationLanguage: 'vi', word: '机会', translation: 'cơ hội',
    explanation: 'A favourable time or set of circumstances for doing something.',
    explanationTranslation: 'Lượng từ 个: 一个机会 (yí ge jīhuì). Cụm hay gặp: 抓住机会 zhuāzhù jīhuì — nắm bắt cơ hội.',
    phonetic: 'jī huì', emoji: '🚪', category: 'HSK 3', partOfSpeech: 'noun',
    audioUrl: null, imageUrl: null, exampleSentence: '这是一个很好的机会。', exampleTranslation: 'Đây là một cơ hội rất tốt.',
    collocations: ['有机会', '抓住机会', '一个好机会'],
    synonyms: ['机遇 · jīyù · thời cơ', '时机 · shíjī · thời điểm'],
    languageDetails: {
      sinoForm: { source: '機會', reading: 'cơ hội' },
      measureWord: { word: '个', reading: 'gè' },
      exampleReading: 'Zhè shì yí ge hěn hǎo de jīhuì.',
    },
  },
  // A verified pitch accent draws the mora contour; this card has no example or phrases, so both blocks are left out.
  'ja-pitch': {
    id: 'flashcard-language-ja-pitch', language: 'ja', translationLanguage: 'vi', word: '日本', translation: 'Nhật Bản',
    explanation: 'The country of Japan.', phonetic: 'にっぽん', emoji: '🗾', category: 'JLPT N5', partOfSpeech: 'noun', audioUrl: null, imageUrl: null,
  },
};
cards.ja.japanesePitchAccent = resolveStaticJapanesePitchAccent(cards.ja);
cards['ja-pitch'].japanesePitchAccent = resolveStaticJapanesePitchAccent(cards['ja-pitch']);

function Fixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);
  const params = new URLSearchParams(location.search);
  const kind = params.get('kind') || 'en';
  const side = params.get('side') === 'back' ? 'back' : 'front';
  const view = params.get('view') === 'review' || params.get('view') === 'dialog' ? params.get('view') : 'card';
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
  if (view === 'dialog') {
    // A dialog that hosts the card, as onboarding does: a tap on the face must still turn it.
    return <main data-flashcard-language-view={`${kind}-dialog-${side}`} className="grid min-h-screen place-items-center px-4 py-6">
      <div role="dialog" aria-modal="true" aria-label="Card trial" className="w-full max-w-[460px]">
        <Flashcard data={card} initialSide={side} />
      </div>
    </main>;
  }
  return <main data-flashcard-language-view={`${kind}-${side}`} className="grid min-h-screen place-items-center px-4 py-6">
    <div className="w-full max-w-[460px]">
      <Flashcard data={{ ...card, bookmarked: starred }} initialSide={side} onToggleBookmark={() => setStarred(value => !value)} onDelete={() => undefined} />
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<ThemeProvider><I18nProvider><Fixture /></I18nProvider></ThemeProvider>);

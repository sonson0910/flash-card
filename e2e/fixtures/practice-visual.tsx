import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useState } from 'react';
import '../../src/index.css';
import { AppOverlays } from '../../src/components/AppOverlays';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';
import type { CardData } from '../../src/types/card';

const QuizView = lazy(() => import('../../src/features/practice/QuizView').then(module => ({ default: module.QuizView })));
const SpellingView = lazy(() => import('../../src/features/practice/SpellingView').then(module => ({ default: module.SpellingView })));
const StoryView = lazy(() => import('../../src/features/practice/StoryView').then(module => ({ default: module.StoryView })));
const WordMatchView = lazy(() => import('../../src/features/practice/WordMatchView').then(module => ({ default: module.WordMatchView })));
const ShadowingView = lazy(() => import('../../src/features/practice/ShadowingView').then(module => ({ default: module.ShadowingView })));
const ReviewFlashcard = lazy(() => import('../../src/components/Flashcard').then(module => ({ default: module.Flashcard })));

const cards: CardData[] = [
  ['adapt', 'thích nghi'], ['benefit', 'lợi ích'], ['context', 'bối cảnh'],
  ['develop', 'phát triển'], ['evidence', 'bằng chứng'], ['focus', 'tập trung'],
].map(([word, translation], index) => ({
  id: `practice-visual-${index}`,
  word,
  normalizedWord: word,
  translation,
  explanation: '',
  phonetic: '',
  emoji: '📚',
  category: 'IELTS',
  audioUrl: null,
  imageUrl: null,
  language: 'en',
  translationLanguage: 'vi',
  exampleSentence: `We ${word} this visual practice example with care.`,
}));

const quiz = [{
  card: cards[0],
  type: 'target-to-native' as const,
  correctAnswer: cards[0].translation,
  options: [cards[0].translation, cards[1].translation, cards[2].translation, cards[3].translation],
}];

const koreanReviewCard: CardData = {
  id: 'practice-visual-korean-review', language: 'ko', translationLanguage: 'vi',
  word: '결심하다', translation: 'quyết tâm', explanation: 'To make a firm decision.',
  phonetic: '', emoji: '💪', category: 'TOPIK I', audioUrl: null, imageUrl: null,
};

const noop = () => undefined;
const asyncNoop = async () => undefined;
const emptyStats = { total: 0, learned: 0, learning: 0, dueToday: 0, categoryChart: [], categoryChartIsPartial: false, difficultyChart: [], xpChartData: [] };

function PracticeFixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);
  const [spellingChecks, setSpellingChecks] = useState(0);
  const view = new URLSearchParams(location.search).get('view') || 'quiz';
  const isCheckedSpelling = view === 'spelling-checked';

  useEffect(() => { void Promise.all([loadCatalog(locale, 'practice'), loadCatalog(locale, 'shell'), loadCatalog(locale, 'components')]).then(() => setReady(true)); }, [locale]);
  if (!ready) return null;

  return <main data-practice-visual-view={view} className="min-h-screen px-4 py-5 sm:px-8 sm:py-8"><Suspense fallback={null}>
    {(view === 'quiz' || view === 'quiz-answered') && <QuizView questions={quiz} currentIndex={0} selectedAnswer={view === 'quiz-answered' ? cards[0].translation : null} answeredCorrectly={view === 'quiz-answered' ? true : null} score={view === 'quiz-answered' ? 1 : 0} showResults={false} onSelect={noop} onNext={noop} onRestart={noop} onClose={noop} />}
    {(view === 'spelling' || isCheckedSpelling) && <><SpellingView cards={cards} currentIndex={0} input={isCheckedSpelling ? cards[0].word : ''} checked={isCheckedSpelling} correct={isCheckedSpelling} score={isCheckedSpelling ? 1 : 0} showResults={false} onInput={noop} onCheck={event => { event.preventDefault(); setSpellingChecks(count => count + 1); }} onNext={noop} onRestart={noop} onClose={noop} /><span data-spelling-check-count hidden>{spellingChecks}</span></>}
    {view === 'story' && <StoryView story={{ story: 'Careful learners adapt their study plan when new evidence gives useful context.', translation: 'Người học cẩn thận điều chỉnh kế hoạch học khi bằng chứng mới mang lại bối cảnh hữu ích.', language: 'en', translationLanguage: 'vi' }} loading={false} onGenerate={noop} onClose={noop} />}
    {view === 'match' && <WordMatchView cards={cards} onClose={noop} onAddXp={noop} />}
    {view === 'shadowing' && <ShadowingView cards={cards} onClose={noop} />}
    {view === 'ko-review' && <div className="mx-auto max-w-3xl"><ReviewFlashcard data={koreanReviewCard} editorContext={{ kind: 'review', current: 1, total: 4 }} /></div>}
    {view === 'dialog' && <AppOverlays
      shareDialogOpen={false} shareLink={null} shareWarning={null} incomingSharePreview={null}
      dismissShareDialog={noop} showShareDialog={noop} acceptSharedDeck={asyncNoop} cancelSharedDeck={noop}
      canRevokeShare={false} revokeShare={asyncNoop} isSharing={false}
      isPracticeMenuOpen setIsPracticeMenuOpen={noop} startQuiz={asyncNoop} startSpelling={asyncNoop}
      startMatch={asyncNoop} startShadowing={asyncNoop} practiceCards={cards} visibleLibraryCount={cards.length}
      generateStory={asyncNoop} isStatsOpen={false} setIsStatsOpen={noop} statsData={emptyStats} isDarkMode={false}
      showClearConfirm={false} setShowClearConfirm={noop} clearAll={asyncNoop} isLoading={false}
      shareOpenerRef={{ current: null }} practiceOpenerRef={{ current: null }} statsOpenerRef={{ current: null }} clearOpenerRef={{ current: null }}
    />}</Suspense>
  </main>;
}

Math.random = () => 0.37;

createRoot(document.getElementById('root')!).render(<ThemeProvider><I18nProvider><PracticeFixture /></I18nProvider></ThemeProvider>);

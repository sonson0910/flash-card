import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useState } from 'react';
import '../../src/index.css';
import '../../src/styles/app-bootstrap.css';
import '../../src/features/practice/practice-board.css';
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

const cardDetails: Record<string, Partial<CardData>> = {
  adapt: { phonetic: '/əˈdæpt/', partOfSpeech: 'verb', explanation: 'to change so that you can deal with a new situation', reviews: 3, difficulty: 'good', exampleSentence: 'Good learners adapt their plan when the evidence changes.', exampleTranslation: 'Người học giỏi điều chỉnh kế hoạch khi bằng chứng thay đổi.' },
  benefit: { phonetic: '/ˈbenɪfɪt/', partOfSpeech: 'noun', explanation: 'a helpful or good effect', reviews: 5, interval: 30, difficulty: 'good', exampleSentence: 'The main benefit of spaced review is long-term memory.' },
  context: { phonetic: '/ˈkɒntekst/', partOfSpeech: 'noun', explanation: 'the situation in which something happens', reviews: 2, difficulty: 'hard', nextReviewDate: '2026-09-27T09:00:00.000Z', exampleSentence: 'Read the word in context before you guess its meaning.' },
};

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
  ...cardDetails[word],
}));

// A ten-question run paused on the seventh question, as on the quiz board.
const quizOrder = [3, 4, 5, 1, 2, 4, 0, 1, 2, 3];
const quiz = quizOrder.map(index => ({
  card: cards[index],
  type: 'target-to-native' as const,
  correctAnswer: cards[index].translation,
  options: [0, 1, 2, 3].map(offset => cards[(index + offset) % cards.length].translation),
}));
const quizIndex = 6;
const quizOutcomes = [true, true, true, false, true, true];

// A spelling run on its fifth word ("evidence"), typed part way or checked with a missing letter.
const spellingIndex = 4;
const spellingOutcomes = [true, true, false, true];

// A story written from the six fixture words, as the story board shows it.
const story = {
  story: 'Mai woke before the city did. Her plan for the year was simple: focus on ten quiet minutes of English before work, and learn each new word from its context.\n'
    + 'By March the benefit was clear. She could adapt her answers in meetings, and her notes held real evidence of progress. Small habits, she decided, develop into lasting skills.',
  translation: 'Mai thức dậy trước cả thành phố. Kế hoạch năm nay của cô rất đơn giản: tập trung mười phút yên tĩnh học tiếng Anh trước giờ làm, và học mỗi từ mới qua bối cảnh của nó. Đến tháng Ba, lợi ích đã rõ ràng. Cô có thể điều chỉnh câu trả lời trong các cuộc họp, và ghi chép của cô là bằng chứng thật về sự tiến bộ. Cô nhận ra những thói quen nhỏ sẽ phát triển thành kỹ năng bền vững.',
  language: 'en',
  translationLanguage: 'vi',
  cards,
};

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

  return <Suspense fallback={null}><main data-practice-visual-view={view} className="min-h-screen px-4 py-5 sm:px-8 sm:py-8">
    {(view === 'quiz' || view === 'quiz-answered' || view === 'quiz-wrong') && <QuizView questions={quiz} currentIndex={quizIndex}
      selectedAnswer={view === 'quiz-answered' ? quiz[quizIndex].correctAnswer : view === 'quiz-wrong' ? quiz[quizIndex].options[1] : null}
      answeredCorrectly={view === 'quiz-answered' ? true : view === 'quiz-wrong' ? false : null}
      score={quizOutcomes.filter(Boolean).length + (view === 'quiz-answered' ? 1 : 0)}
      outcomes={view === 'quiz' ? quizOutcomes : [...quizOutcomes, view === 'quiz-answered']}
      showResults={false} onSelect={noop} onNext={noop} onRestart={noop} onClose={noop} />}
    {(view === 'spelling' || isCheckedSpelling || view === 'spelling-wrong') && <><SpellingView cards={cards}
      currentIndex={isCheckedSpelling ? 0 : spellingIndex}
      input={isCheckedSpelling ? cards[0].word : view === 'spelling-wrong' ? 'evidnce' : 'evid'}
      checked={view !== 'spelling'} correct={isCheckedSpelling}
      score={isCheckedSpelling ? 1 : spellingOutcomes.filter(Boolean).length}
      outcomes={isCheckedSpelling ? [true] : view === 'spelling-wrong' ? [...spellingOutcomes, false] : spellingOutcomes}
      showResults={false} onInput={noop} onCheck={event => { event.preventDefault(); setSpellingChecks(count => count + 1); }}
      onReveal={noop} onSkip={noop} onNext={noop} onRestart={noop} onClose={noop} /><span data-spelling-check-count hidden>{spellingChecks}</span></>}
    {(view === 'story' || view === 'story-word') && <StoryView story={story} loading={false} onGenerate={noop} onClose={noop} onReviewCards={noop} />}
    {view === 'story-error' && <StoryView story={null} loading={false} error="Could not generate a story right now. Please try again." onGenerate={noop} onClose={noop} onReviewCards={noop} />}
    {(view === 'match' || view === 'match-progress') && <WordMatchView cards={cards} onClose={noop} onAddXp={noop} />}
    {(view === 'shadowing' || view === 'shadowing-result') && <ShadowingView cards={cards} onClose={noop} />}
    {view === 'ko-review' && <div className="mx-auto max-w-3xl"><ReviewFlashcard data={koreanReviewCard} editorContext={{ kind: 'review', current: 1, total: 4 }} /></div>}
    {view === 'dialog' && <AppOverlays
      shareDialogOpen={false} shareLink={null} shareWarning={null} incomingSharePreview={null}
      dismissShareDialog={noop} showShareDialog={noop} acceptSharedDeck={asyncNoop} cancelSharedDeck={noop}
      canRevokeShare={false} revokeShare={asyncNoop} isSharing={false}
      isPracticeMenuOpen setIsPracticeMenuOpen={noop} startQuiz={asyncNoop} startSpelling={asyncNoop}
      startMatch={asyncNoop} startShadowing={asyncNoop} practiceCards={cards} visibleLibraryCount={cards.length}
      generateStory={asyncNoop} isStatsOpen={false} setIsStatsOpen={noop} statsData={emptyStats} isDarkMode={false}
      showClearConfirm={false} setShowClearConfirm={noop} clearAll={asyncNoop} clearStatus="idle" clearError={null} resetClearFeedback={noop} isLoading={false}
      shareOpenerRef={{ current: null }} practiceOpenerRef={{ current: null }} statsOpenerRef={{ current: null }} clearOpenerRef={{ current: null }}
    />}
  </main></Suspense>;
}

Math.random = () => 0.37;

createRoot(document.getElementById('root')!).render(<ThemeProvider><I18nProvider><PracticeFixture /></I18nProvider></ThemeProvider>);

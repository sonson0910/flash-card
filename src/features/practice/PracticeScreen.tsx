import { lazy, Suspense } from 'react';
import type { PracticeWorkspace } from './usePracticeWorkspace';

const QuizView = lazy(() => import('./QuizView').then(module => ({ default: module.QuizView })));
const SpellingView = lazy(() => import('./SpellingView').then(module => ({ default: module.SpellingView })));
const StoryView = lazy(() => import('./StoryView').then(module => ({ default: module.StoryView })));
const loadStudyView = (() => {
  let promise: Promise<{ default: typeof import('./StudyView').StudyView }> | null = null;
  return () => {
    if (!promise) {
      promise = import('./StudyView')
        .then(module => ({ default: module.StudyView }))
        .catch(error => {
          promise = null;
          throw error;
        });
    }
    return promise;
  };
})();
const StudyView = lazy(loadStudyView);
const WordMatchView = lazy(() => import('./WordMatchView').then(module => ({ default: module.WordMatchView })));
const ShadowingView = lazy(() => import('./ShadowingView').then(module => ({ default: module.ShadowingView })));

export function preloadStudyView() {
  void loadStudyView().catch(() => undefined);
}

function PracticeFallback({ label, wide = false }: { label: string; wide?: boolean }) {
  return (
    <div className={`skeleton-sheen min-h-40 rounded-[26px] border border-[var(--sf-border)] mx-auto ${wide ? 'max-w-4xl' : 'max-w-2xl'}`} role="status">
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function PracticeScreen({
  session,
  actions,
  customDecks,
}: {
  session: PracticeWorkspace['model']['session'];
  actions: PracticeWorkspace['actions'];
  customDecks: string[];
}) {
  const { mode, study, quiz, learning } = session;
  const commands = actions;

  if (mode === 'study') {
    return (
      <Suspense fallback={<PracticeFallback label="Loading study session" wide />}>
        <StudyView
          cards={study.cards}
          index={study.index}
          recallMode={study.recallMode}
          revealed={study.revealed}
          reviewedCardId={study.reviewedCardId}
          reviewStatus={study.reviewStatus}
          reviewError={study.reviewError}
          customDecks={customDecks}
          onClose={commands.close}
          onRecallMode={commands.setRecallMode}
          onReveal={commands.reveal}
          onBookmark={learning.toggleBookmark}
          onAssignDeck={learning.assignDeck}
          onUpdateCard={learning.updateCard}
          onRate={rating => void commands.submitStudyRating(rating)}
          onIndex={commands.setStudyIndex}
        />
      </Suspense>
    );
  }
  if (mode === 'quiz') {
    return (
      <Suspense fallback={<PracticeFallback label="Loading quiz" />}>
        <QuizView
          questions={quiz.quizQuestions}
          currentIndex={quiz.currentQuizIndex}
          selectedAnswer={quiz.selectedAnswer}
          answeredCorrectly={quiz.answeredCorrectly}
          score={quiz.quizScore}
          showResults={quiz.showQuizResults}
          onSelect={quiz.selectQuizAnswer}
          onNext={quiz.nextQuizQuestion}
          onRestart={commands.startQuiz}
          onClose={commands.close}
        />
      </Suspense>
    );
  }
  if (mode === 'spelling') {
    return (
      <Suspense fallback={<PracticeFallback label="Loading spelling practice" />}>
        <SpellingView
          cards={quiz.spellingCards}
          currentIndex={quiz.currentSpellingIndex}
          input={quiz.spellingInput}
          checked={quiz.spellingChecked}
          correct={quiz.spellingCorrect}
          score={quiz.spellingScore}
          showResults={quiz.showSpellingResults}
          onInput={quiz.setSpellingInput}
          onCheck={quiz.checkSpelling}
          onNext={quiz.nextSpelling}
          onRestart={commands.startSpelling}
          onClose={commands.close}
        />
      </Suspense>
    );
  }
  if (mode === 'match') {
    return (
      <Suspense fallback={<PracticeFallback label="Loading word match" />}>
        <WordMatchView
          cards={quiz.spellingCards.length > 0 ? quiz.spellingCards : study.cards}
          onClose={commands.close}
        />
      </Suspense>
    );
  }
  if (mode === 'shadowing') {
    return (
      <Suspense fallback={<PracticeFallback label="Loading shadowing arena" />}>
        <ShadowingView
          cards={quiz.spellingCards.length > 0 ? quiz.spellingCards : study.cards}
          onClose={commands.close}
        />
      </Suspense>
    );
  }
  if (mode === 'story') {
    return (
      <Suspense fallback={<PracticeFallback label="Loading story" />}>
        <StoryView story={quiz.story} loading={quiz.isGeneratingStory} error={quiz.storyError} onGenerate={commands.generateStory} onClose={commands.close} />
      </Suspense>
    );
  }
  return null;
}

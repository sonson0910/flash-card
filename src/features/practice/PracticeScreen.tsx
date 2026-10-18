import { msg } from '@lingui/core/macro';
import { lazy, Suspense, type ReactNode } from 'react';
import { Trans } from '@lingui/react';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import type { PracticeWorkspace } from './usePracticeWorkspace';
import './practice-board.css';

const QuizView = lazy(() => import('./QuizView').then(module => ({ default: module.QuizView })));
const SpellingView = lazy(() => import('./SpellingView').then(module => ({ default: module.SpellingView })));
const StoryView = lazy(() => import('./StoryView').then(module => ({ default: module.StoryView })));
const StudyView = lazy(() => import('./StudyView').then(module => ({ default: module.StudyView })));
const WordMatchView = lazy(() => import('./WordMatchView').then(module => ({ default: module.WordMatchView })));
const ShadowingView = lazy(() => import('./ShadowingView').then(module => ({ default: module.ShadowingView })));
const LanguagePracticeDrill = lazy(() => Promise.all([
  import('../languagePacks/LanguagePracticeDrill'), loadCatalog(getActiveUiLocale(), 'practice'),
]).then(([module]) => ({ default: module.LanguagePracticeDrill })));
const LanguagePracticeDrillResults = lazy(() => Promise.all([
  import('../languagePacks/LanguagePracticeDrill'), loadCatalog(getActiveUiLocale(), 'practice'),
]).then(([module]) => ({ default: module.LanguagePracticeDrillResults })));

function PracticeFallback({ label, wide = false }: { label: ReactNode; wide?: boolean }) {
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
  openWeeklyRecap,
  onDeleteCard,
}: {
  session: PracticeWorkspace['model']['session'];
  actions: PracticeWorkspace['actions'];
  customDecks: string[];
  openWeeklyRecap: () => void;
  onDeleteCard?: (cardId: string) => Promise<boolean>;
}) {
  const { mode, study, quiz, learning } = session;
  const commands = actions;

  if (mode === 'study') {
    return (
      <Suspense fallback={<PracticeFallback label={<Trans {...msg({ context: 'practice.loading.study', message: 'Loading study session' })} />} wide />}>
        <StudyView
          key={study.sessionKey}
          cards={study.cards}
          index={study.index}
          recallMode={study.recallMode}
          revealed={study.revealed}
          needsIntroduction={study.needsIntroduction}
          reviewedCardId={study.reviewedCardId}
          reviewStatus={study.reviewStatus}
          reviewError={study.reviewError}
          paused={study.isPaused}
          customDecks={customDecks}
          onClose={commands.close}
          onViewWeeklyRecap={() => { commands.close(); openWeeklyRecap(); }}
          goodCount={study.goodCount}
          againCount={study.againCount}
          weakCards={study.weakCards}
          showRecap={study.showRecap}
          summary={study.summary}
          xpEarned={study.xpEarned}
          onDismissRecap={commands.dismissStudyRecap}
          onBeginStudyRecall={commands.beginStudyRecall}
          onLearnFirst={commands.requestStudyIntroduction}
          onRetryWeak={() => void commands.startStudy({ cards: study.weakCards })}
          onRecallMode={commands.setRecallMode}
          onReveal={commands.reveal}
          onBookmark={learning.toggleBookmark}
          onAssignDeck={learning.assignDeck}
          onUpdateCard={learning.updateCard}
          onDeleteCard={onDeleteCard}
          onRate={commands.submitStudyRating}
          onIndex={commands.setStudyIndex}
          onEditorOpenChange={commands.setStudyEditorOpen}
        />
      </Suspense>
    );
  }
  if (mode === 'quiz') {
    return (
      <Suspense fallback={<PracticeFallback label={<Trans {...msg({ context: 'practice.loading.quiz', message: 'Loading quiz' })} />} />}>
        <QuizView
          questions={quiz.quizQuestions}
          currentIndex={quiz.currentQuizIndex}
          selectedAnswer={quiz.selectedAnswer}
          answeredCorrectly={quiz.answeredCorrectly}
          score={quiz.quizScore}
          showResults={quiz.showQuizResults}
          savingResult={quiz.quizCompletionSaving}
          onSelect={quiz.selectQuizAnswer}
          onLearnFirst={() => { const card = quiz.quizQuestions[quiz.currentQuizIndex]?.card; if (card) void commands.startStudy({ cards: [card], introduce: true }); }}
          onNext={quiz.nextQuizQuestion}
          onRestart={commands.startQuiz}
          onClose={commands.close}
        />
      </Suspense>
    );
  }
  if (mode === 'spelling') {
    return (
      <Suspense fallback={<PracticeFallback label={<Trans {...msg({ context: 'practice.loading.spelling', message: 'Loading spelling practice' })} />} />}>
        <SpellingView
          cards={quiz.spellingCards}
          currentIndex={quiz.currentSpellingIndex}
          input={quiz.spellingInput}
          checked={quiz.spellingChecked}
          correct={quiz.spellingCorrect}
          score={quiz.spellingScore}
          showResults={quiz.showSpellingResults}
          savingResult={quiz.spellingCompletionSaving}
          onInput={quiz.setSpellingInput}
          onLearnFirst={() => { const card = quiz.spellingCards[quiz.currentSpellingIndex]; if (card) void commands.startStudy({ cards: [card], introduce: true }); }}
          onCheck={quiz.checkSpelling}
          onNext={quiz.nextSpelling}
          onRestart={commands.startSpelling}
          onClose={commands.close}
        />
      </Suspense>
    );
  }
  if (mode === 'language-drill') {
    const card = quiz.languageDrillCards[quiz.currentLanguageDrillIndex];
    return (
      <Suspense fallback={<PracticeFallback label={<Trans {...msg({ context: 'practice.loading.language-drill', message: 'Loading language drill' })} />} />}>
        {quiz.showLanguageDrillResults ? (
          <LanguagePracticeDrillResults
            correct={quiz.languageDrillCorrect}
            total={quiz.languageDrillCards.length}
            onRestart={commands.startLanguageDrill}
            onClose={commands.close}
          />
        ) : card ? (
          <LanguagePracticeDrill
            card={card}
            cards={quiz.languageDrillCards}
            currentIndex={quiz.currentLanguageDrillIndex}
            total={quiz.languageDrillCards.length}
            onClose={commands.close}
            onNext={result => commands.completeLanguageDrill(result.correct)}
          />
        ) : null}
      </Suspense>
    );
  }
  if (mode === 'match') {
    return (
      <Suspense fallback={<PracticeFallback label={<Trans {...msg({ context: 'practice.loading.match', message: 'Loading word match' })} />} />}>
        <WordMatchView
          key={session.sessionKey}
          cards={quiz.spellingCards.length > 0 ? quiz.spellingCards : study.cards}
          onClose={commands.close}
          onComplete={quiz.completeMatch}
          onNewRound={quiz.restartMatch}
        />
      </Suspense>
    );
  }
  if (mode === 'shadowing') {
    return (
      <Suspense fallback={<PracticeFallback label={<Trans {...msg({ context: 'practice.loading.shadowing', message: 'Loading shadowing practice' })} />} />}>
        <ShadowingView
          key={session.sessionKey}
          cards={quiz.spellingCards.length > 0 ? quiz.spellingCards : study.cards}
          onClose={commands.close}
        />
      </Suspense>
    );
  }
  if (mode === 'story') {
    return (
      <Suspense fallback={<PracticeFallback label={<Trans {...msg({ context: 'practice.loading.story', message: 'Loading story' })} />} />}>
        <StoryView story={quiz.story} loading={quiz.isGeneratingStory} error={quiz.storyError} onGenerate={commands.generateStory} onClose={commands.close} />
      </Suspense>
    );
  }
  return null;
}

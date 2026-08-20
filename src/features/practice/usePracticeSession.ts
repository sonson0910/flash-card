import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LanguageProfile } from '../language/languageProfile';
import type { RecallMode } from '../../lib/recall';
import type { ReviewRating } from '../../lib/reviewScheduler';
import { OperationTimeoutError, withTimeout } from '../../lib/async';
import { playFlipSound, playRewardSound, playSuccessSound } from '../../lib/interactionSounds';
import type { CardData } from '../../types/card';
import { createPracticeSnapshot } from './practiceModel';
import { createPracticeSessionLifecycle } from './practiceSessionLifecycle';
import { usePracticeGames } from './usePracticeGames';

export type PracticeMode = 'study' | 'quiz' | 'spelling' | 'story' | 'match' | 'shadowing';
export type PracticeViewMode = 'library' | PracticeMode;

export interface PracticeLearningActions {
  reviewCard: (cardId: string, rating: ReviewRating) => Promise<void>;
  toggleBookmark: (cardId: string) => void | Promise<void>;
  assignDeck: (cardId: string, deckName: string | null) => void | Promise<void>;
  updateCard: (cardId: string, fields: Partial<CardData>) => void | Promise<void>;
}

export interface PracticeSnapshotPort {
  findCard: (cardId: string) => CardData | undefined;
  getCards: () => readonly CardData[];
  updateCard: (cardId: string, update: Partial<CardData> | ((card: CardData) => CardData)) => void;
  updateCards: (cardIds: ReadonlySet<string>, fields: Partial<CardData>) => void;
  removeCard: (cardId: string) => void;
  restoreCard: (card: CardData) => void;
  clear: () => void;
}

export interface PracticeSessionController {
  mode: PracticeViewMode;
  study: {
    cards: CardData[];
    index: number;
    recallMode: RecallMode;
    revealed: boolean;
    reviewedCardId: string | null;
    isStarting: boolean;
    reviewStatus: 'idle' | 'saving' | 'saved' | 'error';
    reviewError: string | null;
  };
  quiz: ReturnType<typeof usePracticeGames>;
  commands: {
    startStudy: () => Promise<void>;
    startQuiz: () => Promise<void>;
    startSpelling: () => Promise<void>;
    startMatch: () => Promise<void>;
    startShadowing: () => Promise<void>;
    generateStory: () => Promise<void>;
    close: () => void;
    reveal: () => void;
    setRecallMode: (mode: RecallMode) => void;
    setStudyIndex: (index: number) => void;
    submitStudyRating: (rating: ReviewRating) => Promise<void>;
  };
  learning: PracticeLearningActions;
  snapshot: PracticeSnapshotPort;
}

type PracticeGamesController = ReturnType<typeof usePracticeGames>;

const STUDY_PREPARATION_TIMEOUT_MS = 15_000;

const scopePracticeGames = (
  games: PracticeGamesController,
  isStateCurrent: boolean,
): PracticeGamesController => isStateCurrent ? games : {
  ...games,
  quizQuestions: [],
  currentQuizIndex: 0,
  selectedAnswer: null,
  answeredCorrectly: null,
  quizScore: 0,
  showQuizResults: false,
  spellingCards: [],
  currentSpellingIndex: 0,
  spellingInput: '',
  spellingChecked: false,
  spellingCorrect: false,
  spellingScore: 0,
  showSpellingResults: false,
  story: null,
  storyError: null,
  isGeneratingStory: false,
  isStartingQuiz: false,
  isStartingSpelling: false,
};

interface UsePracticeSessionOptions {
  ownerId: string | null;
  mode: PracticeViewMode;
  openView: (view: PracticeViewMode) => void;
  onSessionStarted?: () => void;
  loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  learning: PracticeLearningActions;
  languageProfile: LanguageProfile;
  addXp: (amount: number) => void;
  reportError: (message: string) => void;
}

export function usePracticeSession({
  ownerId,
  mode,
  openView,
  onSessionStarted,
  loadPracticePool,
  learning,
  languageProfile,
  addXp,
  reportError,
}: UsePracticeSessionOptions): PracticeSessionController {
  const lifecycleRef = useRef<ReturnType<typeof createPracticeSessionLifecycle> | null>(null);
  if (!lifecycleRef.current) lifecycleRef.current = createPracticeSessionLifecycle(ownerId);
  const lifecycle = lifecycleRef.current;
  lifecycle.replaceOwner(ownerId);
  const ownerSessionToken = lifecycle.currentToken();
  const practiceStateSessionRef = useRef(ownerSessionToken);
  const isPracticeStateCurrent = practiceStateSessionRef.current === ownerSessionToken;
  const [studyCards, setStudyCards] = useState<CardData[]>([]);
  const studyCardsRef = useRef(studyCards);
  const scopedStudyCards = isPracticeStateCurrent ? studyCards : [];
  studyCardsRef.current = scopedStudyCards;
  const [studyIndex, setStudyIndex] = useState(0);
  const [recallMode, setRecallMode] = useState<RecallMode>('adaptive');
  const [revealed, setRevealed] = useState(false);
  const [reviewedCardId, setReviewedCardId] = useState<string | null>(null);
  const [isStartingStudy, setIsStartingStudy] = useState(false);
  const [savingReviewCardId, setSavingReviewCardId] = useState<string | null>(null);
  const [reviewFailure, setReviewFailure] = useState<{ cardId: string; message: string } | null>(null);

  const openPracticeView = useCallback((view: Exclude<PracticeViewMode, 'library'>) => {
    onSessionStarted?.();
    openView(view);
  }, [onSessionStarted, openView]);

  const quiz = usePracticeGames({
    lifecycle,
    loadPracticePool,
    addXp,
    openView: openPracticeView,
    reportError,
    normalizeAnswer: languageProfile.normalize,
  });

  useEffect(() => {
    setStudyCards([]);
    setStudyIndex(0);
    setRecallMode('adaptive');
    setRevealed(false);
    setReviewedCardId(null);
    setIsStartingStudy(false);
    setSavingReviewCardId(null);
    setReviewFailure(null);
    quiz.reset();
    practiceStateSessionRef.current = ownerSessionToken;
  }, [ownerSessionToken]);

  const startStudy = useCallback(async () => {
    const result = await lifecycle.prepare(
      'study',
      async () => createPracticeSnapshot(await withTimeout(
        loadPracticePool(50, false),
        STUDY_PREPARATION_TIMEOUT_MS,
        'Preparing your review took too long. Check your connection and try again.',
      ), 50),
      () => setIsStartingStudy(true),
    );
    if (result.status === 'ready') {
      const cards = result.value;
      if (cards.length === 0) {
        reportError('There are no new or due cards to review right now.');
      } else if (lifecycle.activate('study', result.sessionToken)) {
        setStudyCards(cards);
        setRevealed(false);
        setReviewedCardId(null);
        setSavingReviewCardId(null);
        setReviewFailure(null);
        setStudyIndex(0);
        openPracticeView('study');
      }
      if (lifecycle.isCurrent(result.sessionToken)) setIsStartingStudy(false);
    } else if (result.status === 'failed') {
      console.warn('Could not prepare the study session.', result.error);
      reportError(result.error instanceof OperationTimeoutError
        ? result.error.message
        : 'Could not prepare your review. Check your connection and try again.');
      if (lifecycle.isCurrent(result.sessionToken)) setIsStartingStudy(false);
    }
  }, [lifecycle, loadPracticePool, openPracticeView, reportError]);

  const activeCardId = scopedStudyCards[studyIndex]?.id;
  useEffect(() => {
    setRevealed(false);
    setReviewedCardId(activeCardId && lifecycle.isReviewed(activeCardId) ? activeCardId : null);
  }, [activeCardId, lifecycle, recallMode, studyIndex]);

  const submitStudyRating = useCallback(async (rating: ReviewRating) => {
    const operationSession = ownerSessionToken;
    if (!lifecycle.isCurrent(operationSession) || !lifecycle.isActive('study')) return;
    const activeCard = studyCardsRef.current[studyIndex];
    if (!activeCard || !revealed) return;
    if (!lifecycle.claimReview(activeCard.id)) return;
    setSavingReviewCardId(activeCard.id);
    setReviewFailure(current => current?.cardId === activeCard.id ? null : current);
    try {
      if (rating === 'easy') playRewardSound();
      else if (rating === 'good') playSuccessSound();
      await learning.reviewCard(activeCard.id, rating);
      if (!lifecycle.isCurrent(operationSession)) return;
      if (lifecycle.settleReview(activeCard.id, 'saved')) setReviewedCardId(activeCard.id);
    } catch (error) {
      if (!lifecycle.isCurrent(operationSession)) return;
      if (!lifecycle.settleReview(activeCard.id, 'retry')) return;
      const message = 'Could not save this review. Choose a rating to try again.';
      setReviewFailure({ cardId: activeCard.id, message });
      reportError(message);
      console.warn('Could not save the review result.', error);
    } finally {
      if (lifecycle.isCurrent(operationSession)) {
        setSavingReviewCardId(current => current === activeCard.id ? null : current);
      }
    }
  }, [learning, lifecycle, ownerSessionToken, reportError, revealed, studyIndex]);

  useEffect(() => {
    if (mode !== 'study' || scopedStudyCards.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!lifecycle.isCurrent(ownerSessionToken) || !lifecycle.isActive('study')) return;
      if (event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const targetTag = target?.tagName?.toLowerCase();
      const isTyping = targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select' || Boolean(target?.isContentEditable);
      if (isTyping) return;
      const activeCard = studyCardsRef.current[studyIndex];
      if (!activeCard) return;

      if ((event.key === ' ' || event.key === 'Enter') && !event.altKey) {
        event.preventDefault();
        playFlipSound();
        if (!revealed) setRevealed(true);
        else (document.querySelector('[aria-hidden="false"] [data-flip-card]') as HTMLButtonElement | null)?.click();
      } else if (event.key === 'ArrowRight' && !event.altKey) {
        event.preventDefault();
        setStudyIndex(previous => Math.min(studyCardsRef.current.length - 1, previous + 1));
      } else if (event.key === 'ArrowLeft' && !event.altKey) {
        event.preventDefault();
        setStudyIndex(previous => Math.max(0, previous - 1));
      } else if (['1', '2', '3', '4'].includes(event.key) && (event.altKey || revealed)) {
        event.preventDefault();
        const ratings: Record<string, ReviewRating> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
        void submitStudyRating(ratings[event.key]);
      } else if (event.altKey && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault();
        if (!activeCard.bookmarked) playRewardSound();
        void learning.toggleBookmark(activeCard.id);
      } else if (event.altKey && event.key.toLocaleLowerCase() === 'p') {
        event.preventDefault();
        (document.querySelector('[aria-hidden="false"] [aria-label="Play pronunciation"]') as HTMLElement | null)?.click();
      } else if (event.altKey && event.key.toLocaleLowerCase() === 'r') {
        event.preventDefault();
        (document.querySelector('[aria-hidden="false"] [aria-label="Check pronunciation"]') as HTMLElement | null)?.click();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [learning, lifecycle, mode, ownerSessionToken, revealed, scopedStudyCards.length, studyIndex, submitStudyRating]);

  const close = useCallback(() => {
    if (mode === 'quiz') quiz.clearQuiz();
    if (mode === 'spelling') quiz.clearSpelling();
    if (mode === 'story') quiz.clearStory();
    if (mode === 'study') lifecycle.clear(mode);
    openView('library');
  }, [lifecycle, mode, openView, quiz]);

  const updateSnapshotCard = useCallback((
    cardId: string,
    update: Partial<CardData> | ((card: CardData) => CardData),
  ) => {
    setStudyCards(previous => previous.map(card => card.id === cardId
      ? typeof update === 'function' ? update(card) : { ...card, ...update }
      : card));
  }, []);
  const updateSnapshotCards = useCallback((cardIds: ReadonlySet<string>, fields: Partial<CardData>) => {
    setStudyCards(previous => previous.map(card => cardIds.has(card.id) ? { ...card, ...fields } : card));
  }, []);
  const removeSnapshotCard = useCallback((cardId: string) => {
    setStudyCards(previous => previous.filter(card => card.id !== cardId));
  }, []);
  const restoreSnapshotCard = useCallback((card: CardData) => {
    setStudyCards(previous => [card, ...previous.filter(candidate => candidate.id !== card.id)]);
  }, []);
  const clearSnapshot = useCallback(() => setStudyCards([]), []);
  const snapshot = useMemo<PracticeSnapshotPort>(() => ({
    findCard: cardId => studyCardsRef.current.find(card => card.id === cardId),
    getCards: () => studyCardsRef.current,
    updateCard: updateSnapshotCard,
    updateCards: updateSnapshotCards,
    removeCard: removeSnapshotCard,
    restoreCard: restoreSnapshotCard,
    clear: clearSnapshot,
  }), [clearSnapshot, removeSnapshotCard, restoreSnapshotCard, updateSnapshotCard, updateSnapshotCards]);

  const scopedQuiz = scopePracticeGames(quiz, isPracticeStateCurrent);
  const activeReviewStatus = !activeCardId
    ? 'idle' as const
    : savingReviewCardId === activeCardId
      ? 'saving' as const
      : lifecycle.isReviewed(activeCardId)
        ? 'saved' as const
        : reviewFailure?.cardId === activeCardId
          ? 'error' as const
          : 'idle' as const;
  const activeReviewError = reviewFailure && reviewFailure.cardId === activeCardId
    ? reviewFailure.message
    : null;

  return {
    mode,
    study: isPracticeStateCurrent
      ? {
          cards: scopedStudyCards,
          index: studyIndex,
          recallMode,
          revealed,
          reviewedCardId,
          isStarting: isStartingStudy,
          reviewStatus: activeReviewStatus,
          reviewError: activeReviewError,
        }
      : {
          cards: [],
          index: 0,
          recallMode: 'adaptive',
          revealed: false,
          reviewedCardId: null,
          isStarting: false,
          reviewStatus: 'idle',
          reviewError: null,
        },
    quiz: scopedQuiz,
    commands: {
      startStudy,
      startQuiz: quiz.startQuiz,
      startSpelling: quiz.startSpelling,
      startMatch: quiz.startMatch,
      startShadowing: quiz.startShadowing,
      generateStory: quiz.generateStory,
      close,
      reveal: () => setRevealed(true),
      setRecallMode,
      setStudyIndex,
      submitStudyRating,
    },
    learning,
    snapshot,
  };
}

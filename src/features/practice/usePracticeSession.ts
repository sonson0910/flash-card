import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LanguageProfile } from '../language/languageProfile';
import type { RecallMode } from '../../lib/recall';
import type { ReviewRating } from '../../lib/reviewScheduler';
import { OperationTimeoutError, withTimeout } from '../../lib/async';
import type { CardData } from '../../types/card';
import { claimPracticeReview, createPracticeSnapshot } from './practiceModel';
import { usePracticeGames } from './usePracticeGames';

export type PracticeMode = 'study' | 'quiz' | 'spelling' | 'story';
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
  const ownerSessionRef = useRef({ ownerId, generation: 0 });
  if (ownerSessionRef.current.ownerId !== ownerId) {
    ownerSessionRef.current = {
      ownerId,
      generation: ownerSessionRef.current.generation + 1,
    };
  }
  const ownerSessionToken = ownerSessionRef.current.generation;
  const isOwnerSessionCurrent = useCallback(
    (token: number) => ownerSessionRef.current.generation === token,
    [],
  );
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
  const pendingReviewIdsRef = useRef(new Set<string>());
  const reviewedCardIdsRef = useRef(new Set<string>());
  const studySessionRef = useRef<number | null>(null);
  const studyPreparationRef = useRef<{ id: symbol; sessionToken: number } | null>(null);

  const openPracticeView = useCallback((view: Exclude<PracticeViewMode, 'library'>) => {
    onSessionStarted?.();
    openView(view);
  }, [onSessionStarted, openView]);

  const quiz = usePracticeGames({
    sessionToken: ownerSessionToken,
    isSessionCurrent: isOwnerSessionCurrent,
    loadPracticePool,
    addXp,
    openView: openPracticeView,
    reportError,
    normalizeAnswer: languageProfile.normalize,
  });

  useEffect(() => {
    studySessionRef.current = null;
    pendingReviewIdsRef.current.clear();
    reviewedCardIdsRef.current.clear();
    setStudyCards([]);
    setStudyIndex(0);
    setRecallMode('adaptive');
    setRevealed(false);
    setReviewedCardId(null);
    setIsStartingStudy(false);
    setSavingReviewCardId(null);
    setReviewFailure(null);
    studyPreparationRef.current = null;
    quiz.reset();
    practiceStateSessionRef.current = ownerSessionToken;
  }, [ownerSessionToken]);

  const startStudy = useCallback(async () => {
    if (studyPreparationRef.current?.sessionToken === ownerSessionToken) return;
    const operation = { id: Symbol('study'), sessionToken: ownerSessionToken };
    studyPreparationRef.current = operation;
    setIsStartingStudy(true);
    try {
      const loadedCards = await withTimeout(
        loadPracticePool(50, false),
        STUDY_PREPARATION_TIMEOUT_MS,
        'Preparing your review took too long. Check your connection and try again.',
      );
      if (!isOwnerSessionCurrent(operation.sessionToken)) return;
      const cards = createPracticeSnapshot(loadedCards, 50);
      if (cards.length === 0) {
        reportError('There are no new or due cards to review right now.');
        return;
      }
      setStudyCards(cards);
      studySessionRef.current = operation.sessionToken;
      reviewedCardIdsRef.current.clear();
      pendingReviewIdsRef.current.clear();
      setRevealed(false);
      setReviewedCardId(null);
      setSavingReviewCardId(null);
      setReviewFailure(null);
      setStudyIndex(0);
      openPracticeView('study');
    } catch (error) {
      if (!isOwnerSessionCurrent(operation.sessionToken)) return;
      console.warn('Could not prepare the study session.', error);
      reportError(error instanceof OperationTimeoutError
        ? error.message
        : 'Could not prepare your review. Check your connection and try again.');
    } finally {
      if (studyPreparationRef.current?.id === operation.id) {
        studyPreparationRef.current = null;
        if (isOwnerSessionCurrent(operation.sessionToken)) setIsStartingStudy(false);
      }
    }
  }, [isOwnerSessionCurrent, loadPracticePool, openPracticeView, ownerSessionToken, reportError]);

  const activeCardId = scopedStudyCards[studyIndex]?.id;
  useEffect(() => {
    setRevealed(false);
    setReviewedCardId(activeCardId && reviewedCardIdsRef.current.has(activeCardId) ? activeCardId : null);
  }, [activeCardId, recallMode, studyIndex]);

  const submitStudyRating = useCallback(async (rating: ReviewRating) => {
    const operationSession = ownerSessionToken;
    if (studySessionRef.current !== operationSession || !isOwnerSessionCurrent(operationSession)) return;
    const activeCard = studyCardsRef.current[studyIndex];
    if (!activeCard || !revealed) return;
    if (!claimPracticeReview(activeCard.id, pendingReviewIdsRef.current, reviewedCardIdsRef.current)) return;
    setSavingReviewCardId(activeCard.id);
    setReviewFailure(current => current?.cardId === activeCard.id ? null : current);
    try {
      await learning.reviewCard(activeCard.id, rating);
      if (!isOwnerSessionCurrent(operationSession)) return;
      reviewedCardIdsRef.current.add(activeCard.id);
      setReviewedCardId(activeCard.id);
    } catch (error) {
      if (!isOwnerSessionCurrent(operationSession)) return;
      const message = 'Could not save this review. Choose a rating to try again.';
      setReviewFailure({ cardId: activeCard.id, message });
      reportError(message);
      console.warn('Could not save the review result.', error);
    } finally {
      if (isOwnerSessionCurrent(operationSession)) {
        pendingReviewIdsRef.current.delete(activeCard.id);
        setSavingReviewCardId(current => current === activeCard.id ? null : current);
      }
    }
  }, [isOwnerSessionCurrent, learning, ownerSessionToken, reportError, revealed, studyIndex]);

  useEffect(() => {
    if (mode !== 'study' || scopedStudyCards.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (studySessionRef.current !== ownerSessionToken || !isOwnerSessionCurrent(ownerSessionToken)) return;
      if (event.ctrlKey || event.metaKey) return;
      if ((event.target as HTMLElement | null)?.closest('button, a, input, textarea, select, summary, [contenteditable="true"]')) return;
      const activeCard = studyCardsRef.current[studyIndex];
      if (!activeCard) return;

      if ((event.key === ' ' || event.key === 'Enter') && !event.altKey) {
        event.preventDefault();
        if (!revealed) setRevealed(true);
        else (document.querySelector('[aria-hidden="false"] [data-flip-card]') as HTMLButtonElement | null)?.click();
      } else if (event.key === 'ArrowRight' && !event.altKey) {
        event.preventDefault();
        setStudyIndex(previous => Math.min(studyCardsRef.current.length - 1, previous + 1));
      } else if (event.key === 'ArrowLeft' && !event.altKey) {
        event.preventDefault();
        setStudyIndex(previous => Math.max(0, previous - 1));
      } else if (event.altKey && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        const ratings: Record<string, ReviewRating> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
        void submitStudyRating(ratings[event.key]);
      } else if (event.altKey && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault();
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
  }, [isOwnerSessionCurrent, learning, mode, ownerSessionToken, revealed, scopedStudyCards.length, studyIndex, submitStudyRating]);

  const close = useCallback(() => {
    if (mode === 'quiz') quiz.clearQuiz();
    if (mode === 'spelling') quiz.clearSpelling();
    openView('library');
  }, [mode, openView, quiz]);

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
      : reviewedCardIdsRef.current.has(activeCardId)
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

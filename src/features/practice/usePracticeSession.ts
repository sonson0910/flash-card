import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LanguageProfile } from '../language/languageProfile';
import type { RecallMode } from '../../lib/recall';
import type { ReviewRating } from '../../lib/reviewScheduler';
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

interface UsePracticeSessionOptions {
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
  mode,
  openView,
  onSessionStarted,
  loadPracticePool,
  learning,
  languageProfile,
  addXp,
  reportError,
}: UsePracticeSessionOptions): PracticeSessionController {
  const [studyCards, setStudyCards] = useState<CardData[]>([]);
  const studyCardsRef = useRef(studyCards);
  studyCardsRef.current = studyCards;
  const [studyIndex, setStudyIndex] = useState(0);
  const [recallMode, setRecallMode] = useState<RecallMode>('adaptive');
  const [revealed, setRevealed] = useState(false);
  const [reviewedCardId, setReviewedCardId] = useState<string | null>(null);
  const pendingReviewIdsRef = useRef(new Set<string>());
  const reviewedCardIdsRef = useRef(new Set<string>());

  const openPracticeView = useCallback((view: Exclude<PracticeViewMode, 'library'>) => {
    onSessionStarted?.();
    openView(view);
  }, [onSessionStarted, openView]);

  const quiz = usePracticeGames({
    loadPracticePool,
    addXp,
    openView: openPracticeView,
    reportError,
    normalizeAnswer: languageProfile.normalize,
  });

  const startStudy = useCallback(async () => {
    const cards = createPracticeSnapshot(await loadPracticePool(50, false), 50);
    if (cards.length === 0) {
      reportError('There are no new or due cards to review right now.');
      return;
    }
    setStudyCards(cards);
    reviewedCardIdsRef.current.clear();
    pendingReviewIdsRef.current.clear();
    setRevealed(false);
    setReviewedCardId(null);
    setStudyIndex(0);
    openPracticeView('study');
  }, [loadPracticePool, openPracticeView, reportError]);

  const activeCardId = studyCards[studyIndex]?.id;
  useEffect(() => {
    setRevealed(false);
    setReviewedCardId(activeCardId && reviewedCardIdsRef.current.has(activeCardId) ? activeCardId : null);
  }, [activeCardId, recallMode, studyIndex]);

  const submitStudyRating = useCallback(async (rating: ReviewRating) => {
    const activeCard = studyCardsRef.current[studyIndex];
    if (!activeCard || !revealed) return;
    if (!claimPracticeReview(activeCard.id, pendingReviewIdsRef.current, reviewedCardIdsRef.current)) return;
    setReviewedCardId(activeCard.id);
    try {
      await learning.reviewCard(activeCard.id, rating);
    } catch (error) {
      reviewedCardIdsRef.current.delete(activeCard.id);
      setReviewedCardId(current => current === activeCard.id ? null : current);
      reportError(error instanceof Error ? error.message : 'Could not save the review result.');
    } finally {
      pendingReviewIdsRef.current.delete(activeCard.id);
    }
  }, [learning, reportError, revealed, studyIndex]);

  useEffect(() => {
    if (mode !== 'study' || studyCards.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
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
  }, [learning, mode, revealed, studyCards.length, studyIndex, submitStudyRating]);

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

  return {
    mode,
    study: { cards: studyCards, index: studyIndex, recallMode, revealed, reviewedCardId },
    quiz,
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

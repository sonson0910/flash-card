import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LanguageProfile } from '../language/languageProfile';
import type { RecallMode } from '../../lib/recall';
import type { ReviewRating } from '../../lib/reviewScheduler';
import { OperationTimeoutError, withTimeout } from '../../lib/async';
import { cardLogicalKey, effectiveCardTargetLanguage, normalizeCardLanguage } from '../../lib/cardIdentity';
import { playRewardSound, playSuccessSound } from '../../lib/interactionSounds';
import type { CardData } from '../../types/card';
import { createPracticeSnapshot } from './practiceModel';
import { createPracticeSessionLifecycle } from './practiceSessionLifecycle';
import { usePracticeGames } from './usePracticeGames';
import type { LearningStateOutcome } from '../learning/learningStateController';

export type PracticeMode = 'study' | 'quiz' | 'spelling' | 'language-drill' | 'story' | 'match' | 'shadowing';
export type PracticeViewMode = 'library' | PracticeMode;
export type StudyRatingSettlement = 'committed' | 'retryable-error' | 'ignored';

export interface PracticeLearningActions {
  reviewCard: (cardId: string, rating: ReviewRating) => Promise<LearningStateOutcome>;
  toggleBookmark: (cardId: string) => void | Promise<void>;
  assignDeck: (cardId: string, deckName: string | null) => void | Promise<void>;
  updateCard: (cardId: string, fields: Partial<CardData>) => void | Promise<LearningStateOutcome>;
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
    isPaused?: boolean;
  };
  quiz: ReturnType<typeof usePracticeGames>;
  commands: {
    startStudy: () => Promise<void>;
    startStudyWithCards: (cards: readonly CardData[], isSourceCurrent?: () => boolean) => Promise<boolean>;
    startQuiz: () => Promise<void>;
    startSpelling: () => Promise<void>;
    startLanguageDrill: () => Promise<void>;
    completeLanguageDrill: (correct: boolean) => void;
    startMatch: () => Promise<void>;
    startShadowing: () => Promise<void>;
    generateStory: () => Promise<void>;
    close: () => void;
    reveal: () => void;
    setRecallMode: (mode: RecallMode) => void;
    setStudyIndex: (index: number) => void;
    setStudyEditorOpen: (cardId: string, open: boolean) => void;
    submitStudyRating: (rating: ReviewRating) => Promise<StudyRatingSettlement>;
  };
  learning: PracticeLearningActions;
  snapshot: PracticeSnapshotPort;
}

type PracticeGamesController = ReturnType<typeof usePracticeGames>;

const STUDY_PREPARATION_TIMEOUT_MS = 15_000;
export const MAXIMUM_UNIT_STUDY_LEXEMES = 20;

const unitStudyCardsAreValid = (cards: readonly CardData[], targetLanguage: string): boolean => {
  if (cards.length === 0 || cards.length > MAXIMUM_UNIT_STUDY_LEXEMES) return false;
  const lexemes = new Set<string>();
  return cards.every(card => {
    const lexeme = cardLogicalKey(card);
    if (!lexeme.startsWith('lexeme:') || lexemes.has(lexeme)) return false;
    lexemes.add(lexeme);
    return effectiveCardTargetLanguage(card) === targetLanguage;
  });
};

const scopePracticeGames = (
  games: PracticeGamesController,
  isStateCurrent: boolean,
  isLanguageDrillCurrent: boolean,
): PracticeGamesController => {
  if (isStateCurrent && isLanguageDrillCurrent) return games;
  if (isStateCurrent) return {
    ...games,
    languageDrillCards: [],
    currentLanguageDrillIndex: 0,
    languageDrillCorrect: 0,
    showLanguageDrillResults: false,
  };
  return {
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
  languageDrillCards: [],
  currentLanguageDrillIndex: 0,
  languageDrillCorrect: 0,
  showLanguageDrillResults: false,
  story: null,
  storyError: null,
  isGeneratingStory: false,
  isStartingQuiz: false,
  isStartingSpelling: false,
  };
};

interface UsePracticeSessionOptions {
  ownerId: string | null;
  mode: PracticeViewMode;
  openView: (view: PracticeViewMode) => void;
  onSessionStarted?: () => void;
  loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  languageDrillCards: readonly CardData[];
  languageDrillScopeKey: string;
  learning: PracticeLearningActions;
  languageProfile: LanguageProfile;
  onAuthoritativeOutcome?: Parameters<typeof usePracticeGames>[0]['onAuthoritativeOutcome'];
  reportError: (message: string) => void;
}

export function usePracticeSession({
  ownerId,
  mode,
  openView,
  onSessionStarted,
  loadPracticePool,
  languageDrillCards,
  languageDrillScopeKey,
  learning,
  languageProfile,
  onAuthoritativeOutcome,
  reportError,
}: UsePracticeSessionOptions): PracticeSessionController {
  const lifecycleRef = useRef<ReturnType<typeof createPracticeSessionLifecycle> | null>(null);
  if (!lifecycleRef.current) lifecycleRef.current = createPracticeSessionLifecycle(ownerId);
  const lifecycle = lifecycleRef.current;
  lifecycle.replaceOwner(ownerId);
  const ownerSessionToken = lifecycle.currentToken();
  const practiceStateSessionRef = useRef(ownerSessionToken);
  const isPracticeStateCurrent = practiceStateSessionRef.current === ownerSessionToken;
  const languageDrillScopeRef = useRef(languageDrillScopeKey);
  const isLanguageDrillCurrent = languageDrillScopeRef.current === languageDrillScopeKey;
  const studyScopeKey = `${ownerId ?? ''}:${normalizeCardLanguage(languageProfile.source.code)}`;
  const studyScopeRef = useRef(studyScopeKey);
  if (studyScopeRef.current !== studyScopeKey) {
    lifecycle.clear('study');
    studyScopeRef.current = studyScopeKey;
  }
  const studyCardsScopeRef = useRef(studyScopeKey);
  const isStudyScopeCurrent = studyCardsScopeRef.current === studyScopeKey;
  const [studyCards, setStudyCards] = useState<CardData[]>([]);
  const studyCardsRef = useRef(studyCards);
  const scopedStudyCards = isPracticeStateCurrent && isStudyScopeCurrent ? studyCards : [];
  studyCardsRef.current = scopedStudyCards;
  const [studyIndex, setStudyIndex] = useState(0);
  const [recallMode, setRecallMode] = useState<RecallMode>('adaptive');
  const [revealed, setRevealed] = useState(false);
  const [reviewedCardId, setReviewedCardId] = useState<string | null>(null);
  const [isStartingStudy, setIsStartingStudy] = useState(false);
  const [savingReviewCardId, setSavingReviewCardId] = useState<string | null>(null);
  const [reviewFailure, setReviewFailure] = useState<{ cardId: string; message: string } | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const editorRef = useRef<{ ownerToken: number; cardId: string } | null>(null);
  if (editorRef.current?.ownerToken !== ownerSessionToken) editorRef.current = null;
  const isEditorOpen = () => editorRef.current?.ownerToken === ownerSessionToken;

  const openPracticeView = useCallback((view: Exclude<PracticeViewMode, 'library'>) => {
    onSessionStarted?.();
    openView(view);
  }, [onSessionStarted, openView]);

  const quiz = usePracticeGames({
    lifecycle,
    loadPracticePool,
    languageDrillCards,
    languageDrillScopeKey,
    onAuthoritativeOutcome,
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
    setEditingCardId(null);
    quiz.reset();
    practiceStateSessionRef.current = ownerSessionToken;
  }, [ownerSessionToken]);
  useEffect(() => {
    if (studyCardsScopeRef.current === studyScopeKey) return;
    setStudyCards([]);
    setStudyIndex(0);
    setRecallMode('adaptive');
    setRevealed(false);
    setReviewedCardId(null);
    setIsStartingStudy(false);
    setSavingReviewCardId(null);
    setReviewFailure(null);
    setEditingCardId(null);
    studyCardsScopeRef.current = studyScopeKey;
  }, [studyScopeKey]);
  useEffect(() => {
    if (languageDrillScopeRef.current === languageDrillScopeKey) return;
    quiz.clearLanguageDrill();
    languageDrillScopeRef.current = languageDrillScopeKey;
  }, [languageDrillScopeKey, quiz]);

  const startStudy = useCallback(async () => {
    if (editorRef.current || studyScopeRef.current !== studyScopeKey) return;
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
      } else if (studyScopeRef.current === studyScopeKey && lifecycle.activate('study', result.sessionToken)) {
        studyCardsScopeRef.current = studyScopeKey;
        setStudyCards(cards);
        setRevealed(false);
        setReviewedCardId(null);
        setSavingReviewCardId(null);
        setReviewFailure(null);
        setStudyIndex(0);
        openPracticeView('study');
      }
      if (lifecycle.isCurrent(result.sessionToken) && studyScopeRef.current === studyScopeKey) setIsStartingStudy(false);
    } else if (result.status === 'failed') {
      console.warn('Could not prepare the study session.', result.error);
      reportError(result.error instanceof OperationTimeoutError
        ? result.error.message
        : 'Could not prepare your review. Check your connection and try again.');
      if (lifecycle.isCurrent(result.sessionToken) && studyScopeRef.current === studyScopeKey) setIsStartingStudy(false);
    }
  }, [lifecycle, loadPracticePool, openPracticeView, reportError, studyScopeKey]);

  const startStudyWithCards = useCallback(async (cards: readonly CardData[], isSourceCurrent: () => boolean = () => true) => {
    if (editorRef.current || studyScopeRef.current !== studyScopeKey || !isSourceCurrent()) return false;
    const targetLanguage = normalizeCardLanguage(languageProfile.source.code);
    if (!unitStudyCardsAreValid(cards, targetLanguage)) {
      reportError('This unit cannot start because its cards are invalid.');
      return false;
    }
    const result = await lifecycle.prepare('study', async () => [...cards], () => setIsStartingStudy(true));
    let started = false;
    if (result.status === 'ready') {
      if (studyScopeRef.current === studyScopeKey && isSourceCurrent() && lifecycle.activate('study', result.sessionToken)) {
        studyCardsScopeRef.current = studyScopeKey;
        setStudyCards(result.value);
        setRevealed(false);
        setReviewedCardId(null);
        setSavingReviewCardId(null);
        setReviewFailure(null);
        setStudyIndex(0);
        openPracticeView('study');
        started = true;
      }
      if (lifecycle.isCurrent(result.sessionToken) && studyScopeRef.current === studyScopeKey) {
        setIsStartingStudy(false);
      }
    }
    return started;
  }, [languageProfile.source.code, lifecycle, openPracticeView, reportError, studyScopeKey]);

  const activeCardId = scopedStudyCards[studyIndex]?.id;
  useEffect(() => {
    if (editorRef.current && editorRef.current.cardId !== activeCardId) {
      editorRef.current = null;
      setEditingCardId(null);
    }
  }, [activeCardId]);
  useEffect(() => {
    setRevealed(false);
    setReviewedCardId(activeCardId && lifecycle.isReviewed(activeCardId) ? activeCardId : null);
  }, [activeCardId, lifecycle, recallMode, studyIndex]);

  const submitStudyRating = useCallback(async (rating: ReviewRating) => {
    const operationSession = ownerSessionToken;
    if (!lifecycle.isCurrent(operationSession) || !lifecycle.isActive('study') || isEditorOpen()) return 'ignored' as const;
    const activeCard = studyCardsRef.current[studyIndex];
    if (!activeCard || !revealed) return 'ignored' as const;
    if (!lifecycle.claimReview(activeCard.id)) return 'ignored' as const;
    setSavingReviewCardId(activeCard.id);
    setReviewFailure(current => current?.cardId === activeCard.id ? null : current);
    try {
      if (rating === 'easy') playRewardSound();
      else if (rating === 'good') playSuccessSound();
      const outcome = await learning.reviewCard(activeCard.id, rating);
      if (outcome?.status === 'review-conflict') throw new Error('This card was reviewed on another device.');
      if (!lifecycle.isCurrent(operationSession)) return 'ignored' as const;
      if (outcome?.status !== 'published') throw new Error('Review persistence did not confirm this review.');
      if (lifecycle.settleReview(activeCard.id, 'saved')) {
        setReviewedCardId(activeCard.id);
        return 'committed' as const;
      }
      return 'ignored' as const;
    } catch (error) {
      if (!lifecycle.isCurrent(operationSession)) return 'ignored' as const;
      if (!lifecycle.settleReview(activeCard.id, 'retry')) return 'ignored' as const;
      const message = 'Could not save this review. Choose a rating to try again.';
      setReviewFailure({ cardId: activeCard.id, message });
      reportError(message);
      console.warn('Could not save the review result.', error);
      return 'retryable-error' as const;
    } finally {
      if (lifecycle.isCurrent(operationSession)) {
        setSavingReviewCardId(current => current === activeCard.id ? null : current);
      }
    }
  }, [learning, lifecycle, ownerSessionToken, reportError, revealed, studyIndex]);

  const close = useCallback(() => {
    if (editorRef.current) return;
    if (mode === 'quiz') quiz.clearQuiz();
    if (mode === 'spelling') quiz.clearSpelling();
    if (mode === 'language-drill') quiz.clearLanguageDrill();
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

  const scopedQuiz = scopePracticeGames(quiz, isPracticeStateCurrent, isLanguageDrillCurrent);
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
    study: isPracticeStateCurrent && isStudyScopeCurrent
      ? {
          cards: scopedStudyCards,
          index: studyIndex,
          recallMode,
          revealed,
          reviewedCardId,
          isStarting: isStartingStudy,
          reviewStatus: activeReviewStatus,
          reviewError: activeReviewError,
          isPaused: Boolean(editingCardId && editorRef.current?.cardId === editingCardId),
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
          isPaused: false,
        },
    quiz: scopedQuiz,
    commands: {
      startStudy,
      startStudyWithCards,
      startQuiz: quiz.startQuiz,
      startSpelling: quiz.startSpelling,
      startLanguageDrill: quiz.startLanguageDrill,
      completeLanguageDrill: quiz.completeLanguageDrill,
      startMatch: quiz.startMatch,
      startShadowing: quiz.startShadowing,
      generateStory: quiz.generateStory,
      close,
      reveal: () => { if (!isEditorOpen()) setRevealed(true); },
      setRecallMode: value => { if (!isEditorOpen()) setRecallMode(value); },
      setStudyIndex: value => { if (!isEditorOpen()) setStudyIndex(value); },
      setStudyEditorOpen: (cardId, open) => {
        if (!lifecycle.isCurrent(ownerSessionToken)) return;
        if (open) {
          if (!lifecycle.isActive('study') || cardId !== activeCardId) return;
          editorRef.current = { ownerToken: ownerSessionToken, cardId };
          setEditingCardId(cardId);
        } else if (editorRef.current?.cardId === cardId) {
          editorRef.current = null;
          setEditingCardId(null);
        }
      },
      submitStudyRating,
    },
    learning,
    snapshot,
  };
}

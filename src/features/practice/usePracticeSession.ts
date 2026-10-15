import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LanguageProfile } from '../language/languageProfile';
import type { RecallMode } from '../../lib/recall';
import type { ReviewRating } from '../../lib/reviewScheduler';
import { OperationTimeoutError, withTimeout } from '../../lib/async';
import { cardLogicalKey, effectiveCardTargetLanguage, normalizeCardLanguage } from '../../lib/cardIdentity';
import { triggerConfetti } from '../../lib/confetti';
import { playRewardSound, playSuccessSound } from '../../lib/interactionSounds';
import { hasReviewEvidence } from '../../lib/cardLearningStatus';
import type { PracticeDeckScope } from '../../lib/practiceScope';
import type { CardData } from '../../types/card';
import { createPracticeSnapshot } from './practiceModel';
import { createPracticeSessionLifecycle, type StudyReviewSummary } from './practiceSessionLifecycle';
import { usePracticeGames } from './usePracticeGames';
import type { LearningStateOutcome } from '../learning/learningStateController';

export type PracticeMode = 'study' | 'quiz' | 'spelling' | 'language-drill' | 'story' | 'match' | 'shadowing';
export type PracticeViewMode = 'library' | PracticeMode;
export type StudyRatingSettlement =
  | { readonly status: 'committed'; readonly xpAwarded: 0 | 2; readonly rating?: ReviewRating }
  | 'retryable-error'
  | 'ignored';

export interface PracticeLearningActions {
  reviewCard: (cardId: string, rating: ReviewRating, operationId?: string) => Promise<LearningStateOutcome>;
  toggleBookmark: (cardId: string) => void | Promise<void>;
  assignDeck: (cardId: string, deckName: string | null) => void | Promise<void>;
  updateCard: (cardId: string, fields: Partial<CardData>) => void | Promise<LearningStateOutcome>;
}

export interface PracticeStudyStartOptions {
  cards?: readonly CardData[];
  introduce?: boolean;
  customDeck?: PracticeDeckScope;
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
  sessionKey: number;
  study: {
    sessionKey: number;
    cards: CardData[];
    index: number;
    recallMode: RecallMode;
    revealed: boolean;
    needsIntroduction: boolean;
    reviewedCardId: string | null;
    isStarting: boolean;
    reviewStatus: 'idle' | 'saving' | 'sync-pending' | 'saved' | 'error';
    reviewError: string | null;
    isPaused?: boolean;
    goodCount: number;
    againCount: number;
    weakCards: CardData[];
    showRecap: boolean;
    summary: StudyReviewSummary;
    xpEarned: number;
  };
  quiz: ReturnType<typeof usePracticeGames>;
  commands: {
    startStudy: (request?: PracticeStudyStartOptions) => Promise<void>;
    startStudyWithCards: (cards: readonly CardData[], isSourceCurrent?: () => boolean) => Promise<boolean>;
    startQuiz: () => Promise<void>;
    startSpelling: () => Promise<void>;
    startLanguageDrill: () => Promise<void>;
    completeLanguageDrill: (correct: boolean) => void;
    startMatch: () => Promise<void>;
    startShadowing: () => Promise<void>;
    generateStory: () => Promise<void>;
    close: () => void;
    dismissStudyRecap: () => void;
    beginStudyRecall: () => void;
    requestStudyIntroduction: () => void;
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
const MAX_RETAINED_STUDY_REVIEW_RECORDS = 100;
const STUDY_REVIEW_RECEIPT_MAX_AGE_MS = 10 * 60 * 1000;
let fallbackStudyReviewOperationSequence = 0;

type StudyReviewIntent = {
  operationId: string;
  rating: ReviewRating;
  libraryEpoch?: number;
  preReviewCount: number;
  preReviewAt?: string;
  adoptedActivationId?: number;
};

type StudyReviewReceipt = StudyReviewIntent & {
  xpAwarded: 0 | 2;
  confirmedAt: number;
};

type StudyReviewRecord = StudyReviewIntent | StudyReviewReceipt;

const createStudyReviewOperationId = (): string => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackStudyReviewOperationSequence += 1;
  return `study-review-${Date.now()}-${fallbackStudyReviewOperationSequence}`;
};

const cardReviewCount = (card: CardData): number => Math.max(
  card.reviews ?? 0,
  card.reviewHistory?.length ?? 0,
);

const cardLastReviewAt = (card: CardData): string | undefined => {
  const historyReview = card.reviewHistory?.at(-1)?.reviewedAt;
  const fsrsReview = card.fsrs?.lastReview;
  if (!historyReview) return fsrsReview;
  if (!fsrsReview) return historyReview;
  return Date.parse(fsrsReview) > Date.parse(historyReview) ? fsrsReview : historyReview;
};

const cardMatchesReviewSnapshot = (
  card: CardData,
  reviewCount: number,
  lastReviewAt?: string,
): boolean => {
  if (cardReviewCount(card) !== reviewCount) return false;
  const currentLastReviewAt = cardLastReviewAt(card);
  if (currentLastReviewAt === lastReviewAt) return true;
  if (!currentLastReviewAt || !lastReviewAt) return false;
  const currentTime = Date.parse(currentLastReviewAt);
  const expectedTime = Date.parse(lastReviewAt);
  return Number.isFinite(currentTime) && Number.isFinite(expectedTime) && currentTime === expectedTime;
};

const cardHasReviewOperation = (card: CardData, operationId: string): boolean =>
  card.appliedReviewOperationIds?.includes(operationId) ?? false;

const isTerminalReviewError = (error: unknown): boolean => Boolean(
  error && typeof error === 'object'
    && (error as { reviewConflictTerminal?: unknown }).reviewConflictTerminal === true,
);

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
  isPracticePairCurrent: boolean,
): PracticeGamesController => {
  if (isStateCurrent && isLanguageDrillCurrent && isPracticePairCurrent) return games;
  if (isStateCurrent && !isPracticePairCurrent) return {
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
    quizCompletionSaving: false,
    spellingCompletionSaving: false,
  };
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
  quizCompletionSaving: false,
  spellingCompletionSaving: false,
  };
};

interface UsePracticeSessionOptions {
  ownerId: string | null;
  mode: PracticeViewMode;
  openView: (view: PracticeViewMode) => void;
  onSessionStarted?: () => void;
  loadPracticePool: (
    maximum?: number,
    includeFuture?: boolean,
    customDeck?: PracticeDeckScope,
  ) => Promise<CardData[]>;
  languageDrillCards: readonly CardData[];
  languageDrillScopeKey: string;
  learning: PracticeLearningActions;
  languageProfile: LanguageProfile;
  onAuthoritativeOutcome?: Parameters<typeof usePracticeGames>[0]['onAuthoritativeOutcome'];
  onEmptyStudy?: () => void;
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
  onEmptyStudy,
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
  const practicePairScopeKey = `${normalizeCardLanguage(languageProfile.source.code)}:${normalizeCardLanguage(languageProfile.target.code)}`;
  const practicePairScopeRef = useRef(practicePairScopeKey);
  const isPracticePairCurrent = practicePairScopeRef.current === practicePairScopeKey;
  const studyScopeKey = `${ownerId ?? ''}:${normalizeCardLanguage(languageProfile.source.code)}`;
  const studyScopeRef = useRef(studyScopeKey);
  if (studyScopeRef.current !== studyScopeKey) {
    lifecycle.clear('study');
    studyScopeRef.current = studyScopeKey;
  }
  const studyCardsScopeRef = useRef(studyScopeKey);
  const isStudyScopeCurrent = studyCardsScopeRef.current === studyScopeKey;
  const [studyCards, setStudyCards] = useState<CardData[]>([]);
  const [studySessionKey, setStudySessionKey] = useState(0);
  const studyCardsRef = useRef(studyCards);
  const scopedStudyCards = isPracticeStateCurrent && isStudyScopeCurrent ? studyCards : [];
  studyCardsRef.current = scopedStudyCards;
  const [studyIndex, setStudyIndex] = useState(0);
  const [recallMode, setRecallMode] = useState<RecallMode>('adaptive');
  const [revealed, setRevealed] = useState(false);
  const [introducedStudyCardIds, setIntroducedStudyCardIds] = useState<ReadonlySet<string>>(() => new Set());
  const [reviewedCardId, setReviewedCardId] = useState<string | null>(null);
  const [isStartingStudy, setIsStartingStudy] = useState(false);
  const [savingReviewCardId, setSavingReviewCardId] = useState<string | null>(null);
  const [syncPendingReviewCardId, setSyncPendingReviewCardId] = useState<string | null>(null);
  const [reviewFailure, setReviewFailure] = useState<{ cardId: string; message: string } | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const studyReviewRecordsRef = useRef(new Map<string, StudyReviewRecord>());
  const studyReviewIntentOwnerRef = useRef(ownerId);
  if (studyReviewIntentOwnerRef.current !== ownerId) {
    studyReviewRecordsRef.current.clear();
    studyReviewIntentOwnerRef.current = ownerId;
  }
  const studyReviewKey = (cardId: string) => `${ownerId ?? ''}\u0000${cardId}`;
  const studyReviewRecordCount = (confirmed: boolean) => {
    let count = 0;
    for (const record of studyReviewRecordsRef.current.values()) {
      if (('confirmedAt' in record) === confirmed) count += 1;
    }
    return count;
  };
  const pruneStudyReviewRecords = (cards: readonly CardData[]) => {
    const availableCards = new Map(cards.map(card => [card.id, card]));
    const ownerPrefix = `${ownerId ?? ''}\u0000`;
    const now = Date.now();
    for (const [key, receipt] of studyReviewRecordsRef.current) {
      if (!key.startsWith(ownerPrefix)) continue;
      if (!('confirmedAt' in receipt)) continue;
      const card = availableCards.get(key.slice(ownerPrefix.length));
      if (now - receipt.confirmedAt > STUDY_REVIEW_RECEIPT_MAX_AGE_MS
        || (card && receipt.libraryEpoch !== undefined && card.libraryEpoch !== undefined
          && receipt.libraryEpoch !== card.libraryEpoch)
        || (card && !cardMatchesReviewSnapshot(card, receipt.preReviewCount, receipt.preReviewAt))) {
        studyReviewRecordsRef.current.delete(key);
      }
    }
  };
  const adoptStudyReviewIntents = (cards: readonly CardData[], activationId: number) => {
    const availableCards = new Map(cards.map(card => [card.id, card]));
    const ownerPrefix = `${ownerId ?? ''}\u0000`;
    for (const [key, intent] of studyReviewRecordsRef.current) {
      if (!key.startsWith(ownerPrefix)) continue;
      if ('confirmedAt' in intent) continue;
      const card = availableCards.get(key.slice(ownerPrefix.length));
      if (!card) continue;
      intent.adoptedActivationId = activationId;
    }
  };
  const rememberConfirmedStudyReview = (key: string, receipt: StudyReviewReceipt) => {
    const currentActivationId = lifecycle.studyActivationId();
    const currentCardId = studyCardsRef.current[studyIndex]?.id;
    const protectedKey = receipt.adoptedActivationId !== undefined
      && receipt.adoptedActivationId === currentActivationId
      ? key
      : currentActivationId !== null && currentCardId
        && lifecycle.isReviewClaimCurrent(currentCardId, currentActivationId)
        ? studyReviewKey(currentCardId)
        : null;
    const existingRecord = studyReviewRecordsRef.current.get(key);
    if ((!existingRecord || !('confirmedAt' in existingRecord))
      && studyReviewRecordCount(true) >= MAX_RETAINED_STUDY_REVIEW_RECORDS) {
      let evicted = false;
      for (const [candidate, record] of studyReviewRecordsRef.current) {
        if (candidate !== protectedKey && 'confirmedAt' in record) {
          studyReviewRecordsRef.current.delete(candidate);
          evicted = true;
          break;
        }
      }
      if (!evicted) return;
    }
    studyReviewRecordsRef.current.set(key, receipt);
  };
  const editorRef = useRef<{ ownerToken: number; cardId: string } | null>(null);
  if (editorRef.current?.ownerToken !== ownerSessionToken) editorRef.current = null;
  const isEditorOpen = () => editorRef.current?.ownerToken === ownerSessionToken;
  const [goodCount, setGoodCount] = useState(0);
  const [againCount, setAgainCount] = useState(0);
  const [weakCards, setWeakCards] = useState<CardData[]>([]);
  const [showRecap, setShowRecap] = useState(false);
  const [xpEarned, setXpEarned] = useState(0);

  const openPracticeView = useCallback((view: Exclude<PracticeViewMode, 'library'>) => {
    onSessionStarted?.();
    openView(view);
  }, [onSessionStarted, openView]);

  const quiz = usePracticeGames({
    lifecycle,
    ownerId,
    activeMode: mode,
    loadPracticePool,
    languageDrillCards,
    languageDrillScopeKey,
    storyLanguagePair: {
      targetLanguage: languageProfile.source.code,
      translationLanguage: languageProfile.target.code,
    },
    practicePairScopeKey,
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
    setIntroducedStudyCardIds(new Set());
    setReviewedCardId(null);
    setIsStartingStudy(false);
    setSavingReviewCardId(null);
    setSyncPendingReviewCardId(null);
    setReviewFailure(null);
    setEditingCardId(null);
    studyReviewRecordsRef.current.clear();
    setGoodCount(0);
    setXpEarned(0);
    setAgainCount(0);
    setWeakCards([]);
    setShowRecap(false);
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
    if (mode === 'language-drill') openView('library');
  }, [languageDrillScopeKey, mode, openView, quiz]);
  useEffect(() => {
    if (practicePairScopeRef.current === practicePairScopeKey) return;
    quiz.clearPairGames();
    quiz.clearStory();
    practicePairScopeRef.current = practicePairScopeKey;
    if (mode === 'quiz' || mode === 'spelling' || mode === 'story' || mode === 'match') openView('library');
  }, [mode, openView, practicePairScopeKey, quiz]);

  const startStudy = useCallback(async (request: PracticeStudyStartOptions = {}) => {
    const { cards: requestedCards, customDeck } = request;
    if (editorRef.current || studyScopeRef.current !== studyScopeKey) return;
    const result = await lifecycle.prepare(
      'study',
      async () => createPracticeSnapshot(requestedCards ?? await withTimeout(
        loadPracticePool(50, false, customDeck),
        STUDY_PREPARATION_TIMEOUT_MS,
        'Preparing your review took too long. Check your connection and try again.',
      ), 50),
      () => setIsStartingStudy(true),
    );
    if (result.status === 'ready') {
      const cards = result.value;
      pruneStudyReviewRecords(cards);
      if (cards.length === 0) {
        reportError('There are no new or due cards to review right now.');
      } else if (studyScopeRef.current === studyScopeKey && lifecycle.activate('study', result.sessionToken)) {
        const activationId = lifecycle.studyActivationId();
        if (activationId !== null) adoptStudyReviewIntents(cards, activationId);
        studyCardsScopeRef.current = studyScopeKey;
        setStudySessionKey(previous => previous + 1);
        setStudyCards(cards);
        setIntroducedStudyCardIds(new Set(request.introduce ? [] : cards.filter(hasReviewEvidence).map(card => card.id)));
        setRevealed(false);
        setReviewedCardId(null);
        setSavingReviewCardId(null);
        setSyncPendingReviewCardId(null);
        setReviewFailure(null);
        setGoodCount(0);
        setXpEarned(0);
        setAgainCount(0);
        setWeakCards([]);
        setShowRecap(false);
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
      pruneStudyReviewRecords(result.value);
      if (studyScopeRef.current === studyScopeKey && isSourceCurrent() && lifecycle.activate('study', result.sessionToken)) {
        const activationId = lifecycle.studyActivationId();
        if (activationId !== null) adoptStudyReviewIntents(result.value, activationId);
        studyCardsScopeRef.current = studyScopeKey;
        setStudySessionKey(previous => previous + 1);
        setStudyCards(result.value);
        setIntroducedStudyCardIds(new Set(result.value.filter(hasReviewEvidence).map(card => card.id)));
        setGoodCount(0); setAgainCount(0); setWeakCards([]); setShowRecap(false); setXpEarned(0);
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

  const activeCard = scopedStudyCards[studyIndex];
  const activeCardId = scopedStudyCards[studyIndex]?.id;
  const navigateStudyIndex = useCallback((index: number) => {
    if (!lifecycle.isCurrent(ownerSessionToken) || !lifecycle.isActive('study')) return;
    const nextIndex = Math.max(0, Math.min(studyCardsRef.current.length - 1, index));
    if (nextIndex !== studyIndex && activeCardId) lifecycle.skipReview(activeCardId);
    setStudyIndex(nextIndex);
  }, [activeCardId, lifecycle, ownerSessionToken, studyIndex]);
  const needsIntroduction = Boolean(
    activeCard
    && !introducedStudyCardIds.has(activeCard.id),
  );

  const beginStudyRecall = useCallback(() => {
    if (!lifecycle.isCurrent(ownerSessionToken) || !lifecycle.isActive('study')) return;
    const card = studyCardsRef.current[studyIndex];
    if (!card) return;
    setIntroducedStudyCardIds(previous => new Set(previous).add(card.id));
    setRevealed(false);
  }, [lifecycle, ownerSessionToken, studyIndex]);

  const requestStudyIntroduction = useCallback(() => {
    if (!lifecycle.isCurrent(ownerSessionToken) || !lifecycle.isActive('study')) return;
    const card = studyCardsRef.current[studyIndex];
    if (!card) return;
    const review = lifecycle.reviewSummary([card.id]);
    if (review.saved || review.pending || review.failed) return;
    setIntroducedStudyCardIds(previous => { const next = new Set(previous); next.delete(card.id); return next; });
    setRevealed(false);
  }, [lifecycle, ownerSessionToken, studyIndex]);

  const reveal = useCallback(() => {
    if (!lifecycle.isCurrent(ownerSessionToken) || !lifecycle.isActive('study') || needsIntroduction) return;
    setRevealed(true);
  }, [lifecycle, needsIntroduction, ownerSessionToken]);

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
    if (!activeCard || needsIntroduction || !revealed) return 'ignored' as const;
    const activationId = lifecycle.studyActivationId();
    if (activationId === null) return 'ignored' as const;
    const intentKey = studyReviewKey(activeCard.id);
    const record = studyReviewRecordsRef.current.get(intentKey);
    const recordCommittedReview = ({ rating: persistedRating, xpAwarded }: StudyReviewReceipt) => {
        setReviewedCardId(activeCard.id);
        setXpEarned(previous => previous + xpAwarded);
        if (persistedRating === 'good' || persistedRating === 'easy') setGoodCount(previous => previous + 1);
        else {
          setAgainCount(previous => previous + 1);
          const persistedCard = studyCardsRef.current.find(card => card.id === activeCard.id) ?? activeCard;
          setWeakCards(previous => [...previous.filter(card => card.id !== activeCard.id), persistedCard]);
        }
        if (lifecycle.reviewedCount() === studyCardsRef.current.length) {
          if (persistedRating === 'good' || persistedRating === 'easy') triggerConfetti(0.5, 0.5);
          setShowRecap(true);
        }
        if (persistedRating === 'easy') playRewardSound();
        else if (persistedRating === 'good') playSuccessSound();
    };
    if (record && 'confirmedAt' in record) {
      const confirmed = record;
      const expired = Date.now() - confirmed.confirmedAt > STUDY_REVIEW_RECEIPT_MAX_AGE_MS;
      const stillPreReview = cardMatchesReviewSnapshot(activeCard, confirmed.preReviewCount, confirmed.preReviewAt);
      const adoptedInCurrentActivation = confirmed.adoptedActivationId === activationId;
      const epochChanged = confirmed.libraryEpoch !== undefined
        && activeCard.libraryEpoch !== undefined
        && confirmed.libraryEpoch !== activeCard.libraryEpoch;
      if (expired || (!stillPreReview && !adoptedInCurrentActivation) || epochChanged) {
        studyReviewRecordsRef.current.delete(intentKey);
      } else {
        if (!lifecycle.claimReview(activeCard.id)) return 'ignored' as const;
        studyReviewRecordsRef.current.delete(intentKey);
        if (!lifecycle.settleReview(activeCard.id, 'saved', activationId)) return 'ignored' as const;
        recordCommittedReview(confirmed);
        return {
          status: 'committed',
          xpAwarded: confirmed.xpAwarded,
          ...(confirmed.rating === rating ? {} : { rating: confirmed.rating }),
        } as const;
      }
    }
    let intent = record && !('confirmedAt' in record) ? record : undefined;
    if (intent) {
      const epochChanged = intent.libraryEpoch !== undefined
        && activeCard.libraryEpoch !== undefined
        && intent.libraryEpoch !== activeCard.libraryEpoch;
      const reviewSnapshotChanged = !cardMatchesReviewSnapshot(activeCard, intent.preReviewCount, intent.preReviewAt);
      if (epochChanged || reviewSnapshotChanged) {
        if (cardHasReviewOperation(activeCard, intent.operationId)) intent.adoptedActivationId = activationId;
      }
    }
    if (!intent && studyReviewRecordCount(false) >= MAX_RETAINED_STUDY_REVIEW_RECORDS) {
      const message = 'Could not save this review. Try again in a moment.';
      setReviewFailure({ cardId: activeCard.id, message });
      reportError(message);
      return 'retryable-error' as const;
    }
    if (!lifecycle.claimReview(activeCard.id)) return 'ignored' as const;
    if (!intent) {
      intent = {
        operationId: createStudyReviewOperationId(),
        rating,
        libraryEpoch: activeCard.libraryEpoch,
        preReviewCount: cardReviewCount(activeCard),
        preReviewAt: cardLastReviewAt(activeCard),
        adoptedActivationId: activationId,
      };
      studyReviewRecordsRef.current.set(intentKey, intent);
    }
    setSavingReviewCardId(activeCard.id);
    setReviewFailure(current => current?.cardId === activeCard.id ? null : current);
    try {
      const outcome = await learning.reviewCard(activeCard.id, intent.rating, intent.operationId);
      if (outcome?.status === 'review-conflict') {
        if (outcome.result.reviewConflictTerminal) {
          const retainedIntent = studyReviewRecordsRef.current.get(intentKey);
          if (retainedIntent?.operationId === intent.operationId) studyReviewRecordsRef.current.delete(intentKey);
        }
        throw new Error('This card was reviewed on another device.');
      }
      let committedReceipt: StudyReviewReceipt | undefined;
      if (outcome?.status === 'published') {
        const xpAwarded = outcome.result.xpAwarded;
        if (xpAwarded !== 0 && xpAwarded !== 2) {
          throw new Error('Review persistence did not return an authoritative XP award.');
        }
        const persistedRating = outcome.result.reviewRating ?? intent.rating;
        const publication = outcome.result.publication;
        const fields = publication?.kind === 'patch' ? publication.fields : undefined;
        committedReceipt = {
          operationId: intent.operationId,
          rating: persistedRating,
          xpAwarded,
          libraryEpoch: typeof fields?.libraryEpoch === 'number' ? fields.libraryEpoch : intent.libraryEpoch,
          preReviewCount: intent.preReviewCount,
          preReviewAt: intent.preReviewAt,
          adoptedActivationId: intent.adoptedActivationId,
          confirmedAt: Date.now(),
        };
        const retainedIntent = studyReviewRecordsRef.current.get(intentKey);
        if (lifecycle.isCurrent(operationSession) && retainedIntent?.operationId === intent.operationId) {
          rememberConfirmedStudyReview(intentKey, committedReceipt);
        }
      } else {
        throw new Error('Review persistence did not confirm this review.');
      }
      const cardStillInStudySnapshot = studyCardsRef.current.some(card => card.id === activeCard.id);
      if (!lifecycle.isCurrent(operationSession)
        || !lifecycle.isReviewClaimCurrent(activeCard.id, activationId)
        || !cardStillInStudySnapshot) {
        return 'ignored' as const;
      }
      if (!committedReceipt) return 'ignored' as const;
      const persistedRating = committedReceipt.rating;
      const xpAwarded = committedReceipt.xpAwarded;
      if (lifecycle.settleReview(activeCard.id, 'saved', activationId)) {
        studyReviewRecordsRef.current.delete(intentKey);
        recordCommittedReview(committedReceipt);
        return {
          status: 'committed',
          xpAwarded,
          ...(persistedRating === rating ? {} : { rating: persistedRating }),
        } as const;
      }
      return 'ignored' as const;
    } catch (error) {
      if (isTerminalReviewError(error)) {
        const retainedIntent = studyReviewRecordsRef.current.get(intentKey);
        if (retainedIntent?.operationId === intent.operationId) studyReviewRecordsRef.current.delete(intentKey);
      }
      if (!lifecycle.isCurrent(operationSession)
        || !lifecycle.isReviewClaimCurrent(activeCard.id, activationId)
        || !studyCardsRef.current.some(card => card.id === activeCard.id)) return 'ignored' as const;
      if (!lifecycle.settleReview(activeCard.id, 'retry', activationId)) return 'ignored' as const;
      const message = 'Could not save this review. Choose a rating to try again.';
      setReviewFailure({ cardId: activeCard.id, message });
      reportError(message);
      console.warn('Could not save the review result.', error);
      return 'retryable-error' as const;
    } finally {
      if (lifecycle.isCurrent(operationSession) && lifecycle.isStudyActivationCurrent(activationId)) {
        setSavingReviewCardId(current => current === activeCard.id ? null : current);
      }
    }
  }, [learning, lifecycle, needsIntroduction, openView, ownerSessionToken, reportError, revealed, studyIndex]);

  const close = useCallback(() => {
    if (editorRef.current) return;
    if (mode === 'quiz') quiz.clearQuiz();
    if (mode === 'spelling') quiz.clearSpelling();
    if (mode === 'language-drill') quiz.clearLanguageDrill();
    if (mode === 'story') quiz.clearStory();
    if (mode === 'study' || mode === 'match' || mode === 'shadowing') lifecycle.clear(mode);
    openView('library');
  }, [lifecycle, mode, openView, quiz]);
  const dismissStudyRecap = useCallback(() => setShowRecap(false), []);

  const updateSnapshotCard = useCallback((
    cardId: string,
    update: Partial<CardData> | ((card: CardData) => CardData),
  ) => {
    const nextCards = studyCardsRef.current.map(card => card.id === cardId
      ? typeof update === 'function' ? update(card) : { ...card, ...update }
      : card);
    studyCardsRef.current = nextCards;
    setStudyCards(nextCards);
  }, []);
  const updateSnapshotCards = useCallback((cardIds: ReadonlySet<string>, fields: Partial<CardData>) => {
    const nextCards = studyCardsRef.current.map(card => cardIds.has(card.id) ? { ...card, ...fields } : card);
    studyCardsRef.current = nextCards;
    setStudyCards(nextCards);
  }, []);
  const removeSnapshotCard = useCallback((cardId: string) => {
    const nextCards = studyCardsRef.current.filter(card => card.id !== cardId);
    studyCardsRef.current = nextCards;
    setStudyCards(nextCards);
  }, []);
  const restoreSnapshotCard = useCallback((card: CardData) => {
    const nextCards = [card, ...studyCardsRef.current.filter(candidate => candidate.id !== card.id)];
    studyCardsRef.current = nextCards;
    setStudyCards(nextCards);
  }, []);
  const clearSnapshot = useCallback(() => {
    studyCardsRef.current = [];
    setStudyCards([]);
  }, []);
  useEffect(() => {
    if (!lifecycle.isActive('study')) return;
    if (studyCards.length === 0) {
      editorRef.current = null;
      setEditingCardId(null);
      lifecycle.clear('study');
      openView('library');
      onEmptyStudy?.();
      return;
    }
    setStudyIndex(current => Math.min(current, studyCards.length - 1));
  }, [lifecycle, onEmptyStudy, openView, studyCards.length]);
  const snapshot = useMemo<PracticeSnapshotPort>(() => ({
    findCard: cardId => studyCardsRef.current.find(card => card.id === cardId),
    getCards: () => studyCardsRef.current,
    updateCard: updateSnapshotCard,
    updateCards: updateSnapshotCards,
    removeCard: removeSnapshotCard,
    restoreCard: restoreSnapshotCard,
    clear: clearSnapshot,
  }), [clearSnapshot, removeSnapshotCard, restoreSnapshotCard, updateSnapshotCard, updateSnapshotCards]);

  const scopedQuiz = scopePracticeGames(quiz, isPracticeStateCurrent, isLanguageDrillCurrent, isPracticePairCurrent);
  const activeReviewStatus = !activeCardId
    ? 'idle' as const
    : savingReviewCardId === activeCardId
      ? 'saving' as const
      : syncPendingReviewCardId === activeCardId
        ? 'sync-pending' as const
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
    sessionKey: ownerSessionToken,
    study: isPracticeStateCurrent && isStudyScopeCurrent
      ? {
          sessionKey: studySessionKey,
          cards: scopedStudyCards,
          index: studyIndex,
          recallMode,
          revealed,
          needsIntroduction,
          reviewedCardId,
          isStarting: isStartingStudy,
          reviewStatus: activeReviewStatus,
          reviewError: activeReviewError,
          isPaused: Boolean(editingCardId && editorRef.current?.cardId === editingCardId),
          goodCount,
          againCount,
          weakCards,
          showRecap,
          summary: lifecycle.reviewSummary(scopedStudyCards.map(card => card.id)),
          xpEarned,
        }
      : {
          sessionKey: studySessionKey,
          cards: [],
          index: 0,
          recallMode: 'adaptive',
          revealed: false,
          needsIntroduction: false,
          reviewedCardId: null,
          isStarting: false,
          reviewStatus: 'idle',
          reviewError: null,
          isPaused: false,
          goodCount: 0,
          againCount: 0,
          weakCards: [],
          showRecap: false,
          summary: { saved: 0, skipped: 0, failed: 0, pending: 0, remaining: 0 },
          xpEarned: 0,
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
      dismissStudyRecap, beginStudyRecall, requestStudyIntroduction,
      reveal: () => { if (!isEditorOpen()) reveal(); },
      setRecallMode: value => { if (!isEditorOpen()) setRecallMode(value); },
      setStudyIndex: value => { if (!isEditorOpen()) navigateStudyIndex(value); },
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

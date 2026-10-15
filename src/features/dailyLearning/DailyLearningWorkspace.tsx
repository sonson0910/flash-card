import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import type { CardData, ReviewRatingValue } from '../../types/card';
import type { LearningStateOutcome } from '../learning/learningStateController';
import type { LanguageProfile } from '../language/languageProfile';
import { triggerHaptic } from '../../lib/haptics';
import { firebasePracticeSessionService, practiceTimeZone, type PracticeGamificationOutcome, type PracticeSessionChallenge } from '../practice/practiceSessionService';
import { cardsForLanguagePair } from '../practice/practiceModel';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import { buildDailyLessonSteps, buildDailyPlan, logicalIdentity, type DailyPlan, type DailyPlanItem } from './dailyPlan';
import { createDailyPracticePoolRuntime } from './dailyPracticePoolRuntime';
import { createDailySessionController } from './dailySessionController';
import { readDailyLearningUrlState, type DailyLessonMode } from './dailyLearningUrl';
import { normalizeCardWord } from '../../lib/cardIdentity';
import { currentLessonStep } from './lessonReducer';
import {
  buildExercise,
  getEligibleExerciseModes,
  type Exercise,
  type ExerciseAnswer,
  type ExerciseMode,
} from './exerciseEngine';
import { buildPlacementCheck, evaluatePlacement, type PlacementCheck, type PlacementResult } from './placementEngine';
import { inferScriptScoringPolicy } from './scriptScoring';
import { sessionStageContent, TodayScreen } from './TodayScreen';
import {
  buildSessionStagePlan,
  clearDailySessionPointer,
  consumeScheduledFreshPriority,
  emptyDailySessionStats,
  applyRatingToStats,
  firstOutstandingStage,
  logicalIdsOf,
  nextOutstandingStage,
  outstandingItems,
  readDailySessionPointer,
  readPendingFreshPriority,
  restoredSessionMatchStage,
  preparePendingMatchCompletion,
  sessionStageItemCount,
  SESSION_STAGE_ORDER,
  skippedUnavailableMatchStage,
  writeDailySessionPointer,
  type DailySessionPointer,
  type DailySessionStats,
  type SessionStageId,
  type SessionStagePlan,
} from './dailySessionStages';
import { LISTEN_MVP_PILOT_LESSONS, selectListenMvpPilotLesson } from '../listenMvp/listenMvpPilot';
import type { ListenMvpLessonV1 } from '../listenMvp/listenMvpContract';
import { LISTEN_PHRASE_CARDS, listenPhraseCardToLibraryCard } from '../listenMvp/listenPhraseCards';
import type { IntakeSharingSessionActions } from '../intake/useIntakeSharingSession';
import type { CardIntakeSharedAdoptionResult } from '../intake/cardIntakeController';
import {
  createLocalSkillEvidenceRecorder,
  readBrowserSkillEvidenceLedger,
} from '../skillEvidence/skillEvidenceStorage';
import {
  buildTodaySkillStates,
  buildTodayAdaptiveRecommendation,
  launchTodayAdaptiveLesson,
} from '../adaptiveLearning/todayAdaptiveRecommendation';
import type {
  DailySessionTarget,
  LessonAnswerPresentation,
  LessonMode,
  LessonScreenModel,
  PlacementScreenModel,
  SessionBridgeModel,
  SessionBridgeStat,
  TodayScreenModel,
} from './dailyLearningPresentation';
import { evidencedStudyStreak } from './dailyLearningPresentation';
import { subscribeToActiveSessionNewStagePromotions } from './webWordsSessionPriority';

const LessonScreen = lazy(() => import('./LessonScreen').then(module => ({ default: module.LessonScreen })));
const PlacementScreen = lazy(() => import('./PlacementScreen').then(module => ({ default: module.PlacementScreen })));
const SessionBridge = lazy(() => import('./SessionBridge').then(module => ({ default: module.SessionBridge })));
const WordMatchView = lazy(() => import('../practice/WordMatchView').then(module => ({ default: module.WordMatchView })));
const SessionRecapModal = lazy(() => Promise.all([
  import('../practice/SessionRecapModal'), loadCatalog(getActiveUiLocale(), 'practice'),
]).then(([module]) => ({ default: module.SessionRecapModal })));
const interactionFallback = <div role="status" className="rounded-2xl border border-[var(--sf-border)] p-5"><Trans {...msg({ context: 'today.activity.preparing', message: 'Preparing activity…' })} /></div>;

/** Sequenced session phases: a review/new lesson reuses the single-lesson controller and screen; bridge/match/recap are their own screens. */
type MultiStagePhase =
  | { readonly kind: 'lesson'; readonly stage: 'review' | 'new' }
  | { readonly kind: 'bridge'; readonly completedStage: SessionStageId; readonly nextStage: SessionStageId }
  | { readonly kind: 'match' }
  | { readonly kind: 'recap' };

type MatchStatus = 'idle' | 'starting' | 'ready' | 'start-error' | 'completing' | 'complete-error';

interface MultiStageState {
  readonly ownerId: string | null;
  readonly targetLanguage: string;
  readonly translationLanguage: string;
  readonly stagePlan: SessionStagePlan;
  readonly phase: MultiStagePhase;
  readonly stats: DailySessionStats;
  readonly startedAt: string;
  readonly matchStartOpId: string | null;
  readonly matchCompletionId: string | null;
  readonly matchTimeZone?: string;
  readonly matchCompletionPending: boolean;
  readonly matchStatus: MatchStatus;
}

const phaseForStage = (stage: SessionStageId): MultiStagePhase => stage === 'review' || stage === 'new'
  ? { kind: 'lesson', stage }
  : { kind: stage };

const dailyMatchOperationId = (kind: 'start' | 'complete') => {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `daily-match-${kind}-${random}`;
};

const frozenMatchCards = (
  challenge: PracticeSessionChallenge,
  expectedIds: readonly string[],
  targetLanguage: string,
  translationLanguage: string,
): CardData[] => {
  if (challenge.kind !== 'match' || challenge.cards.length !== expectedIds.length
    || challenge.cards.some((card, index) => card.cardId !== expectedIds[index])) {
    throw new Error('The practice session returned the wrong Word Match challenge.');
  }
  return challenge.cards.map(card => ({
    id: card.cardId, word: card.word, translation: card.translation, language: targetLanguage, translationLanguage,
  } as CardData));
};

const pointerForSession = (state: MultiStageState): DailySessionPointer | null => state.ownerId ? {
  ownerId: state.ownerId,
  targetLanguage: state.targetLanguage,
  translationLanguage: state.translationLanguage,
  stage: state.phase.kind === 'lesson' ? state.phase.stage
    : state.phase.kind === 'bridge' ? state.phase.completedStage : state.phase.kind,
  ...(state.phase.kind === 'bridge' ? { bridgeCompletedStage: state.phase.completedStage } : {}),
  reviewLogicalIds: logicalIdsOf(state.stagePlan.review),
  freshLogicalIds: logicalIdsOf(state.stagePlan.fresh),
  matchCardIds: state.stagePlan.match.cards.map(card => card.id),
  matchSkipReason: state.stagePlan.match.skipReason,
  matchStartOpId: state.matchStartOpId,
  matchCompletionId: state.matchCompletionId,
  ...(state.matchTimeZone ? { matchTimeZone: state.matchTimeZone } : {}),
  matchCompletionPending: state.matchCompletionPending,
  stats: state.stats,
  startedAt: state.startedAt,
} : null;

const exercisesFor = (items: readonly DailyPlanItem[], pool: readonly CardData[]): Exercise[] => items.map(({ card }) => (
  buildExercise(card, pool, 'recognition', inferScriptScoringPolicy(card.word))
));

const itemsForStage = (stagePlan: SessionStagePlan, stage: 'review' | 'new'): readonly DailyPlanItem[] => (
  stage === 'review' ? stagePlan.review : stagePlan.fresh
);

/** Moves pending-fresh-priority items (WebWords "add to today" before any session existed) to the front of the 'new' stage, in queue order. */
const withFreshPriority = (stagePlan: SessionStagePlan, pendingLogicalIds: readonly string[]): SessionStagePlan => {
  if (pendingLogicalIds.length === 0) return stagePlan;
  const byLogicalId = new Map(stagePlan.fresh.map(item => [item.logicalId, item] as const));
  const prioritized = pendingLogicalIds.flatMap(logicalId => {
    const item = byLogicalId.get(logicalId);
    return item ? [item] : [];
  });
  const prioritizedIds = new Set(prioritized.map(item => item.logicalId));
  return { ...stagePlan, fresh: [...prioritized, ...stagePlan.fresh.filter(item => !prioritizedIds.has(item.logicalId))] };
};

/** Restores the frozen new-stage snapshot without letting today's review cap evict an already-queued word. */
export const freshItemsForResume = (
  freshLogicalIds: readonly string[],
  pool: readonly CardData[],
  now: Date,
): readonly DailyPlanItem[] => {
  const seen = new Set<string>();
  return freshLogicalIds.flatMap(logicalId => {
    if (seen.has(logicalId)) return [];
    seen.add(logicalId);
    const item = buildDailyPlan(pool.filter(card => logicalIdentity(card) === logicalId), { now })
      .items.find(candidate => candidate.reason === 'new');
    return item ? [item] : [];
  });
};

/** A Word Match round can be today's only eligible session stage. */
export function hasMatchOnlySession(
  plan: DailyPlan | null,
  pool: readonly CardData[],
  targetLanguage: string,
  translationLanguage: string,
): boolean {
  return Boolean(plan && plan.items.length === 0 && buildSessionStagePlan(
    plan,
    pool,
    () => 0,
    { targetLanguage, translationLanguage },
  ).match.cards.length > 0);
}
const PublishedListenMvp = lazy(() => import('../listenMvp/PublishedListenMvp'));
import { shouldUseListenPilot } from './dailyLearningPresentation';

export interface DailyLearningWorkspaceProps {
  readonly ownerId: string | null;
  /** Active course's language pair; defaults to English-Vietnamese for legacy users with no active course. */
  readonly languageProfile: LanguageProfile;
  readonly isOffline: boolean;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent?: number;
  readonly initialLesson: DailyLessonMode | null;
  readonly streak: number;
  readonly studyXpHistory: readonly { readonly date: string; readonly XP: number }[];
  readonly rewardTimeZone?: string;
  readonly loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  readonly reviewCard: (cardId: string, rating: ReviewRatingValue, operationId: string, source?: CardData) => Promise<LearningStateOutcome>;
  readonly openLesson: (mode: DailyLessonMode | null) => void;
  readonly openVocabulary: () => void;
  readonly openPaths: () => void;
  readonly continueReview: () => void | Promise<void>;
  readonly openMorePractice: (opener: HTMLButtonElement) => void;
  readonly openWeeklyRecap: () => void;
  readonly onVerifiedPracticeOutcome: (outcome: PracticeGamificationOutcome, operationId: string, ownerId: string) => void;
  readonly adoptCatalogCards?: IntakeSharingSessionActions['adoptCards'];
  readonly onPracticePhrase?: (handoff: {
    readonly ownerId: string | null;
    readonly clipId: string;
    readonly generation: number;
    readonly cards: readonly CardData[];
    readonly opener: HTMLButtonElement;
  }) => void;
  readonly onListenScopeChange?: (scope: {
    readonly ownerId: string | null;
    readonly clipId: string | null;
    readonly generation: number;
  }) => void;
}

type PoolState =
  | { status: 'loading'; ownerId: string | null; cards: readonly CardData[]; error: null }
  | { status: 'ready'; ownerId: string | null; cards: readonly CardData[]; error: null }
  | { status: 'error'; ownerId: string | null; cards: readonly CardData[]; error: string };

type ListenResolvedCards = {
  readonly scopeKey: string;
  readonly generation: number;
  readonly cards: readonly CardData[];
};

export interface DailyPracticePoolScope {
  readonly ownerId: string | null;
  readonly targetLanguage: string;
}

export const didDailyPracticePoolScopeChange = (
  previous: DailyPracticePoolScope | null,
  next: DailyPracticePoolScope,
): boolean => !previous || previous.ownerId !== next.ownerId || previous.targetLanguage !== next.targetLanguage;

export const isCaughtUpDailyPlan = (plan: DailyPlan | null, hasPoolCards: boolean, matchOnlySession: boolean): boolean => (
  plan?.items.length === 0 && hasPoolCards && !matchOnlySession
);

export const dailyTodayStatus = (
  poolStatus: PoolState['status'],
  plan: DailyPlan | null,
  hasPoolCards: boolean,
  matchOnlySession: boolean,
  isOffline: boolean,
): TodayScreenModel['status'] => {
  if (poolStatus === 'loading') return 'loading';
  if (poolStatus === 'error') return 'error';
  if (isCaughtUpDailyPlan(plan, hasPoolCards, matchOnlySession)) return 'caught-up';
  if (!plan?.items.length && !matchOnlySession) return 'empty';
  return isOffline ? 'offline' : 'ready';
};

const errorMessage = (error: unknown, fallback: string) => error instanceof Error && error.message.trim()
  ? error.message
  : fallback;

const listenPhraseForChunk = (chunk: ListenMvpLessonV1['chunk']) => LISTEN_PHRASE_CARDS.find(entry => (
  chunk.lexemeIds.includes(entry.id)
  && normalizeCardWord(entry.lemma) === normalizeCardWord(chunk.text)
));

const isNonNegativeSafeInteger = (value: unknown): value is number => (
  Number.isSafeInteger(value) && Number(value) >= 0
);

const isResolvedListenCard = (value: unknown, expectedWord: string): value is CardData => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const card = value as Partial<CardData>;
  if (
    typeof card.id !== 'string'
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(card.id)
    || typeof card.word !== 'string'
  ) return false;
  const normalizedWord = normalizeCardWord(card.normalizedWord) || normalizeCardWord(card.word);
  return normalizedWord === expectedWord;
};

export const adoptListenPhraseCard = async (
  chunk: ListenMvpLessonV1['chunk'],
  adoptCards: NonNullable<IntakeSharingSessionActions['adoptCards']>,
): Promise<readonly CardData[]> => {
  const phrase = listenPhraseForChunk(chunk);
  if (!phrase) throw new Error('This listening phrase has no editorial card mapping.');
  const result: unknown = await adoptCards([listenPhraseCardToLibraryCard(phrase)]);
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('The phrase save returned a malformed result.');
  }
  const adoption = result as Partial<CardIntakeSharedAdoptionResult>;
  const resolvedCards = adoption.status === 'completed' ? adoption.resolvedCards : null;
  const createdCount = adoption.status === 'completed' ? adoption.createdCount : null;
  const reusedCount = adoption.status === 'completed' ? adoption.reusedCount : null;
  const cards = adoption.status === 'completed' ? adoption.cards : null;
  const expectedWord = normalizeCardWord(phrase.lemma);
  if (
    adoption.status !== 'completed'
    || adoption.candidateCount !== 1
    || !isNonNegativeSafeInteger(createdCount)
    || !isNonNegativeSafeInteger(reusedCount)
    || createdCount + reusedCount !== 1
    || !Array.isArray(cards)
    || cards.length !== createdCount
    || !Array.isArray(resolvedCards)
    || resolvedCards.length !== 1
    || !isResolvedListenCard(resolvedCards[0], expectedWord)
    || (createdCount === 1 && (
      !isResolvedListenCard(cards[0], expectedWord)
      || cards[0].id !== resolvedCards[0].id
    ))
  ) {
    throw new Error('The phrase was not fully resolved in the library.');
  }
  return resolvedCards;
};

const answerFor = (exercise: Exercise | undefined, value: string, tokenIds: readonly string[]): ExerciseAnswer => {
  if (exercise?.mode === 'sentence-building') return tokenIds;
  return value;
};

const expectedAnswer = (exercise: Exercise): string => exercise.mode === 'sentence-building'
  ? exercise.answerTokens.map(token => token.text).join(' ')
  : exercise.answer;

const promptLanguageFor = (exercise: Exercise, card: CardData | undefined, uiLocale: string): string => {
  if (!card) return exercise.promptLanguage;
  if (exercise.mode === 'cloze' || exercise.prompt === card.word || exercise.prompt === card.exampleSentence) return card.language || 'en';
  if (exercise.prompt === card.translation || exercise.prompt === card.exampleTranslation) return card.translationLanguage || 'vi';
  return uiLocale;
};

const answerPresentation = (
  exercise: Exercise,
  value: string,
  tokenIds: readonly string[],
  card?: CardData,
  answerLabel?: string,
): LessonAnswerPresentation => {
  if (exercise.mode === 'recognition') {
    return {
      kind: 'choice', selectedId: value || null,
      options: exercise.options.map(option => ({ id: option, label: option, language: card?.translationLanguage || 'vi' })),
    };
  }
  if (exercise.mode === 'sentence-building') {
    return {
      kind: 'sentence',
      tokens: exercise.tokens.map(token => ({
        occurrenceId: token.id, label: token.text, language: card?.language || 'en', isSelected: tokenIds.includes(token.id),
      })),
      selectedOrder: tokenIds.flatMap(id => {
        const token = exercise.tokens.find(candidate => candidate.id === id);
        return token ? [{ occurrenceId: token.id, label: token.text, language: card?.language || 'en', isSelected: true }] : [];
      }),
    };
  }
  return { kind: 'text', value, label: answerLabel ?? exercise.instruction, language: card?.language || 'en' };
};

export default function DailyLearningWorkspace({
  ownerId,
  languageProfile,
  isOffline,
  headingRef,
  focusIntent = 0,
  initialLesson,
  streak,
  studyXpHistory,
  rewardTimeZone,
  loadPracticePool,
  reviewCard,
  openLesson,
  openVocabulary,
  openPaths,
  continueReview,
  openMorePractice,
  openWeeklyRecap,
  onVerifiedPracticeOutcome,
  adoptCatalogCards,
  onPracticePhrase,
  onListenScopeChange,
}: DailyLearningWorkspaceProps) {
  const { _, i18n } = useLingui();
  const courseLanguageNames = new Intl.DisplayNames([i18n.locale], { type: 'language' });
  const modeLabels: Readonly<Record<ExerciseMode, string>> = {
    recognition: _(msg({ id: 'today.mode.recognition', message: 'Recognition' })),
    'active-recall': _(msg({ id: 'today.mode.active-recall', message: 'Active recall' })),
    listening: _(msg({ id: 'today.mode.listening', message: 'Listening' })),
    spelling: _(msg({ id: 'today.mode.spelling', message: 'Spelling' })),
    cloze: _(msg({ id: 'today.mode.cloze', message: 'Cloze' })),
    'sentence-building': _(msg({ id: 'today.mode.sentence-building', message: 'Sentence building' })),
  };
  const instructionFor = (exercise: Exercise): string => {
    switch (exercise.mode) {
      case 'recognition': return _(msg({ id: 'today.instruction.recognition', message: 'Choose the matching meaning' }));
      case 'active-recall': return _(msg({ id: 'today.instruction.active-recall', message: 'Type the vocabulary item for this meaning' }));
      case 'listening': return _(msg({ id: 'today.instruction.listening', message: 'Listen and type what you hear' }));
      case 'spelling': return _(msg({ id: 'today.instruction.spelling', message: 'Spell the vocabulary item' }));
      case 'cloze': return _(msg({ id: 'today.instruction.cloze', message: 'Complete the missing vocabulary item' }));
      case 'sentence-building': return _(msg({ id: 'today.instruction.sentence-building', message: 'Put the sentence in order' }));
    }
  };
  const promptFor = (exercise: Exercise, card?: CardData): string => {
    if (card && [card.word, card.translation, card.exampleSentence, card.exampleTranslation, card.explanation].includes(exercise.prompt)) return exercise.prompt;
    if (exercise.prompt === 'Audio prompt') return _(msg({ id: 'today.prompt.audio', message: 'Audio prompt' }));
    if (exercise.prompt === 'Choose the correct meaning') return _(msg({ id: 'today.prompt.choose-meaning', message: 'Choose the correct meaning' }));
    if (exercise.prompt === 'Recall this vocabulary item from its context') return _(msg({ id: 'today.prompt.recall-context', message: 'Recall this vocabulary item from its context' }));
    if (exercise.prompt === 'Spell the vocabulary item from its context') return _(msg({ id: 'today.prompt.spell-context', message: 'Spell the vocabulary item from its context' }));
    if (exercise.prompt === 'Build the sentence in the correct order') return _(msg({ id: 'today.prompt.build-sentence', message: 'Build the sentence in the correct order' }));
    if (exercise.prompt === 'Build the sentence') return _(msg({ id: 'today.prompt.build-sentence-short', message: 'Build the sentence' }));
    return exercise.prompt;
  };
  const targetLanguage = languageProfile.source.code;
  const translationLanguage = languageProfile.target.code;
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  const targetLanguageRef = useRef(targetLanguage);
  targetLanguageRef.current = targetLanguage;
  const translationLanguageRef = useRef(translationLanguage);
  translationLanguageRef.current = translationLanguage;
  const lessonAudioRef = useRef<HTMLAudioElement | null>(null);
  const lessonAudioGenerationRef = useRef(0);
  const cancelLessonAudio = useCallback(() => {
    lessonAudioGenerationRef.current += 1;
    lessonAudioRef.current?.pause();
    lessonAudioRef.current = null;
  }, []);
  useEffect(() => () => { cancelLessonAudio(); }, [cancelLessonAudio, ownerId]);
  const listenOwnerSessionRef = useRef({ ownerId, generation: 0 });
  if (listenOwnerSessionRef.current.ownerId !== ownerId) {
    listenOwnerSessionRef.current = {
      ownerId,
      generation: listenOwnerSessionRef.current.generation + 1,
    };
  }
  const listenOwnerSession = listenOwnerSessionRef.current;
  const poolLoadRef = useRef(loadPracticePool);
  poolLoadRef.current = loadPracticePool;
  const lastPoolLoaderRef = useRef(loadPracticePool);
  const reviewRef = useRef(reviewCard);
  reviewRef.current = reviewCard;
  const dailyCardsRef = useRef<readonly CardData[]>([]);
  const lessonScopeRef = useRef({ ownerId, targetLanguage, translationLanguage });
  const previousSessionScopeRef = useRef({ ownerId, targetLanguage, translationLanguage });
  const previousPoolScopeRef = useRef<DailyPracticePoolScope | null>(null);
  const lastPoolLoaderScopeRef = useRef({ ownerId, targetLanguage, translationLanguage });
  const poolRuntime = useMemo(() => createDailyPracticePoolRuntime({
    activeOwner: () => ownerRef.current,
    loadPracticePool: (maximum, includeFuture) => poolLoadRef.current(maximum, includeFuture),
  }), []);
  const session = useMemo(() => createDailySessionController({
    reviewCard: (cardId, rating, operationId) => reviewRef.current(
      cardId,
      rating,
      operationId,
      dailyCardsRef.current.find(card => card.id === cardId),
    ),
  }), []);
  const recordListenEvidence = useMemo(() => createLocalSkillEvidenceRecorder({
    activeOwner: () => ownerRef.current,
  }), []);
  const [skillEvidenceRevision, setSkillEvidenceRevision] = useState(0);
  const recordListenEvidenceAndRefresh = useMemo(() => {
    const record = recordListenEvidence;
    return (evidence: Parameters<typeof record>[0]) => {
      record(evidence);
      setSkillEvidenceRevision(revision => revision + 1);
    };
  }, [recordListenEvidence]);
  const [pool, setPool] = useState<PoolState>({ status: 'loading', ownerId, cards: [], error: null });
  const [lesson, setLesson] = useState(session.getSnapshot());
  const [routeLesson, setRouteLesson] = useState<DailyLessonMode | null>(initialLesson);
  const [multiStage, setMultiStage] = useState<MultiStageState | null>(null);
  const multiStageRef = useRef(multiStage);
  useLayoutEffect(() => {
    multiStageRef.current = multiStage;
  }, [multiStage]);
  const isCurrentSession = useCallback((state: MultiStageState | null): state is MultiStageState => Boolean(
    state
    && targetLanguageRef.current === targetLanguage
    && translationLanguageRef.current === translationLanguage
    && state.ownerId === ownerRef.current
    && state.targetLanguage === targetLanguage
    && state.translationLanguage === translationLanguage
  ), [targetLanguage, translationLanguage]);
  const isCurrentMatch = useCallback((
    state: MultiStageState | null,
    status?: MatchStatus,
    startId?: string,
    completionId?: string,
  ): state is MultiStageState => (
    isCurrentSession(state)
    && state.phase.kind === 'match'
    && (!status || state.matchStatus === status)
    && (!startId || state.matchStartOpId === startId)
    && (!completionId || state.matchCompletionId === completionId)
  ), [isCurrentSession]);
  const updateCurrentMatch = useCallback((
    update: (current: MultiStageState) => MultiStageState,
    status?: MatchStatus,
    startId?: string,
    completionId?: string,
  ) => setMultiStage(current => isCurrentMatch(current, status, startId, completionId) ? update(current) : current), [isCurrentMatch]);
  const recordedReviewOperationIdsRef = useRef(new Set<string>());
  const [answer, setAnswer] = useState('');
  const [tokenIds, setTokenIds] = useState<readonly string[]>([]);
  const [placementCheck, setPlacementCheck] = useState<PlacementCheck | null>(null);
  const [placementIndex, setPlacementIndex] = useState(-1);
  const [placementChoice, setPlacementChoice] = useState<string | null>(null);
  const [placementAnswers, setPlacementAnswers] = useState<Readonly<Record<string, boolean>>>({});
  const [placementResult, setPlacementResult] = useState<PlacementResult | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [headingFocusIntent, setHeadingFocusIntent] = useState(0);
  const poolErrorFallbackRef = useRef('');
  poolErrorFallbackRef.current = _(msg({ id: 'today.pool.error', message: 'The daily practice pool could not be prepared.' }));
  const [listenPilotIndex, setListenPilotIndex] = useState(0);
  const [listenPilotRoute, setListenPilotRoute] = useState(() => shouldUseListenPilot(
    initialLesson,
    true,
    LISTEN_MVP_PILOT_LESSONS.length > 0,
  ));
  const listenPilotNextIndexRef = useRef(0);
  const listenPilotLesson = listenPilotRoute && routeLesson === 'listening'
    ? selectListenMvpPilotLesson(listenPilotIndex)
    : null;
  const listenScopeKey = `${ownerId ?? 'guest'}:${listenPilotLesson?.clip.id ?? 'none'}`;
  const listenScopeRef = useRef({ scopeKey: listenScopeKey, generation: 0 });
  if (listenScopeRef.current.scopeKey !== listenScopeKey) {
    listenScopeRef.current = {
      scopeKey: listenScopeKey,
      generation: listenScopeRef.current.generation + 1,
    };
  }
  const listenScope = listenScopeRef.current;
  const [listenResolvedCards, setListenResolvedCards] = useState<ListenResolvedCards | null>(null);
  const activeListenResolvedCards = listenResolvedCards?.scopeKey === listenScope.scopeKey
    && listenResolvedCards.generation === listenScope.generation
    ? listenResolvedCards.cards
    : null;

  const load = useCallback(async () => {
    const expectedOwner = ownerRef.current;
    setPool(current => ({ status: 'loading', ownerId: expectedOwner, cards: current.ownerId === expectedOwner ? current.cards : [], error: null }));
    try {
      const result = await poolRuntime.load();
      if (result.status === 'loaded') {
        dailyCardsRef.current = result.cards;
        setPool({ status: 'ready', ownerId: result.ownerId, cards: result.cards, error: null });
      }
    } catch (error) {
      if (ownerRef.current === expectedOwner) setPool(current => ({ status: 'error', ownerId: expectedOwner, cards: current.ownerId === expectedOwner ? current.cards : [], error: errorMessage(error, poolErrorFallbackRef.current) }));
    }
  }, [poolRuntime]);

  useEffect(() => session.subscribe(setLesson), [session]);
  useLayoutEffect(() => {
    if (headingFocusIntent > 0 || focusIntent > 0) headingRef?.current?.focus({ preventScroll: true });
  }, [focusIntent, headingFocusIntent, headingRef]);
  useEffect(() => {
    const handlePopState = () => {
      const next = readDailyLearningUrlState(window.location.href).lesson;
      setRouteLesson(next);
      setListenPilotRoute(shouldUseListenPilot(next, true, LISTEN_MVP_PILOT_LESSONS.length > 0));
      setHeadingFocusIntent(intent => intent + 1);
      if (!next) {
        session.close();
        if (multiStageRef.current) {
          const pendingMatch = multiStageRef.current.matchCompletionPending;
          setMultiStage(null);
          if (!pendingMatch && ownerRef.current) clearDailySessionPointer(ownerRef.current);
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [session]);
  useEffect(() => {
    const previousScope = previousSessionScopeRef.current;
    if (previousScope.ownerId !== ownerId || previousScope.targetLanguage !== targetLanguage || previousScope.translationLanguage !== translationLanguage) {
      if (previousScope.ownerId) clearDailySessionPointer(previousScope.ownerId);
      previousSessionScopeRef.current = { ownerId, targetLanguage, translationLanguage };
    }
    session.close();
    setPlacementCheck(null);
    setPlacementIndex(-1);
    setPlacementChoice(null);
    setPlacementAnswers({});
    setPlacementResult(null);
    setMultiStage(null);
  }, [ownerId, session, targetLanguage, translationLanguage]);
  useEffect(() => {
    const nextPoolScope = { ownerId, targetLanguage };
    if (!didDailyPracticePoolScopeChange(previousPoolScopeRef.current, nextPoolScope)) return;
    previousPoolScopeRef.current = nextPoolScope;
    poolRuntime.ownerChanged();
    dailyCardsRef.current = [];
    setPool({ status: 'loading', ownerId, cards: [], error: null });
    void load();
  }, [load, ownerId, poolRuntime, targetLanguage]);
  useEffect(() => {
    const loaderChanged = lastPoolLoaderRef.current !== loadPracticePool;
    const previousScope = lastPoolLoaderScopeRef.current;
    lastPoolLoaderRef.current = loadPracticePool;
    lastPoolLoaderScopeRef.current = { ownerId, targetLanguage, translationLanguage };
    if (!loaderChanged) return;
    if (previousScope.ownerId !== ownerId || previousScope.targetLanguage !== targetLanguage || previousScope.translationLanguage !== translationLanguage) return;
    if (!session.getSnapshot()) void load();
  }, [load, loadPracticePool, ownerId, session, targetLanguage, translationLanguage]);
  useEffect(() => { setAnswer(''); setTokenIds([]); setAudioError(null); }, [lesson?.index]);
  useEffect(() => {
    if (!isCurrentSession(multiStage)) return;
    const pointer = pointerForSession(multiStage);
    if (pointer) writeDailySessionPointer(pointer);
  }, [isCurrentSession, multiStage]);
  useLayoutEffect(() => {
    setListenResolvedCards(null);
    onListenScopeChange?.({
      ownerId,
      clipId: listenPilotLesson?.clip.id ?? null,
      generation: listenScope.generation,
    });
  }, [listenPilotLesson?.clip.id, listenScope.generation, onListenScopeChange, ownerId]);

  const activePool: PoolState = pool.ownerId === ownerId ? pool : { status: 'loading', ownerId, cards: [], error: null };
  const currentPairCards = useMemo(
    () => cardsForLanguagePair(activePool.cards, targetLanguage, translationLanguage),
    [activePool.cards, targetLanguage, translationLanguage],
  );
  useEffect(() => subscribeToActiveSessionNewStagePromotions(promotion => {
    let admitted: readonly DailyPlanItem[] = [];
    flushSync(() => {
      setMultiStage(state => {
        if (!isCurrentSession(state)
          || state.ownerId !== promotion.ownerId
          || state.targetLanguage !== promotion.languagePair.targetLanguage
          || state.translationLanguage !== promotion.languagePair.translationLanguage) return state;
        const currentLogicalIds = new Set(logicalIdsOf(state.stagePlan.fresh));
        admitted = freshItemsForResume(promotion.logicalIds, dailyCardsRef.current, new Date())
          .filter(item => !currentLogicalIds.has(item.logicalId));
        return admitted.length > 0
          ? {
            ...state,
            stagePlan: { ...state.stagePlan, fresh: [...admitted, ...state.stagePlan.fresh] },
            ...(state.phase.kind === 'bridge' ? { phase: { ...state.phase, nextStage: 'new' as const } } : {}),
          }
          : state;
      });
    });
    const committed = multiStageRef.current;
    if (!isCurrentSession(committed)
      || admitted.length === 0
      || admitted.some(item => !logicalIdsOf(committed.stagePlan.fresh).includes(item.logicalId))) return [];
    const pointer = pointerForSession(committed);
    if (pointer) writeDailySessionPointer(pointer);
    if (committed.phase.kind === 'lesson' && committed.phase.stage === 'new') {
      session.append(exercisesFor(admitted, currentPairCards));
    }
    return admitted.map(item => item.logicalId);
  }), [currentPairCards, isCurrentSession, session]);
  const plan: DailyPlan | null = useMemo(() => activePool.status === 'ready'
    ? buildDailyPlan(currentPairCards, { now: new Date() })
    : null, [activePool.status, currentPairCards]);
  const matchOnlySession = useMemo(
    () => hasMatchOnlySession(plan, activePool.cards, targetLanguage, translationLanguage),
    [activePool.cards, plan, targetLanguage, translationLanguage],
  );
  const caughtUp = isCaughtUpDailyPlan(plan, currentPairCards.length > 0, matchOnlySession);
  const placementCandidates = useMemo(() => currentPairCards.filter(card => (
    getEligibleExerciseModes(card, currentPairCards).includes('recognition')
  )), [currentPairCards]);
  const skillStatesByLexeme = useMemo(() => {
    if (!ownerId) return new Map();
    const chunkLexemeIds = new Map(
      LISTEN_MVP_PILOT_LESSONS.map(lesson => [lesson.chunk.id, lesson.chunk.lexemeIds] as const),
    );
    return buildTodaySkillStates(
      readBrowserSkillEvidenceLedger(ownerId).records,
      ownerId,
      chunkLexemeIds,
    );
  }, [ownerId, skillEvidenceRevision]);
  const recommendation = useMemo(() => activePool.status === 'ready'
    ? buildTodayAdaptiveRecommendation({
      ownerId,
      plan,
      cards: activePool.cards,
      skillStatesByLexeme,
      isOffline,
      now: new Date(),
    })
    : null, [activePool.cards, activePool.status, isOffline, ownerId, plan, skillStatesByLexeme]);
  const availablePlacement = useMemo(() => buildPlacementCheck(placementCandidates), [placementCandidates]);
  const navigateLesson = useCallback((mode: DailyLessonMode | null, focusDestination = true) => {
    setRouteLesson(mode);
    if (mode !== 'listening') setListenPilotRoute(false);
    if (focusDestination) setHeadingFocusIntent(intent => intent + 1);
    openLesson(mode);
  }, [openLesson]);

  const startLesson = useCallback((
    mode: LessonMode,
    focusDestination = true,
    allowListenPilot = true,
    maximumActivities?: DailySessionTarget,
  ) => {
    const pilot = shouldUseListenPilot(mode, allowListenPilot, LISTEN_MVP_PILOT_LESSONS.length > 0)
      ? selectListenMvpPilotLesson(listenPilotNextIndexRef.current)
      : null;
    setListenPilotRoute(Boolean(pilot));
    if (pilot) {
      setListenPilotIndex(listenPilotNextIndexRef.current);
      listenPilotNextIndexRef.current = (listenPilotNextIndexRef.current + 1) % LISTEN_MVP_PILOT_LESSONS.length;
      navigateLesson(mode, focusDestination);
      return;
    }
    if (!plan?.items.length) return;
    const selectedItems = plan.items.slice(0, maximumActivities ?? plan.items.length);
    const selectedCards = isOffline
      ? currentPairCards.map(card => ({ ...card, audioUrl: null }))
      : currentPairCards;
    const lessonItems = isOffline
      ? selectedItems.map(item => ({ ...item, card: { ...item.card, audioUrl: null } }))
      : selectedItems;
    const steps = buildDailyLessonSteps(lessonItems, selectedCards, mode);
    lessonScopeRef.current = { ownerId: ownerRef.current, targetLanguage, translationLanguage };
    session.start(steps);
    navigateLesson(mode, focusDestination);
  }, [currentPairCards, navigateLesson, plan, session, targetLanguage, translationLanguage]);

  const startStageExercises = useCallback((items: readonly DailyPlanItem[]) => {
    lessonScopeRef.current = { ownerId: ownerRef.current, targetLanguage, translationLanguage };
    recordedReviewOperationIdsRef.current.clear();
    session.start(exercisesFor(items, currentPairCards));
  }, [currentPairCards, session, targetLanguage, translationLanguage]);

  const clearOwnerPointer = useCallback(() => {
    if (ownerRef.current) clearDailySessionPointer(ownerRef.current);
  }, []);

  const exitMultiStageSession = useCallback(() => {
    session.close();
    setMultiStage(null);
    clearOwnerPointer();
    navigateLesson(null);
  }, [session, clearOwnerPointer, navigateLesson]);

  const finishMultiStageSession = useCallback((reload = true) => {
    setMultiStage(null);
    clearOwnerPointer();
    navigateLesson(null);
    if (reload) void load();
  }, [clearOwnerPointer, navigateLesson, load]);

  const beginMultiStageSession = useCallback(() => {
    if (isOffline) return;
    const owner = ownerRef.current;
    const pendingPointer = owner ? readDailySessionPointer(owner) : null;
    if (pendingPointer?.matchCompletionPending
      && pendingPointer.targetLanguage === targetLanguage
      && pendingPointer.translationLanguage === translationLanguage) {
      navigateLesson('session');
      return;
    }
    if (!plan) { void continueReview(); return; }
    const languagePair = { targetLanguage, translationLanguage };
    const pendingFreshPriority = owner ? readPendingFreshPriority(owner, languagePair) : [];
    const sessionPlan = pendingFreshPriority.length > 0
      ? buildDailyPlan(currentPairCards, { now: new Date(), freshPriorityLogicalIds: pendingFreshPriority })
      : plan;
    const stagePlan = withFreshPriority(buildSessionStagePlan(sessionPlan, activePool.cards, Math.random, {
      targetLanguage,
      translationLanguage,
    }), pendingFreshPriority);
    const first = firstOutstandingStage(stagePlan);
    if (first === 'recap') { void continueReview(); return; }
    const state: MultiStageState = {
      ownerId: owner,
      targetLanguage,
      translationLanguage,
      stagePlan,
      stats: emptyDailySessionStats,
      startedAt: new Date().toISOString(),
      matchStartOpId: null,
      matchCompletionId: null,
      matchCompletionPending: false,
      matchStatus: 'idle',
      phase: phaseForStage(first),
    };
    if (state.phase.kind === 'lesson') startStageExercises(itemsForStage(stagePlan, state.phase.stage));
    setMultiStage(state);
    navigateLesson('session');
    if (owner && pendingFreshPriority.length > 0) consumeScheduledFreshPriority(owner, languagePair, [
      ...logicalIdsOf(stagePlan.review), ...logicalIdsOf(stagePlan.fresh),
    ]);
    triggerHaptic('light'); // Today → review/new: a light cue for the session starting, not a fanfare.
  }, [plan, activePool.cards, continueReview, currentPairCards, isOffline, startStageExercises, navigateLesson, targetLanguage, translationLanguage]);

  const advanceMultiStage = useCallback((completedStage: SessionStageId) => {
    setMultiStage(current => {
      if (!current) return current;
      const nextStage = nextOutstandingStage(current.stagePlan, completedStage);
      return { ...current, phase: { kind: 'bridge', completedStage, nextStage } };
    });
    // review/new → bridge: a stage just finished, so this is stronger than plain navigation.
    // The session-finale fanfare (sound + haptic) lives in SessionRecapModal instead, so it
    // only fires once, exactly when the learner reaches the actual end of the session.
    triggerHaptic('success');
  }, []);

  const continueToNextStage = useCallback(() => {
    const current = multiStageRef.current;
    if (!isCurrentSession(current) || current.phase.kind !== 'bridge') return;
    const { nextStage } = current.phase;
    if (nextStage === 'review' || nextStage === 'new') startStageExercises(itemsForStage(current.stagePlan, nextStage));
    setMultiStage({
      ...current,
      phase: phaseForStage(nextStage),
    });
    triggerHaptic('light'); // bridge → next stage/recap: forward navigation cue.
  }, [isCurrentSession, startStageExercises]);

  const skipUpcomingStage = useCallback(() => {
    setMultiStage(current => (isCurrentSession(current) && current.phase.kind === 'bridge'
      ? { ...current, phase: { kind: 'recap' } }
      : current));
    triggerHaptic('light'); // bridge → recap (skip): same forward-navigation cue as Continue.
  }, [isCurrentSession]);

  const finishMatchStage = useCallback(() => {
    const current = multiStageRef.current;
    if (current?.phase.kind === 'match' && current.matchCompletionPending) {
      if (current.matchStatus !== 'completing') { setMultiStage(null); navigateLesson(null); }
      return;
    }
    setMultiStage(current => (isCurrentSession(current)
      ? { ...current, phase: { kind: 'recap' } }
      : current));
    triggerHaptic('light'); // match → recap: WordMatchView already celebrated a win itself.
  }, [isCurrentSession, navigateLesson]);

  const retryWeakCards = useCallback(() => {
    const current = multiStageRef.current;
    if (!isCurrentSession(current)) return;
    const weakIds = new Set(current.stats.weakCardIds);
    const items: DailyPlanItem[] = dailyCardsRef.current
      .filter(card => weakIds.has(card.id))
      .map(card => ({ card, logicalId: logicalIdentity(card), reason: 'weak' as const }));
    if (!items.length) { finishMultiStageSession(); return; }
    startStageExercises(items);
    setMultiStage({
      ...current,
      stagePlan: { ...current.stagePlan, review: items },
      stats: { ...current.stats, weakCardIds: [] },
      phase: { kind: 'lesson', stage: 'review' },
    });
  }, [finishMultiStageSession, isCurrentSession, startStageExercises]);

  const startRecommended = useCallback(() => {
    const launch = launchTodayAdaptiveLesson(recommendation);
    if (launch) startLesson(launch.mode, true, launch.allowListenPilot, launch.maximumActivities);
  }, [recommendation, startLesson]);

  const saveListenPhrase = useCallback(async (chunk: ListenMvpLessonV1['chunk']) => {
    const expectedOwnerSession = listenOwnerSession;
    const expectedListenScope = listenScope;
    if (listenOwnerSessionRef.current !== expectedOwnerSession) {
      throw new Error('The listening save belongs to an earlier learner session.');
    }
    if (listenScopeRef.current !== expectedListenScope) {
      throw new Error('The listening save belongs to an earlier listening clip.');
    }
    if (!adoptCatalogCards) throw new Error('Phrase saving is unavailable in this workspace.');
    const resolvedCards = await adoptListenPhraseCard(chunk, adoptCatalogCards);
    if (
      listenOwnerSessionRef.current !== expectedOwnerSession
      || listenScopeRef.current !== expectedListenScope
    ) {
      throw new Error('The listening save belongs to an earlier learner session.');
    }
    setListenResolvedCards({
      scopeKey: expectedListenScope.scopeKey,
      generation: expectedListenScope.generation,
      cards: resolvedCards,
    });
  }, [adoptCatalogCards, listenOwnerSession, listenScope]);

  useEffect(() => {
    if (!routeLesson || routeLesson === 'placement' || routeLesson === 'session' || lesson || !plan?.items.length) return;
    if (routeLesson === 'listening' && LISTEN_MVP_PILOT_LESSONS.length > 0) return;
    startLesson(routeLesson, false);
  }, [lesson, plan, routeLesson, startLesson]);

  useEffect(() => {
    if (routeLesson !== 'session' || multiStage || lesson || activePool.status !== 'ready' || !ownerRef.current) return;
    const pointer = readDailySessionPointer(ownerRef.current);
    // A pointer from another course's target language must never resume:
    // its reviewLogicalIds/freshLogicalIds/matchCardIds were computed
    // against that other course's cards.
    if (!pointer || pointer.targetLanguage !== targetLanguage || pointer.translationLanguage !== translationLanguage) { navigateLesson(null); return; }
    const now = new Date();
    const freshPlan = buildDailyPlan(currentPairCards, { now, freshPriorityLogicalIds: pointer.freshLogicalIds });
    const stagePlan: SessionStagePlan = {
      review: outstandingItems(pointer.reviewLogicalIds, freshPlan.items.filter(item => item.reason === 'due' || item.reason === 'weak')),
      fresh: freshItemsForResume(pointer.freshLogicalIds, currentPairCards, now),
      match: restoredSessionMatchStage(activePool.cards, pointer.matchCardIds, { targetLanguage, translationLanguage }, Boolean(pointer.matchStartOpId)),
    };
    const resumeStage = pointer.bridgeCompletedStage || sessionStageItemCount(stagePlan, pointer.stage) === 0
      ? nextOutstandingStage(stagePlan, pointer.bridgeCompletedStage ?? pointer.stage)
      : pointer.stage;
    const phase: MultiStagePhase = pointer.bridgeCompletedStage
      ? { kind: 'bridge', completedStage: pointer.bridgeCompletedStage, nextStage: resumeStage }
      : phaseForStage(resumeStage);
    if (phase.kind === 'lesson') startStageExercises(itemsForStage(stagePlan, phase.stage));
    setMultiStage({
      ownerId: ownerRef.current, targetLanguage, translationLanguage, stagePlan, stats: pointer.stats, startedAt: pointer.startedAt, phase,
      matchStartOpId: pointer.matchStartOpId ?? null, matchCompletionId: pointer.matchCompletionId ?? null,
      ...(pointer.matchTimeZone ? { matchTimeZone: pointer.matchTimeZone } : {}),
      matchCompletionPending: pointer.matchCompletionPending ?? false, matchStatus: 'idle',
    });
  }, [routeLesson, multiStage, lesson, activePool, currentPairCards, navigateLesson, startStageExercises, targetLanguage, translationLanguage]);

  const activeMultiStage = isCurrentSession(multiStage) ? multiStage : null;

  useEffect(() => {
    if (!activeMultiStage || activeMultiStage.phase.kind !== 'match' || activeMultiStage.matchStatus !== 'idle') return;
    if (isOffline) {
      updateCurrentMatch(current => ({ ...current, matchStatus: 'start-error' }), 'idle');
      return;
    }
    const matchStartOpId = activeMultiStage.matchStartOpId ?? dailyMatchOperationId('start');
    const matchCompletionId = activeMultiStage.matchCompletionId ?? dailyMatchOperationId('complete');
    const matchTimeZone = activeMultiStage.matchTimeZone ?? practiceTimeZone();
    const cardIds = activeMultiStage.stagePlan.match.cards.map(card => card.id);
    if (cardIds.length < 4 || cardIds.length > 6) { finishMatchStage(); return; }
    updateCurrentMatch(current => ({ ...current, matchStartOpId, matchCompletionId, ...(matchTimeZone ? { matchTimeZone } : {}), matchStatus: 'starting' }), 'idle');
    void firebasePracticeSessionService.start({ opId: matchStartOpId, game: 'match', cardIds }).then(started => {
      const cards = frozenMatchCards(started.challenge, cardIds, targetLanguage, translationLanguage);
      updateCurrentMatch(current => ({
        ...current, stagePlan: { ...current.stagePlan, match: { cards, skipReason: null } }, matchStatus: 'ready',
      }), undefined, matchStartOpId);
    }).catch(() => {
      updateCurrentMatch(current => ({ ...current, matchStatus: 'start-error' }), undefined, matchStartOpId);
    });
  }, [activeMultiStage, finishMatchStage, isOffline, targetLanguage, translationLanguage, updateCurrentMatch]);

  const completeDailyMatch = useCallback(async (pairs: Array<{ cardId: string; word: string; translation: string }>) => {
    const current = multiStageRef.current;
    if (!isCurrentMatch(current, 'ready') || !current.matchStartOpId || !current.matchCompletionId) return null;
    const { matchStartOpId, matchCompletionId, matchTimeZone } = current;
    const pendingCompletion = preparePendingMatchCompletion(current.stagePlan.match.cards, pairs, isOffline);
    if (!pendingCompletion) return null;
    const completing: MultiStageState = { ...current, matchCompletionPending: true, matchStatus: pendingCompletion.matchStatus };
    const pointer = pointerForSession(completing);
    if (pointer) writeDailySessionPointer(pointer);
    updateCurrentMatch(() => completing, 'ready', matchStartOpId, matchCompletionId);
    if (isOffline) return null;
    try {
      const result = await firebasePracticeSessionService.complete({
        sessionId: matchStartOpId, completionId: matchCompletionId, answers: { pairs: pendingCompletion.pairs }, ...(matchTimeZone ? { timeZone: matchTimeZone } : {}),
      });
      const latest = multiStageRef.current;
      if (!isCurrentMatch(latest, undefined, matchStartOpId, matchCompletionId)) return null;
      if (latest.ownerId) onVerifiedPracticeOutcome(result.outcome, matchCompletionId, latest.ownerId);
      updateCurrentMatch(state => ({
        ...state, stats: { ...state.stats, matchXp: state.stats.matchXp + result.awardedXp }, phase: { kind: 'recap' }, matchCompletionPending: false, matchStatus: 'ready',
      }), 'completing', matchStartOpId, matchCompletionId);
      return { awardedXp: result.awardedXp };
    } catch {
      updateCurrentMatch(state => ({ ...state, matchStatus: 'complete-error' }), 'completing', matchStartOpId, matchCompletionId);
      return null;
    }
  }, [isCurrentMatch, isOffline, onVerifiedPracticeOutcome, updateCurrentMatch]);

  useEffect(() => {
    if (activeMultiStage?.phase.kind === 'match' && activeMultiStage.matchStatus === 'ready' && activeMultiStage.matchCompletionPending) {
      const cards = activeMultiStage.stagePlan.match.cards;
      void completeDailyMatch(cards.map(card => ({ cardId: card.id, word: card.word, translation: card.translation })));
    }
  }, [activeMultiStage, completeDailyMatch]);

  const lessonScope = lessonScopeRef.current;
  const activeLesson = lessonScope.ownerId === ownerId && lessonScope.targetLanguage === targetLanguage && lessonScope.translationLanguage === translationLanguage && (!multiStage || activeMultiStage) ? lesson : null;
  const currentStep = activeLesson ? currentLessonStep(activeLesson) : undefined;
  const currentExercise = currentStep?.exercise ?? activeLesson?.exercises[activeLesson.index]
    ?? (activeLesson?.phase === 'completed' ? activeLesson.exercises.at(-1) : undefined);
  useEffect(() => { cancelLessonAudio(); }, [cancelLessonAudio, currentExercise?.cardId]);
  const currentCard = currentExercise && dailyCardsRef.current.find(card => card.id === currentExercise.cardId);
  const committedReviewCount = activeMultiStage ? activeMultiStage.stats.goodCount + activeMultiStage.stats.againCount : 0;

  if (activeMultiStage?.phase.kind === 'bridge') {
    const { completedStage, nextStage } = activeMultiStage.phase;
    const stageLabel = (id: SessionStageId) => _(sessionStageContent[id].label);
    const nextCount = sessionStageItemCount(activeMultiStage.stagePlan, nextStage);
    const stats: SessionBridgeStat[] = committedReviewCount > 0
      ? [{ label: _(msg({ id: 'session.bridge.stat.reviewed', message: 'Reviewed' })), value: String(committedReviewCount) }]
      : [];
    const preview = nextStage === 'new' ? activeMultiStage.stagePlan.fresh[0]?.card
      : nextStage === 'match' ? activeMultiStage.stagePlan.match.cards[0] : undefined;
    const skipReason = (nextStage === 'match' || skippedUnavailableMatchStage(activeMultiStage.stagePlan, completedStage, nextStage))
      && activeMultiStage.stagePlan.match.skipReason
      ? _(msg({ id: 'session.stage.match.skip-reason', message: 'Not enough distinct word pairs are available today, so Word Match is skipped.' }))
      : undefined;
    const model: SessionBridgeModel = {
      headingRef,
      completedStage,
      nextStage,
      completedLabel: i18n._(msg({ id: 'session.bridge.completed', message: '{stage} done' }).id, { stage: stageLabel(completedStage) }),
      nextLabel: stageLabel(nextStage),
      nextDescription: _(sessionStageContent[nextStage].description),
      stats,
      comboCount: committedReviewCount,
      stages: SESSION_STAGE_ORDER.map(id => ({
        id, label: stageLabel(id),
        completed: SESSION_STAGE_ORDER.indexOf(id) <= SESSION_STAGE_ORDER.indexOf(completedStage),
        current: id === nextStage,
      })),
      ...(preview ? { previewCard: { word: preview.word, translation: preview.translation, phonetic: preview.phonetic, category: preview.category, language: preview.language ?? targetLanguage } } : {}),
      ...(skipReason ? { skipReason } : {}),
      canSkipNextStage: nextStage === 'match' && nextCount > 0,
      liveMessage: skipReason ?? (nextStage === 'recap'
        ? _(msg({ id: 'session.bridge.live-recap', message: 'This session is complete.' }))
        : i18n._(msg({ id: 'session.bridge.live-next', message: '{count, plural, one {# item} other {# items}} next.' }).id, { count: nextCount })),
    };
    return <Suspense fallback={interactionFallback}><SessionBridge model={model} actions={{
      continue: continueToNextStage, skip: skipUpcomingStage, exit: exitMultiStageSession,
    }} /></Suspense>;
  }

  if (activeMultiStage?.phase.kind === 'match' && activeMultiStage.matchStatus === 'ready' && !activeMultiStage.matchCompletionPending) {
    return <div data-active-daily-match="true"><Suspense fallback={interactionFallback}><WordMatchView
      cards={[...activeMultiStage.stagePlan.match.cards]}
      onComplete={completeDailyMatch}
      onClose={finishMatchStage}
    /></Suspense></div>;
  }

  if (activeMultiStage?.phase.kind === 'match') {
    const retryMatchStart = () => updateCurrentMatch(current => ({ ...current, matchStatus: 'idle' }), 'start-error');
    const retryMatchCompletion = () => updateCurrentMatch(current => ({ ...current, matchStatus: 'ready' }), 'complete-error');
    const completionFailed = activeMultiStage.matchStatus === 'complete-error';
    const matchFailed = activeMultiStage.matchStatus === 'start-error' || completionFailed;
    const hasRetainedCompletion = completionFailed || activeMultiStage.matchCompletionPending;
    return <div data-active-daily-match="true" role="status" className="rounded-2xl border border-[var(--sf-border)] p-5">
      {matchFailed ? <>
        <p>{isOffline
          ? <Trans {...msg({ id: 'today.offline', message: 'You\'re offline. Reconnect to start today\'s session.' })} />
          : completionFailed
            ? <Trans {...msg({ context: 'today.match.verification-failed', message: 'We could not verify your result. Your completed pairs are still here.' })} />
            : <Trans {...msg({ context: 'today.match.start-failed', message: 'Word Match could not start. Your completed reviews are saved.' })} />}</p>
        <button type="button" onClick={completionFailed ? retryMatchCompletion : retryMatchStart}>{completionFailed
          ? <Trans {...msg({ context: 'today.match.retry-verification', message: 'Retry verification' })} />
          : <Trans {...msg({ id: 'daily.placement.retry', message: 'Try again' })} />}</button>
        <button type="button" onClick={hasRetainedCompletion ? finishMatchStage : exitMultiStageSession}><Trans {...msg({ id: 'daily.lesson.back-to-today', message: 'Back to Today' })} /></button>
        {hasRetainedCompletion && <button type="button" onClick={exitMultiStageSession}><Trans {...msg({ context: 'today.match.abandon', message: 'Abandon round and start over' })} /></button>}
      </> : <Trans {...msg({ context: 'today.activity.preparing', message: 'Preparing activity…' })} />}
    </div>;
  }

  if (listenPilotLesson) {
    const canSaveListenPhrase = Boolean(adoptCatalogCards && listenPhraseForChunk(listenPilotLesson.chunk));
    return (
      <section className="mx-auto w-full max-w-4xl space-y-4" aria-labelledby="listen-pilot-heading">
        <div className="flex items-center justify-between gap-3">
          <h1 id="listen-pilot-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-black tracking-tight"><Trans {...msg({ context: 'daily-learning-workspace.immerse-listen', message: 'Immerse · Listen' })} /></h1>
          <button type="button" onClick={() => navigateLesson(null)} className="min-h-11 rounded-full border border-[var(--sf-border)] px-4 py-2 text-sm font-bold focus-visible:outline-2"><Trans {...msg({ context: 'daily-learning-workspace.back-to-today', message: 'Back to Today' })} /></button>
        </div>
        <Suspense fallback={interactionFallback}>
          <PublishedListenMvp
            key={`${ownerId ?? 'guest'}:${listenPilotLesson.clip.id}`}
            lesson={listenPilotLesson}
            ownerId={ownerId}
            onEvidence={recordListenEvidenceAndRefresh}
            onSaveChunk={canSaveListenPhrase ? saveListenPhrase : undefined}
            resolvedCards={activeListenResolvedCards ?? undefined}
            onPracticePhrase={onPracticePhrase
              ? (cards, opener) => onPracticePhrase({
                ownerId,
                clipId: listenPilotLesson.clip.id,
                generation: listenScope.generation,
                cards,
                opener,
              })
              : undefined}
          />
        </Suspense>
      </section>
    );
  }
  if (routeLesson === 'placement') {
    const check = placementCheck ?? availablePlacement;
    const readyCheck = check.status === 'ready' ? check : null;
    const item = readyCheck?.items[placementIndex];
    const question = item ? buildExercise(item.card, currentPairCards, 'recognition') : null;
    let model: PlacementScreenModel;
    if (activePool.status === 'loading') model = { headingRef, status: 'loading', message: _(msg({ id: 'today.placement.preparing', message: 'Preparing placement evidence…' })) };
    else if (activePool.status === 'error') model = { headingRef, status: 'error', message: activePool.error };
    else if (check.status === 'insufficient') model = {
      headingRef, status: 'insufficient', message: _(msg({ id: 'today.placement.insufficient', message: 'At least 6 unique words with CEFR evidence and answer choices are required.' })),
      eligibleCount: check.eligibleCount, requiredCount: check.requiredCount,
    };
    else if (placementResult?.status === 'complete') model = {
      headingRef, status: 'result', message: _(msg({ id: 'today.placement.result', message: 'Your answers suggest starting here.' })),
      recommendation: placementResult.recommendation,
      recommendationLabel: placementResult.recommendation === 'foundation' ? _(msg({ id: 'today.placement.foundation', message: 'Foundation' }))
        : placementResult.recommendation === 'core' ? _(msg({ id: 'today.placement.core', message: 'Core' }))
          : _(msg({ id: 'today.placement.advanced', message: 'Advanced' })),
      confidence: placementResult.confidence, answeredCount: placementResult.answeredCount,
      correctCount: placementResult.correctCount,
    };
    else if (placementIndex < 0 || !item || question?.mode !== 'recognition') model = {
      headingRef, status: 'intro', message: _(msg({ id: 'today.placement.intro', message: 'Check your current vocabulary evidence in 6–12 questions.' })),
      eligibleCount: readyCheck?.items.length ?? 0,
    };
    else model = {
      headingRef, status: 'question', message: i18n._(msg({ id: 'today.question.progress', message: 'Question {current} of {total}.' }).id, { current: placementIndex + 1, total: readyCheck.items.length }),
      current: placementIndex + 1, total: readyCheck.items.length, prompt: question.prompt,
      promptLanguage: promptLanguageFor(question, item.card, i18n.locale), selectedId: placementChoice,
      options: question.options.map(option => ({ id: option, label: option, language: item.card.translationLanguage || 'vi' })),
    };
    return <Suspense fallback={interactionFallback}><PlacementScreen model={model} actions={{
      start: () => { setPlacementCheck(availablePlacement); setPlacementIndex(0); setPlacementChoice(null); setPlacementAnswers({}); setPlacementResult(null); setHeadingFocusIntent(intent => intent + 1); },
      chooseAnswer: setPlacementChoice,
      submitAnswer: () => {
        if (!readyCheck || !item || !placementChoice || question?.mode !== 'recognition') return;
        const answers = { ...placementAnswers, [item.card.id]: placementChoice === question.answer };
        setPlacementAnswers(answers);
        if (placementIndex + 1 >= readyCheck.items.length) setPlacementResult(evaluatePlacement(readyCheck, answers));
        else { setPlacementIndex(index => index + 1); setPlacementChoice(null); }
        setHeadingFocusIntent(intent => intent + 1);
      },
      retry: () => void load(), openPaths,
      exit: () => { setPlacementIndex(-1); setPlacementResult(null); navigateLesson(null); },
    }} /></Suspense>;
  }

  if (activeLesson && currentExercise) {
    const isCurrentLessonScope = () => lessonScopeRef.current === lessonScope
      && lessonScope.ownerId === ownerRef.current
      && lessonScope.targetLanguage === targetLanguageRef.current
      && lessonScope.translationLanguage === translationLanguageRef.current;
    const recordReview = (result: Awaited<ReturnType<typeof session.rate>>, operationId: string | undefined, cardId: string, rating: ReviewRatingValue) => {
      if (!operationId || recordedReviewOperationIdsRef.current.has(operationId) || !isCurrentLessonScope() || (result.status !== 'advanced' && result.status !== 'completed')) return;
      recordedReviewOperationIdsRef.current.add(operationId);
      setMultiStage(current => (isCurrentSession(current)
        ? { ...current, stats: applyRatingToStats(current.stats, cardId, rating, result.xpAwarded) }
        : current));
    };
    const feedback = activeLesson.feedback;
    const stage = currentStep?.stage ?? 'review';
    const scoredSteps = activeLesson.steps.filter(step => step.stage === 'review' || step.stage === 'independent-recall');
    const completedScoredSteps = activeLesson.steps
      .slice(0, activeLesson.index + 1)
      .filter(step => step.stage === 'review' || step.stage === 'independent-recall').length;
    const status = activeLesson.phase === 'persisting' ? 'rating-saving'
      : activeLesson.phase === 'sync-pending' ? 'rating-sync-pending'
      : activeLesson.phase === 'save-error' ? 'rating-error'
        : activeLesson.phase === 'completed' ? 'complete'
          : stage === 'introduction' ? 'introduction'
            : stage === 'guided' ? 'guided' : activeLesson.phase;
    const model: LessonScreenModel = {
      headingRef,
      status,
      mode: currentExercise.mode,
      modeLabel: stage === 'introduction' ? 'Introduction' : stage === 'guided' ? 'Guided practice' : stage === 'independent-recall' ? 'Independent recall' : modeLabels[currentExercise.mode],
      progress: { current: activeLesson.phase === 'completed' ? scoredSteps.length : Math.max(1, completedScoredSteps), total: Math.max(1, scoredSteps.length) },
      prompt: promptFor(currentExercise, currentCard),
      promptLanguage: promptLanguageFor(currentExercise, currentCard, i18n.locale),
      answer: answerPresentation(currentExercise, answer, tokenIds, currentCard, instructionFor(currentExercise)),
      ...(currentStep?.card ? { card: {
        word: currentStep.card.word,
        language: currentStep.card.language, translationLanguage: currentStep.card.translationLanguage,
        translation: currentStep.card.translation,
        explanation: currentStep.card.explanation,
        phonetic: currentStep.card.phonetic,
        exampleSentence: currentStep.card.exampleSentence,
        exampleTranslation: currentStep.card.exampleTranslation,
        audioUrl: currentStep.card.audioUrl,
      } } : {}),
      canSubmit: stage !== 'introduction' && stage !== 'guided' && (currentExercise.mode === 'sentence-building'
        ? tokenIds.length === currentExercise.answerTokens.length : answer.trim().length > 0),
      canPlayAudio: currentExercise.mode === 'listening' && Boolean(currentExercise.audioUrl),
      ...(audioError ? { audioErrorMessage: audioError } : {}),
      ...(feedback ? { feedback: {
        outcome: feedback.correct ? 'correct' : 'incorrect',
        message: feedback.correct ? _(msg({ id: 'today.answer.correct', message: 'Correct.' })) : _(msg({ id: 'today.answer.incorrect', message: 'Not quite.' })),
        expectedAnswer: expectedAnswer(currentExercise),
        answerLanguage: currentExercise.mode === 'recognition' ? currentCard?.translationLanguage || 'vi' : currentCard?.language || 'en',
        explanation: currentExercise.mode === 'active-recall' && currentExercise.fallbackFrom
          ? i18n._(msg({ id: 'today.lesson.fallback', message: '{mode} was unavailable for this card, so active recall was used.' }).id, { mode: modeLabels[currentExercise.fallbackFrom] }) : undefined,
      } } : {}),
        ...(activeLesson.error ? { errorMessage: `${activeLesson.error} This question is still open.` } : {}),
        ...(activeLesson.syncPendingReviewCount > 0 ? { syncPendingReviewCount: activeLesson.syncPendingReviewCount } : {}),
      liveMessage: activeLesson.phase === 'sync-pending' ? 'Review saved on this device and waiting to sync.'
        : activeLesson.phase === 'introduction' ? 'Learn this word before recalling it.'
        : activeLesson.phase === 'answering' && stage === 'guided' ? 'Review the word, then continue to independent recall.'
          : activeLesson.phase === 'feedback' ? 'Review the answer, then rate your recall.'
        : activeLesson.phase === 'completed' ? 'Your daily lesson is complete.'
          : `Question ${Math.max(1, completedScoredSteps)} of ${Math.max(1, scoredSteps.length)}.`,
    };
    return <Suspense fallback={interactionFallback}><LessonScreen model={model} actions={{
      chooseAnswer: setAnswer,
      changeTextAnswer: setAnswer,
      toggleSentenceToken: id => setTokenIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]),
      playAudio: () => {
        cancelLessonAudio();
        setAudioError(null);
        if (currentExercise.mode === 'listening' && currentExercise.audioUrl) {
          const audio = new Audio(currentExercise.audioUrl);
          const generation = lessonAudioGenerationRef.current;
          lessonAudioRef.current = audio;
          void audio.play().catch(() => {
            if (lessonAudioGenerationRef.current === generation && lessonAudioRef.current === audio) {
              setAudioError('Audio could not be played. Check your connection or exit and use Active recall.');
            }
          });
        }
      },
      submitAnswer: () => { session.submit(answerFor(currentExercise, answer, tokenIds)); },
      chooseIntroduction: choice => { cancelLessonAudio(); session.chooseIntroduction(choice); },
      continueGuided: () => { cancelLessonAudio(); session.continueGuided(); },
      requestGuidance: () => {
        if (session.requestGuidance()) {
          cancelLessonAudio();
          setAnswer('');
          setTokenIds([]);
        }
      },
      rate: rating => {
        if (!isCurrentLessonScope()) return;
        const cardId = currentExercise.cardId;
        const rate = session.rate(rating);
        const operationId = session.getSnapshot()?.pendingReview?.operationId;
        void rate.then(result => recordReview(result, operationId, cardId, rating));
      },
      retryRating: () => {
        if (!isCurrentLessonScope()) return;
        const pending = session.getSnapshot()?.pendingReview;
        if (!pending) return;
        void session.retry().then(result => recordReview(result, pending.operationId, pending.itemId, pending.rating));
      },
      exit: () => {
        session.close();
        if (multiStage) { exitMultiStageSession(); return; }
        navigateLesson(null);
      },
      finish: () => {
        session.close();
        if (multiStage && multiStage.phase.kind === 'lesson') { advanceMultiStage(multiStage.phase.stage); return; }
        navigateLesson(null);
        void load();
      },
    }} /></Suspense>;
  }

  const weakCards: CardData[] = activeMultiStage
    ? activeMultiStage.stats.weakCardIds.flatMap(id => {
        const card = dailyCardsRef.current.find(candidate => candidate.id === id);
        return card ? [card] : [];
      })
    : [];
  const sessionTotalCards = committedReviewCount;
  const sessionXpEarned = activeMultiStage
    ? (activeMultiStage.stats.reviewXp ?? 0) + activeMultiStage.stats.matchXp
    : 0;
  const todayStagePlan = plan
    ? buildSessionStagePlan(plan, activePool.cards, () => 0, { targetLanguage, translationLanguage })
    : null;
  const todayPreviewCard = plan?.items[0]?.card ?? (matchOnlySession ? todayStagePlan?.match.cards[0] : undefined);

  const todayModel: TodayScreenModel = {
    headingRef,
    streak: evidencedStudyStreak(streak, studyXpHistory, undefined, rewardTimeZone),
    courseLabel: `${courseLanguageNames.of(languageProfile.source.code) || languageProfile.source.displayName} ← ${courseLanguageNames.of(languageProfile.target.code) || languageProfile.target.displayName}`,
    status: dailyTodayStatus(activePool.status, plan, currentPairCards.length > 0, matchOnlySession, isOffline),
    isOffline,
    message: activePool.status === 'loading' ? _(msg({ id: 'today.plan.preparing', message: 'Preparing a bounded daily plan…' }))
      : activePool.status === 'error' ? activePool.error
        : caughtUp ? _(msg({ id: 'today.plan.caught-up', message: 'No due or new cards are available in this daily plan.' }))
          : !plan?.items.length && !matchOnlySession ? _(msg({ id: 'today.plan.empty', message: 'Add vocabulary or return when a reviewed card is due.' }))
            : plan?.isShort ? _(msg({ id: 'today.plan.short', message: 'A shorter plan is ready.' })) : _(msg({ id: 'today.plan.ready', message: 'Your plan is ready.' })),
    plan: plan ? { total: plan.counts.total, due: plan.counts.due, weak: plan.counts.weak, fresh: plan.counts.new, isShort: plan.isShort } : null,
    ...(todayPreviewCard ? { previewCard: {
      word: todayPreviewCard.word,
      translation: todayPreviewCard.translation,
      ...(todayPreviewCard.phonetic ? { phonetic: todayPreviewCard.phonetic } : {}),
      ...(todayPreviewCard.category ? { category: todayPreviewCard.category } : {}),
      imageUrl: todayPreviewCard.imageUrl ?? null,
      ...(todayPreviewCard.language ? { language: todayPreviewCard.language } : {}),
      ...(todayPreviewCard.translationLanguage ? { translationLanguage: todayPreviewCard.translationLanguage } : {}),
    } } : {}),
    ...(todayStagePlan ? { sessionStages: [
      { id: 'review' as const, count: todayStagePlan.review.length, skipped: todayStagePlan.review.length === 0 },
      { id: 'new' as const, count: todayStagePlan.fresh.length, skipped: todayStagePlan.fresh.length === 0 },
      { id: 'match' as const, count: todayStagePlan.match.cards.length, skipped: todayStagePlan.match.skipReason !== null },
      { id: 'recap' as const, count: 0, skipped: false },
    ] } : {}),
    placementAvailable: availablePlacement.status === 'ready',
    ...(recommendation ? {
      recommendation: {
        activityId: recommendation.activityId,
        mode: recommendation.mode,
        reason: recommendation.reason.label,
      },
    } : {}),
    listenPilotAvailable: LISTEN_MVP_PILOT_LESSONS.length > 0,
    ...(caughtUp
      ? { caughtUp: {} }
      : {}),
  };
  return <>
    <TodayScreen model={todayModel} ownerId={ownerId} targetLanguage={targetLanguage} translationLanguage={translationLanguage} actions={{
      openVocabulary, openPaths, retry: () => void load(), continueReview: () => void continueReview(), startDailyPlan: target => startLesson('recognition', true, true, target), startRecommended, startSession: beginMultiStageSession, startLesson,
      startPlacement: () => navigateLesson('placement'), openMorePractice,
    }} />
    {activeMultiStage?.phase.kind === 'recap' && (
      <Suspense fallback={null}>
        <SessionRecapModal
          open
          onClose={finishMultiStageSession}
          onViewWeeklyRecap={() => { finishMultiStageSession(false); openWeeklyRecap(); }}
          {...(weakCards.length > 0 ? { onRetryWeak: retryWeakCards } : {})}
          totalCards={sessionTotalCards}
          goodCount={activeMultiStage.stats.goodCount}
          againCount={activeMultiStage.stats.againCount}
          xpEarned={sessionXpEarned}
          weakCards={weakCards}
          targetLanguage={targetLanguage}
        />
      </Suspense>
    )}
  </>;
}

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import type { CardData, ReviewRatingValue } from '../../types/card';
import type { LearningStateOutcome } from '../learning/learningStateController';
import type { LanguageProfile } from '../language/languageProfile';
import { triggerHaptic } from '../../lib/haptics';
import { REVIEW_XP } from '../../lib/review-xp';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import { buildDailyPlan, logicalIdentity, type DailyPlan, type DailyPlanItem } from './dailyPlan';
import { createDailyPracticePoolRuntime } from './dailyPracticePoolRuntime';
import { createDailySessionController } from './dailySessionController';
import { readDailyLearningUrlState, type DailyLessonMode } from './dailyLearningUrl';
import {
  buildExercise,
  getEligibleExerciseModes,
  type Exercise,
  type ExerciseAnswer,
  type ExerciseMode,
} from './exerciseEngine';
import { buildPlacementCheck, evaluatePlacement, type PlacementCheck, type PlacementResult } from './placementEngine';
import { inferScriptScoringPolicy } from './scriptScoring';
import { TodayScreen } from './TodayScreen';
import {
  buildSessionStagePlan,
  clearDailySessionPointer,
  clearPendingFreshPriority,
  emptyDailySessionStats,
  applyRatingToStats,
  firstOutstandingStage,
  logicalIdsOf,
  nextOutstandingStage,
  outstandingItems,
  readDailySessionPointer,
  readPendingFreshPriority,
  SESSION_STAGE_ORDER,
  writeDailySessionPointer,
  type DailySessionStats,
  type SessionStageId,
  type SessionStagePlan,
} from './dailySessionStages';
import type {
  LessonAnswerPresentation,
  LessonMode,
  LessonScreenModel,
  PlacementScreenModel,
  SessionBridgeModel,
  SessionBridgeStat,
  TodayScreenModel,
} from './dailyLearningPresentation';
import { evidencedStudyStreak } from './dailyLearningPresentation';

const LessonScreen = lazy(() => import('./LessonScreen').then(module => ({ default: module.LessonScreen })));
const PlacementScreen = lazy(() => import('./PlacementScreen').then(module => ({ default: module.PlacementScreen })));
const SessionBridge = lazy(() => import('./SessionBridge').then(module => ({ default: module.SessionBridge })));
const WordMatchView = lazy(() => import('../practice/WordMatchView').then(module => ({ default: module.WordMatchView })));
const SessionRecapModal = lazy(() => Promise.all([
  import('../practice/SessionRecapModal'), loadCatalog(getActiveUiLocale(), 'practice'),
]).then(([module]) => ({ default: module.SessionRecapModal })));
const interactionFallback = <div role="status" className="rounded-2xl border border-[var(--sf-border)] p-5"><Trans id="today.activity.preparing" message="Preparing activity…" /></div>;

/** Sequenced session phases: a review/new lesson reuses the single-lesson controller and screen; bridge/match/recap are their own screens. */
type MultiStagePhase =
  | { readonly kind: 'lesson'; readonly stage: 'review' | 'new' }
  | { readonly kind: 'bridge'; readonly completedStage: SessionStageId; readonly nextStage: SessionStageId }
  | { readonly kind: 'match' }
  | { readonly kind: 'recap' };

interface MultiStageState {
  readonly stagePlan: SessionStagePlan;
  readonly phase: MultiStagePhase;
  readonly stats: DailySessionStats;
  readonly startedAt: string;
}

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
  readonly loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  readonly reviewCard: (cardId: string, rating: ReviewRatingValue, operationId: string, source?: CardData) => Promise<LearningStateOutcome>;
  readonly openLesson: (mode: DailyLessonMode | null) => void;
  readonly openVocabulary: () => void;
  readonly openPaths: () => void;
  readonly continueReview: () => void | Promise<void>;
  readonly openMorePractice: (opener: HTMLButtonElement) => void;
}

type PoolState =
  | { status: 'loading'; ownerId: string | null; cards: readonly CardData[]; error: null }
  | { status: 'ready'; ownerId: string | null; cards: readonly CardData[]; error: null }
  | { status: 'error'; ownerId: string | null; cards: readonly CardData[]; error: string };

const errorMessage = (error: unknown, fallback: string) => error instanceof Error && error.message.trim()
  ? error.message
  : fallback;

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
  loadPracticePool,
  reviewCard,
  openLesson,
  openVocabulary,
  openPaths,
  continueReview,
  openMorePractice,
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
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  const poolLoadRef = useRef(loadPracticePool);
  poolLoadRef.current = loadPracticePool;
  const lastPoolLoaderRef = useRef(loadPracticePool);
  const reviewRef = useRef(reviewCard);
  reviewRef.current = reviewCard;
  const dailyCardsRef = useRef<readonly CardData[]>([]);
  const lessonOwnerRef = useRef(ownerId);
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
  const [pool, setPool] = useState<PoolState>({ status: 'loading', ownerId, cards: [], error: null });
  const [lesson, setLesson] = useState(session.getSnapshot());
  const [routeLesson, setRouteLesson] = useState<DailyLessonMode | null>(initialLesson);
  const [multiStage, setMultiStage] = useState<MultiStageState | null>(null);
  const multiStageRef = useRef(multiStage);
  multiStageRef.current = multiStage;
  const matchXpRef = useRef(0);
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
      setHeadingFocusIntent(intent => intent + 1);
      if (!next) {
        session.close();
        if (multiStageRef.current) {
          setMultiStage(null);
          if (ownerRef.current) clearDailySessionPointer(ownerRef.current);
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [session]);
  useEffect(() => {
    poolRuntime.ownerChanged();
    session.close();
    dailyCardsRef.current = [];
    setPool({ status: 'loading', ownerId, cards: [], error: null });
    setPlacementCheck(null);
    setPlacementIndex(-1);
    setPlacementChoice(null);
    setPlacementAnswers({});
    setPlacementResult(null);
    setMultiStage(null);
    void load();
    // Runs on a course switch too (targetLanguage in deps): a stale pool or
    // multi-stage session from another course's target language must never
    // survive into the newly active one.
  }, [load, ownerId, poolRuntime, session, targetLanguage]);
  useEffect(() => {
    if (lastPoolLoaderRef.current === loadPracticePool) return;
    lastPoolLoaderRef.current = loadPracticePool;
    if (!session.getSnapshot()) void load();
  }, [load, loadPracticePool, session]);
  useEffect(() => { setAnswer(''); setTokenIds([]); setAudioError(null); }, [lesson?.index]);
  useEffect(() => {
    if (!multiStage || !ownerRef.current) return;
    writeDailySessionPointer({
      ownerId: ownerRef.current,
      targetLanguage,
      stage: multiStage.phase.kind === 'lesson' ? multiStage.phase.stage
        : multiStage.phase.kind === 'bridge' ? multiStage.phase.nextStage
          : multiStage.phase.kind === 'match' ? 'match' : 'recap',
      reviewLogicalIds: logicalIdsOf(multiStage.stagePlan.review),
      freshLogicalIds: logicalIdsOf(multiStage.stagePlan.fresh),
      matchCardIds: multiStage.stagePlan.match.cards.map(card => card.id),
      matchSkipReason: multiStage.stagePlan.match.skipReason,
      stats: multiStage.stats,
      startedAt: multiStage.startedAt,
    });
  }, [multiStage, targetLanguage]);

  const activePool: PoolState = pool.ownerId === ownerId ? pool : { status: 'loading', ownerId, cards: [], error: null };
  const plan: DailyPlan | null = useMemo(() => activePool.status === 'ready'
    ? buildDailyPlan(activePool.cards, { now: new Date() })
    : null, [activePool]);
  const placementCandidates = useMemo(() => activePool.cards.filter(card => (
    getEligibleExerciseModes(card, activePool.cards).includes('recognition')
  )), [activePool.cards]);
  const availablePlacement = useMemo(() => buildPlacementCheck(placementCandidates), [placementCandidates]);
  const navigateLesson = useCallback((mode: DailyLessonMode | null, focusDestination = true) => {
    setRouteLesson(mode);
    if (focusDestination) setHeadingFocusIntent(intent => intent + 1);
    openLesson(mode);
  }, [openLesson]);

  const startLesson = useCallback((mode: LessonMode, focusDestination = true) => {
    if (!plan?.items.length) return;
    const exercises = plan.items.map(({ card }) => buildExercise(
      card,
      activePool.cards, mode, inferScriptScoringPolicy(card.word),
    ));
    lessonOwnerRef.current = ownerRef.current;
    session.start(exercises);
    navigateLesson(mode, focusDestination);
  }, [activePool.cards, navigateLesson, plan, session]);

  const startStageExercises = useCallback((items: readonly DailyPlanItem[]) => {
    lessonOwnerRef.current = ownerRef.current;
    session.start(exercisesFor(items, activePool.cards));
  }, [activePool.cards, session]);

  const clearOwnerPointer = useCallback(() => {
    if (ownerRef.current) clearDailySessionPointer(ownerRef.current);
  }, []);

  const exitMultiStageSession = useCallback(() => {
    session.close();
    setMultiStage(null);
    clearOwnerPointer();
    navigateLesson(null);
  }, [session, clearOwnerPointer, navigateLesson]);

  const finishMultiStageSession = useCallback(() => {
    setMultiStage(null);
    clearOwnerPointer();
    navigateLesson(null);
    void load();
  }, [clearOwnerPointer, navigateLesson, load]);

  const beginMultiStageSession = useCallback(() => {
    if (!plan?.items.length) { void continueReview(); return; }
    const owner = ownerRef.current;
    const pendingFreshPriority = owner ? readPendingFreshPriority(owner) : [];
    const stagePlan = withFreshPriority(buildSessionStagePlan(plan, activePool.cards), pendingFreshPriority);
    if (owner && pendingFreshPriority.length > 0) clearPendingFreshPriority(owner);
    const first = firstOutstandingStage(stagePlan);
    if (first === 'recap') { void continueReview(); return; }
    const state: MultiStageState = {
      stagePlan,
      stats: emptyDailySessionStats,
      startedAt: new Date().toISOString(),
      phase: first === 'match' ? { kind: 'match' } : { kind: 'lesson', stage: first },
    };
    if (state.phase.kind === 'lesson') startStageExercises(itemsForStage(stagePlan, state.phase.stage));
    setMultiStage(state);
    navigateLesson('session');
    triggerHaptic('light'); // Today → review/new: a light cue for the session starting, not a fanfare.
  }, [plan, activePool.cards, continueReview, startStageExercises, navigateLesson]);

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
    if (!current || current.phase.kind !== 'bridge') return;
    const { nextStage } = current.phase;
    if (nextStage === 'review' || nextStage === 'new') startStageExercises(itemsForStage(current.stagePlan, nextStage));
    setMultiStage({
      ...current,
      phase: nextStage === 'review' || nextStage === 'new' ? { kind: 'lesson', stage: nextStage }
        : nextStage === 'match' ? { kind: 'match' } : { kind: 'recap' },
    });
    triggerHaptic('light'); // bridge → next stage/recap: forward navigation cue.
  }, [startStageExercises]);

  const skipUpcomingStage = useCallback(() => {
    setMultiStage(current => (current && current.phase.kind === 'bridge' ? { ...current, phase: { kind: 'recap' } } : current));
    triggerHaptic('light'); // bridge → recap (skip): same forward-navigation cue as Continue.
  }, []);

  const finishMatchStage = useCallback(() => {
    const awarded = matchXpRef.current;
    matchXpRef.current = 0;
    setMultiStage(current => (current
      ? { ...current, stats: { ...current.stats, matchXp: current.stats.matchXp + awarded }, phase: { kind: 'recap' } }
      : current));
    triggerHaptic('light'); // match → recap: WordMatchView already celebrated a win itself.
  }, []);

  const retryWeakCards = useCallback(() => {
    const current = multiStageRef.current;
    if (!current) return;
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
  }, [startStageExercises, finishMultiStageSession]);

  useEffect(() => {
    if (!routeLesson || routeLesson === 'placement' || routeLesson === 'session' || lesson || !plan?.items.length) return;
    startLesson(routeLesson, false);
  }, [lesson, plan, routeLesson, startLesson]);

  useEffect(() => {
    if (routeLesson !== 'session' || multiStage || lesson || activePool.status !== 'ready' || !ownerRef.current) return;
    const pointer = readDailySessionPointer(ownerRef.current);
    // A pointer from another course's target language must never resume:
    // its reviewLogicalIds/freshLogicalIds/matchCardIds were computed
    // against that other course's cards.
    if (!pointer || pointer.targetLanguage !== targetLanguage) { navigateLesson(null); return; }
    const freshPlan = plan ?? buildDailyPlan(activePool.cards, { now: new Date() });
    const stagePlan: SessionStagePlan = {
      review: outstandingItems(pointer.reviewLogicalIds, freshPlan.items.filter(item => item.reason === 'due' || item.reason === 'weak')),
      fresh: outstandingItems(pointer.freshLogicalIds, freshPlan.items.filter(item => item.reason === 'new')),
      match: {
        cards: activePool.cards.filter(card => pointer.matchCardIds.includes(card.id)),
        skipReason: pointer.matchSkipReason,
      },
    };
    const resumeStage: SessionStageId = pointer.stage === 'review' && stagePlan.review.length === 0
      ? nextOutstandingStage(stagePlan, 'review')
      : pointer.stage === 'new' && stagePlan.fresh.length === 0
        ? nextOutstandingStage(stagePlan, 'new')
        : pointer.stage;
    const phase: MultiStagePhase = resumeStage === 'match' ? { kind: 'match' }
      : resumeStage === 'recap' ? { kind: 'recap' }
        : { kind: 'lesson', stage: resumeStage };
    if (phase.kind === 'lesson') startStageExercises(itemsForStage(stagePlan, phase.stage));
    setMultiStage({ stagePlan, stats: pointer.stats, startedAt: pointer.startedAt, phase });
  }, [routeLesson, multiStage, lesson, activePool, plan, navigateLesson, startStageExercises, targetLanguage]);

  const activeLesson = lessonOwnerRef.current === ownerId ? lesson : null;
  const currentExercise = activeLesson?.exercises[activeLesson.index]
    ?? (activeLesson?.phase === 'completed' ? activeLesson.exercises.at(-1) : undefined);
  const currentCard = currentExercise && dailyCardsRef.current.find(card => card.id === currentExercise.cardId);

  if (multiStage?.phase.kind === 'bridge') {
    const { completedStage, nextStage } = multiStage.phase;
    const stageLabels: Readonly<Record<SessionStageId, string>> = {
      review: _(msg({ id: 'session.stage.review', message: 'Review' })),
      new: _(msg({ id: 'session.stage.new', message: 'New words' })),
      match: _(msg({ id: 'session.stage.match', message: 'Word match' })),
      recap: _(msg({ id: 'session.stage.recap', message: 'Recap' })),
    };
    const stageDescriptions: Readonly<Record<SessionStageId, string>> = {
      review: _(msg({ id: 'session.stage.review.description', message: 'Review the words that are due or need another pass.' })),
      new: _(msg({ id: 'session.stage.new.description', message: 'Meet a few new words for the first time.' })),
      match: _(msg({ id: 'session.stage.match.description', message: 'Match target words to their meanings for a quick bonus round.' })),
      recap: _(msg({ id: 'session.stage.recap.description', message: 'See what you strengthened today.' })),
    };
    const countFor = (stage: SessionStageId): number => stage === 'review' ? multiStage.stagePlan.review.length
      : stage === 'new' ? multiStage.stagePlan.fresh.length
        : stage === 'match' ? multiStage.stagePlan.match.cards.length : 0;
    const completedCount = countFor(completedStage);
    const nextCount = countFor(nextStage);
    const stats: SessionBridgeStat[] = completedCount > 0
      ? [{ label: _(msg({ id: 'session.bridge.stat.completed', message: 'Completed' })), value: String(completedCount) }]
      : [];
    const preview = nextStage === 'new' ? multiStage.stagePlan.fresh[0]?.card
      : nextStage === 'match' ? multiStage.stagePlan.match.cards[0] : undefined;
    const skipReason = nextStage === 'match' && multiStage.stagePlan.match.skipReason
      ? _(msg({ id: 'session.stage.match.skip-reason', message: 'Not enough distinct word pairs are available today, so Word Match is skipped.' }))
      : undefined;
    const model: SessionBridgeModel = {
      headingRef,
      completedStage,
      nextStage,
      completedLabel: i18n._(msg({ id: 'session.bridge.completed', message: '{stage} done' }).id, { stage: stageLabels[completedStage] }),
      nextLabel: stageLabels[nextStage],
      nextDescription: stageDescriptions[nextStage],
      stats,
      stages: SESSION_STAGE_ORDER.map(id => ({
        id, label: stageLabels[id],
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

  if (multiStage?.phase.kind === 'match') {
    return <Suspense fallback={interactionFallback}><WordMatchView
      cards={[...multiStage.stagePlan.match.cards]}
      onAddXp={amount => { matchXpRef.current += amount; }}
      onClose={finishMatchStage}
    /></Suspense>;
  }

  if (routeLesson === 'placement') {
    const check = placementCheck ?? availablePlacement;
    const readyCheck = check.status === 'ready' ? check : null;
    const item = readyCheck?.items[placementIndex];
    const question = item ? buildExercise(item.card, activePool.cards, 'recognition') : null;
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
    const feedback = activeLesson.feedback;
    const model: LessonScreenModel = {
      headingRef,
      status: activeLesson.phase === 'persisting' ? 'rating-saving'
        : activeLesson.phase === 'save-error' ? 'rating-error'
          : activeLesson.phase === 'completed' ? 'complete' : activeLesson.phase,
      mode: currentExercise.mode,
      modeLabel: modeLabels[currentExercise.mode],
      progress: { current: activeLesson.phase === 'completed' ? activeLesson.exercises.length : activeLesson.index + 1, total: activeLesson.exercises.length },
      prompt: promptFor(currentExercise, currentCard),
      promptLanguage: promptLanguageFor(currentExercise, currentCard, i18n.locale),
      answer: answerPresentation(currentExercise, answer, tokenIds, currentCard, instructionFor(currentExercise)),
      canSubmit: currentExercise.mode === 'sentence-building'
        ? tokenIds.length === currentExercise.answerTokens.length : answer.trim().length > 0,
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
      ...(activeLesson.error ? { errorMessage: i18n._(msg({ id: 'today.lesson.save-error', message: '{error} This question is still open.' }).id, { error: activeLesson.error }) } : {}),
      liveMessage: activeLesson.phase === 'feedback' ? _(msg({ id: 'today.lesson.rate-prompt', message: 'Review the answer, then rate your recall.' }))
        : activeLesson.phase === 'completed' ? _(msg({ id: 'today.lesson.complete', message: 'Your daily lesson is complete.' }))
          : i18n._(msg({ id: 'today.question.progress', message: 'Question {current} of {total}.' }).id, { current: activeLesson.index + 1, total: activeLesson.exercises.length }),
    };
    return <Suspense fallback={interactionFallback}><LessonScreen model={model} actions={{
      chooseAnswer: setAnswer,
      changeTextAnswer: setAnswer,
      toggleSentenceToken: id => setTokenIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]),
      playAudio: () => {
        setAudioError(null);
        if (currentExercise.mode === 'listening' && currentExercise.audioUrl) {
          void new Audio(currentExercise.audioUrl).play().catch(() => setAudioError(_(msg({ id: 'today.lesson.audio-error', message: 'Audio could not be played. Check your connection or exit and use Active recall.' }))));
        }
      },
      submitAnswer: () => { session.submit(answerFor(currentExercise, answer, tokenIds)); },
      rate: rating => {
        const cardId = currentExercise.cardId;
        void session.rate(rating).then(result => {
          if (result.status !== 'advanced' && result.status !== 'completed') return;
          setMultiStage(current => (current ? { ...current, stats: applyRatingToStats(current.stats, cardId, rating) } : current));
        });
      },
      retryRating: () => { void session.retry(); },
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

  const weakCards: CardData[] = multiStage
    ? multiStage.stats.weakCardIds.flatMap(id => {
        const card = dailyCardsRef.current.find(candidate => candidate.id === id);
        return card ? [card] : [];
      })
    : [];
  const sessionTotalCards = multiStage ? multiStage.stagePlan.review.length + multiStage.stagePlan.fresh.length : 0;
  const sessionXpEarned = multiStage
    ? (multiStage.stats.goodCount + multiStage.stats.againCount) * REVIEW_XP + multiStage.stats.matchXp
    : 0;

  const todayModel: TodayScreenModel = {
    headingRef,
    streak: evidencedStudyStreak(streak, studyXpHistory),
    courseLabel: `${courseLanguageNames.of(languageProfile.source.code) || languageProfile.source.displayName} ← ${courseLanguageNames.of(languageProfile.target.code) || languageProfile.target.displayName}`,
    status: activePool.status === 'loading' ? 'loading'
      : activePool.status === 'error' ? 'error'
        : plan?.items.length === 0 && activePool.cards.length > 0 ? 'caught-up'
          : !plan?.items.length ? 'empty' : isOffline ? 'offline' : 'ready',
    isOffline,
    message: activePool.status === 'loading' ? _(msg({ id: 'today.plan.preparing', message: 'Preparing a bounded daily plan…' }))
      : activePool.status === 'error' ? activePool.error
        : plan?.items.length === 0 && activePool.cards.length > 0 ? _(msg({ id: 'today.plan.caught-up', message: 'No due or new cards are available in this daily plan.' }))
          : !plan?.items.length ? _(msg({ id: 'today.plan.empty', message: 'Add vocabulary or return when a reviewed card is due.' }))
            : plan.isShort ? _(msg({ id: 'today.plan.short', message: 'A shorter plan is ready.' })) : _(msg({ id: 'today.plan.ready', message: 'Your plan is ready.' })),
    plan: plan ? { total: plan.counts.total, due: plan.counts.due, weak: plan.counts.weak, fresh: plan.counts.new, isShort: plan.isShort } : null,
    placementAvailable: availablePlacement.status === 'ready',
    ...(plan?.items.length === 0 && activePool.cards.length > 0
      ? { caughtUp: {} }
      : {}),
  };
  return <>
    <TodayScreen model={todayModel} ownerId={ownerId} targetLanguage={targetLanguage} actions={{
      openVocabulary, openPaths, retry: () => void load(), startSession: beginMultiStageSession, startLesson,
      startPlacement: () => navigateLesson('placement'), openMorePractice,
    }} />
    {multiStage?.phase.kind === 'recap' && (
      <Suspense fallback={null}>
        <SessionRecapModal
          open
          onClose={finishMultiStageSession}
          {...(weakCards.length > 0 ? { onRetryWeak: retryWeakCards } : {})}
          totalCards={sessionTotalCards}
          goodCount={multiStage.stats.goodCount}
          againCount={multiStage.stats.againCount}
          xpEarned={sessionXpEarned}
          weakCards={weakCards}
          targetLanguage={targetLanguage}
        />
      </Suspense>
    )}
  </>;
}

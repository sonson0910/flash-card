import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import type { CardData, ReviewRatingValue } from '../../types/card';
import type { LearningStateOutcome } from '../learning/learningStateController';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import { buildDailyPlan, type DailyPlan } from './dailyPlan';
import { createDailyPracticePoolRuntime } from './dailyPracticePoolRuntime';
import { createDailySessionController } from './dailySessionController';
import { readDailyLearningUrlState } from './dailyLearningUrl';
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
import type {
  LessonAnswerPresentation,
  LessonMode,
  LessonScreenModel,
  PlacementScreenModel,
  TodayScreenModel,
} from './dailyLearningPresentation';
import { evidencedStudyStreak } from './dailyLearningPresentation';

const LessonScreen = lazy(() => import('./LessonScreen').then(module => ({ default: module.LessonScreen })));
const PlacementScreen = lazy(() => import('./PlacementScreen').then(module => ({ default: module.PlacementScreen })));
const interactionFallback = <div role="status" className="rounded-2xl border border-[var(--sf-border)] p-5"><Trans id="today.activity.preparing" message="Preparing activity…" /></div>;

export interface DailyLearningWorkspaceProps {
  readonly ownerId: string | null;
  readonly isOffline: boolean;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent?: number;
  readonly initialLesson: ExerciseMode | 'placement' | null;
  readonly streak: number;
  readonly studyXpHistory: readonly { readonly date: string; readonly XP: number }[];
  readonly loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  readonly reviewCard: (cardId: string, rating: ReviewRatingValue, operationId: string, source?: CardData) => Promise<LearningStateOutcome>;
  readonly openLesson: (mode: ExerciseMode | 'placement' | null) => void;
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
  const [routeLesson, setRouteLesson] = useState(initialLesson);
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
      if (!next) session.close();
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
    void load();
  }, [load, ownerId, poolRuntime, session]);
  useEffect(() => {
    if (lastPoolLoaderRef.current === loadPracticePool) return;
    lastPoolLoaderRef.current = loadPracticePool;
    if (!session.getSnapshot()) void load();
  }, [load, loadPracticePool, session]);
  useEffect(() => { setAnswer(''); setTokenIds([]); setAudioError(null); }, [lesson?.index]);

  const activePool: PoolState = pool.ownerId === ownerId ? pool : { status: 'loading', ownerId, cards: [], error: null };
  const plan: DailyPlan | null = useMemo(() => activePool.status === 'ready'
    ? buildDailyPlan(activePool.cards, { now: new Date() })
    : null, [activePool]);
  const placementCandidates = useMemo(() => activePool.cards.filter(card => (
    getEligibleExerciseModes(card, activePool.cards).includes('recognition')
  )), [activePool.cards]);
  const availablePlacement = useMemo(() => buildPlacementCheck(placementCandidates), [placementCandidates]);
  const navigateLesson = useCallback((mode: ExerciseMode | 'placement' | null, focusDestination = true) => {
    setRouteLesson(mode);
    if (focusDestination) setHeadingFocusIntent(intent => intent + 1);
    openLesson(mode);
  }, [openLesson]);

  const startLesson = useCallback((mode: LessonMode, focusDestination = true) => {
    if (!plan?.items.length) return;
    const exercises = plan.items.map(({ card }) => buildExercise(
      isOffline && mode === 'listening' ? { ...card, audioUrl: null } : card,
      activePool.cards, mode, inferScriptScoringPolicy(card.word),
    ));
    lessonOwnerRef.current = ownerRef.current;
    session.start(exercises);
    navigateLesson(mode, focusDestination);
  }, [activePool.cards, isOffline, navigateLesson, plan, session]);

  useEffect(() => {
    if (!routeLesson || routeLesson === 'placement' || lesson || !plan?.items.length) return;
    startLesson(routeLesson, false);
  }, [lesson, plan, routeLesson, startLesson]);

  const activeLesson = lessonOwnerRef.current === ownerId ? lesson : null;
  const currentExercise = activeLesson?.exercises[activeLesson.index]
    ?? (activeLesson?.phase === 'completed' ? activeLesson.exercises.at(-1) : undefined);
  const currentCard = currentExercise && dailyCardsRef.current.find(card => card.id === currentExercise.cardId);
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
        : activeLesson.phase === 'sync-pending' ? 'rating-sync-pending'
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
      ...(activeLesson.syncPendingReviewCount > 0 ? { syncPendingReviewCount: activeLesson.syncPendingReviewCount } : {}),
      liveMessage: activeLesson.phase === 'sync-pending' ? _(msg({ id: 'today.lesson.sync-pending', message: 'Review saved on this device and waiting to sync.' }))
        : activeLesson.phase === 'feedback' ? _(msg({ id: 'today.lesson.rate-prompt', message: 'Review the answer, then rate your recall.' }))
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
      rate: rating => { void session.rate(rating); },
      retryRating: () => { void session.retry(); },
      exit: () => { session.close(); navigateLesson(null); },
      finish: () => { session.close(); navigateLesson(null); void load(); },
    }} /></Suspense>;
  }

  const todayModel: TodayScreenModel = {
    headingRef,
    streak: evidencedStudyStreak(streak, studyXpHistory),
    courseLabel: `${courseLanguageNames.of(ENGLISH_TO_VIETNAMESE_PROFILE.source.code) || ENGLISH_TO_VIETNAMESE_PROFILE.source.displayName} ← ${courseLanguageNames.of(ENGLISH_TO_VIETNAMESE_PROFILE.target.code) || ENGLISH_TO_VIETNAMESE_PROFILE.target.displayName}`,
    status: activePool.status === 'loading' ? 'loading'
      : activePool.status === 'error' ? 'error'
        : !plan?.items.length ? 'empty' : isOffline ? 'offline' : 'ready',
    isOffline,
    message: activePool.status === 'loading' ? _(msg({ id: 'today.plan.preparing', message: 'Preparing a bounded daily plan…' }))
      : activePool.status === 'error' ? activePool.error
        : !plan?.items.length ? _(msg({ id: 'today.plan.empty', message: 'Add vocabulary or return when a reviewed card is due.' }))
          : plan.isShort ? _(msg({ id: 'today.plan.short', message: 'A shorter plan is ready.' })) : _(msg({ id: 'today.plan.ready', message: 'Your plan is ready.' })),
    plan: plan ? { total: plan.counts.total, due: plan.counts.due, weak: plan.counts.weak, fresh: plan.counts.new, isShort: plan.isShort } : null,
    placementAvailable: availablePlacement.status === 'ready',
  };
  return <TodayScreen model={todayModel} actions={{
    openVocabulary, openPaths, retry: () => void load(), continueReview: () => void continueReview(), startLesson,
    startPlacement: () => navigateLesson('placement'), openMorePractice,
  }} />;
}

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { CardData, ReviewRatingValue } from '../../types/card';
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
import { ListenMvp } from '../listenMvp/ListenMvp';
import { LISTEN_MVP_PILOT_LESSONS, selectListenMvpPilotLesson } from '../listenMvp/listenMvpPilot';
import { createSkillEvidenceController } from '../skillEvidence/skillEvidenceController';
import { createLocalSkillEvidencePersistence } from '../skillEvidence/skillEvidenceStorage';
import type { ListenMvpEvidenceInput } from '../listenMvp/listenMvpInteraction';
import type {
  LessonAnswerPresentation,
  LessonMode,
  LessonScreenModel,
  PlacementScreenModel,
  TodayScreenModel,
} from './dailyLearningPresentation';

const LessonScreen = lazy(() => import('./LessonScreen').then(module => ({ default: module.LessonScreen })));
const PlacementScreen = lazy(() => import('./PlacementScreen').then(module => ({ default: module.PlacementScreen })));
const interactionFallback = <div role="status" className="rounded-2xl border border-[var(--sf-border)] p-5">Preparing activity…</div>;

export interface DailyLearningWorkspaceProps {
  readonly ownerId: string | null;
  readonly isOffline: boolean;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent?: number;
  readonly initialLesson: ExerciseMode | 'placement' | null;
  readonly loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  readonly reviewCard: (cardId: string, rating: ReviewRatingValue, operationId: string, source?: CardData) => Promise<void>;
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

const modeLabels: Readonly<Record<ExerciseMode, string>> = {
  recognition: 'Recognition',
  'active-recall': 'Active recall',
  listening: 'Listening',
  spelling: 'Spelling',
  cloze: 'Cloze',
  'sentence-building': 'Sentence building',
};

const errorMessage = (error: unknown) => error instanceof Error && error.message.trim()
  ? error.message
  : 'The daily practice pool could not be prepared.';

const answerFor = (exercise: Exercise | undefined, value: string, tokenIds: readonly string[]): ExerciseAnswer => {
  if (exercise?.mode === 'sentence-building') return tokenIds;
  return value;
};

const expectedAnswer = (exercise: Exercise): string => exercise.mode === 'sentence-building'
  ? exercise.answerTokens.map(token => token.text).join(' ')
  : exercise.answer;

const answerPresentation = (
  exercise: Exercise,
  value: string,
  tokenIds: readonly string[],
): LessonAnswerPresentation => {
  if (exercise.mode === 'recognition') {
    return {
      kind: 'choice', selectedId: value || null,
      options: exercise.options.map(option => ({ id: option, label: option, language: 'vi' })),
    };
  }
  if (exercise.mode === 'sentence-building') {
    return {
      kind: 'sentence',
      tokens: exercise.tokens.map(token => ({
        occurrenceId: token.id, label: token.text, isSelected: tokenIds.includes(token.id),
      })),
      selectedOrder: tokenIds.flatMap(id => {
        const token = exercise.tokens.find(candidate => candidate.id === id);
        return token ? [{ occurrenceId: token.id, label: token.text, isSelected: true }] : [];
      }),
    };
  }
  return { kind: 'text', value, label: exercise.instruction };
};

export default function DailyLearningWorkspace({
  ownerId,
  isOffline,
  headingRef,
  focusIntent = 0,
  initialLesson,
  loadPracticePool,
  reviewCard,
  openLesson,
  openVocabulary,
  openPaths,
  continueReview,
  openMorePractice,
}: DailyLearningWorkspaceProps) {
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
  const skillEvidence = useMemo(() => createSkillEvidenceController({
    persistence: createLocalSkillEvidencePersistence({ activeOwner: () => ownerRef.current }),
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
  const [listenPilotIndex, setListenPilotIndex] = useState(0);
  const listenPilotNextIndexRef = useRef(0);

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
      if (ownerRef.current === expectedOwner) setPool(current => ({ status: 'error', ownerId: expectedOwner, cards: current.ownerId === expectedOwner ? current.cards : [], error: errorMessage(error) }));
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
    if (mode === 'listening') {
      const pilot = selectListenMvpPilotLesson(listenPilotNextIndexRef.current);
      if (pilot) {
        setListenPilotIndex(listenPilotNextIndexRef.current);
        listenPilotNextIndexRef.current = (listenPilotNextIndexRef.current + 1) % LISTEN_MVP_PILOT_LESSONS.length;
        navigateLesson(mode, focusDestination);
        return;
      }
    }
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
    if (routeLesson === 'listening' && LISTEN_MVP_PILOT_LESSONS.length > 0) return;
    startLesson(routeLesson, false);
  }, [lesson, plan, routeLesson, startLesson]);

  const activeLesson = lessonOwnerRef.current === ownerId ? lesson : null;
  const listenPilotLesson = routeLesson === 'listening'
    ? selectListenMvpPilotLesson(listenPilotIndex)
    : null;
  const recordListenEvidence = useCallback((evidence: ListenMvpEvidenceInput) => {
    void skillEvidence.record(evidence).catch(() => undefined);
  }, [skillEvidence]);
  if (listenPilotLesson) {
    return (
      <section className="mx-auto w-full max-w-4xl space-y-4" aria-labelledby="listen-pilot-heading">
        <div className="flex items-center justify-between gap-3">
          <h1 id="listen-pilot-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-black tracking-tight">Immerse · Listen</h1>
          <button type="button" onClick={() => navigateLesson(null)} className="min-h-11 rounded-full border border-[var(--sf-border)] px-4 py-2 text-sm font-bold focus-visible:outline-2">Back to Today</button>
        </div>
        <ListenMvp lesson={listenPilotLesson} onEvidence={recordListenEvidence} />
      </section>
    );
  }
  const currentExercise = activeLesson?.exercises[activeLesson.index]
    ?? (activeLesson?.phase === 'completed' ? activeLesson.exercises.at(-1) : undefined);
  if (routeLesson === 'placement') {
    const check = placementCheck ?? availablePlacement;
    const readyCheck = check.status === 'ready' ? check : null;
    const item = readyCheck?.items[placementIndex];
    const question = item ? buildExercise(item.card, activePool.cards, 'recognition') : null;
    let model: PlacementScreenModel;
    if (activePool.status === 'loading') model = { headingRef, status: 'loading', message: 'Preparing placement evidence…' };
    else if (activePool.status === 'error') model = { headingRef, status: 'error', message: activePool.error };
    else if (check.status === 'insufficient') model = {
      headingRef, status: 'insufficient', message: 'At least 6 unique words with CEFR evidence and answer choices are required.',
      eligibleCount: check.eligibleCount, requiredCount: check.requiredCount,
    };
    else if (placementResult?.status === 'complete') model = {
      headingRef, status: 'result', message: 'Your answers suggest starting here.',
      recommendation: placementResult.recommendation,
      recommendationLabel: placementResult.recommendation[0].toUpperCase() + placementResult.recommendation.slice(1),
      confidence: placementResult.confidence, answeredCount: placementResult.answeredCount,
      correctCount: placementResult.correctCount,
    };
    else if (placementIndex < 0 || !item || question?.mode !== 'recognition') model = {
      headingRef, status: 'intro', message: 'Check your current vocabulary evidence in 6–12 questions.',
      eligibleCount: readyCheck?.items.length ?? 0,
    };
    else model = {
      headingRef, status: 'question', message: `Question ${placementIndex + 1} of ${readyCheck.items.length}.`,
      current: placementIndex + 1, total: readyCheck.items.length, prompt: question.prompt,
      promptLanguage: 'en', selectedId: placementChoice,
      options: question.options.map(option => ({ id: option, label: option, language: 'vi' })),
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
      prompt: currentExercise.prompt,
      promptLanguage: currentExercise.promptLanguage,
      answer: answerPresentation(currentExercise, answer, tokenIds),
      canSubmit: currentExercise.mode === 'sentence-building'
        ? tokenIds.length === currentExercise.answerTokens.length : answer.trim().length > 0,
      canPlayAudio: currentExercise.mode === 'listening' && Boolean(currentExercise.audioUrl),
      ...(audioError ? { audioErrorMessage: audioError } : {}),
      ...(feedback ? { feedback: {
        outcome: feedback.correct ? 'correct' : 'incorrect',
        message: feedback.correct ? 'Correct.' : 'Not quite.',
        expectedAnswer: expectedAnswer(currentExercise),
        answerLanguage: currentExercise.mode === 'recognition' ? 'vi' : 'en',
        explanation: currentExercise.mode === 'active-recall' && currentExercise.fallbackFrom
          ? `${modeLabels[currentExercise.fallbackFrom]} was unavailable for this card, so active recall was used.` : undefined,
      } } : {}),
      ...(activeLesson.error ? { errorMessage: `${activeLesson.error} This question is still open.` } : {}),
      liveMessage: activeLesson.phase === 'feedback' ? 'Review the answer, then rate your recall.'
        : activeLesson.phase === 'completed' ? 'Your daily lesson is complete.'
          : `Question ${activeLesson.index + 1} of ${activeLesson.exercises.length}.`,
    };
    return <Suspense fallback={interactionFallback}><LessonScreen model={model} actions={{
      chooseAnswer: setAnswer,
      changeTextAnswer: setAnswer,
      toggleSentenceToken: id => setTokenIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]),
      playAudio: () => {
        setAudioError(null);
        if (currentExercise.mode === 'listening' && currentExercise.audioUrl) {
          void new Audio(currentExercise.audioUrl).play().catch(() => setAudioError('Audio could not be played. Check your connection or exit and use Active recall.'));
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
    status: activePool.status === 'loading' ? 'loading'
      : activePool.status === 'error' ? 'error'
        : !plan?.items.length ? 'empty' : isOffline ? 'offline' : 'ready',
    isOffline,
    message: activePool.status === 'loading' ? 'Preparing a bounded daily plan…'
      : activePool.status === 'error' ? activePool.error
        : !plan?.items.length ? 'Add vocabulary or return when a reviewed card is due.'
          : plan.isShort ? 'A shorter plan is ready.' : 'Your plan is ready.',
    plan: plan ? { total: plan.counts.total, due: plan.counts.due, weak: plan.counts.weak, fresh: plan.counts.new, isShort: plan.isShort } : null,
    placementAvailable: availablePlacement.status === 'ready',
    listenPilotAvailable: LISTEN_MVP_PILOT_LESSONS.length > 0,
  };
  return <TodayScreen model={todayModel} actions={{
    openVocabulary, openPaths, retry: () => void load(), continueReview: () => void continueReview(), startLesson,
    startPlacement: () => navigateLesson('placement'), openMorePractice,
  }} />;
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { playCorrectSound, playIncorrectSound, playWordAudio } from '../../lib/audio';
import { triggerConfetti } from '../../lib/confetti';
import { playRewardSound } from '../../lib/interactionSounds';
import { OperationTimeoutError, withTimeout } from '../../lib/async';
import { getProtectedFunctionUserMessage } from '../../lib/protectedFunctionsCapability';
import type { CardData } from '../../types/card';
import {
  createQuizQuestions,
  createSpellingQueue,
  isQuizAnswerCorrect,
  type QuizQuestion,
} from './practiceModel';
import type { PracticeActivity, PracticeSessionLifecycle } from './practiceSessionLifecycle';

type PracticeView = 'quiz' | 'spelling' | 'story' | 'match' | 'shadowing';

const PRACTICE_POOL_TIMEOUT_MS = 15_000;
const practicePoolTimeoutMessage = 'Preparing this activity took too long. Check your connection and try again.';

export function usePracticeGames({
  lifecycle,
  loadPracticePool,
  addXp,
  openView,
  reportError,
  normalizeAnswer = value => typeof value === 'string' ? value.trim().toLocaleLowerCase() : '',
}: {
  lifecycle: PracticeSessionLifecycle;
  loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  addXp: (amount: number) => void;
  openView: (view: PracticeView) => void;
  reportError: (message: string) => void;
  normalizeAnswer?: (value: unknown) => string;
}) {
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answeredCorrectly, setAnsweredCorrectly] = useState<boolean | null>(null);
  const [quizScore, setQuizScore] = useState(0);
  const [showQuizResults, setShowQuizResults] = useState(false);
  const [spellingCards, setSpellingCards] = useState<CardData[]>([]);
  const [currentSpellingIndex, setCurrentSpellingIndex] = useState(0);
  const [spellingInput, setSpellingInput] = useState('');
  const [spellingChecked, setSpellingChecked] = useState(false);
  const [spellingCorrect, setSpellingCorrect] = useState(false);
  const [spellingScore, setSpellingScore] = useState(0);
  const [showSpellingResults, setShowSpellingResults] = useState(false);
  const [story, setStory] = useState<{ story: string; translation: string } | null>(null);
  const [storyError, setStoryError] = useState<string | null>(null);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [isStartingQuiz, setIsStartingQuiz] = useState(false);
  const [isStartingSpelling, setIsStartingSpelling] = useState(false);
  const quizAnswerLockedRef = useRef(false);
  const spellingAnswerLockedRef = useRef(false);
  const quizAudioTimersRef = useRef<Set<number>>(new Set());
  const spellingAudioTimersRef = useRef<Set<number>>(new Set());

  const cancelDelayedAudio = (timers: Set<number>) => {
    timers.forEach(timerId => globalThis.clearTimeout(timerId));
    timers.clear();
  };

  const cancelAllDelayedAudio = () => {
    cancelDelayedAudio(quizAudioTimersRef.current);
    cancelDelayedAudio(spellingAudioTimersRef.current);
  };

  const scheduleDelayedAudio = (
    timers: Set<number>,
    activity: Extract<PracticeActivity, 'quiz' | 'spelling'>,
    word: string,
    audioUrl: string | null,
    answerSession: number,
  ) => {
    const timerId = window.setTimeout(() => {
      timers.delete(timerId);
      if (lifecycle.isCurrent(answerSession) && lifecycle.isActive(activity)) {
        playWordAudio(word, audioUrl);
      }
    }, 400);
    timers.add(timerId);
  };

  useEffect(() => () => cancelAllDelayedAudio(), []);

  const loadPoolForPreparation = (includeFuture = true) => withTimeout(
    loadPracticePool(50, includeFuture),
    PRACTICE_POOL_TIMEOUT_MS,
    practicePoolTimeoutMessage,
  );

  const reportPreparationFailure = (activity: string, error: unknown) => {
    console.warn(`Could not prepare ${activity}.`, error);
    reportError(error instanceof OperationTimeoutError
      ? error.message
      : `Could not prepare ${activity}. Check your connection and try again.`);
  };

  const startQuiz = async () => {
    const result = await lifecycle.prepare(
      'quiz',
      () => loadPoolForPreparation(),
      () => {
        cancelAllDelayedAudio();
        setIsStartingQuiz(true);
      },
    );
    if (result.status === 'ready') {
      const cards = result.value;
      if (cards.length < 4) {
        reportError('You need at least 4 cards to start a quiz.');
      } else if (lifecycle.activate('quiz', result.sessionToken)) {
        setQuizQuestions(createQuizQuestions(cards, 10, Math.random, normalizeAnswer));
        setCurrentQuizIndex(0);
        setSelectedAnswer(null);
        setAnsweredCorrectly(null);
        setQuizScore(0);
        setShowQuizResults(false);
        quizAnswerLockedRef.current = false;
        openView('quiz');
      }
      if (lifecycle.isCurrent(result.sessionToken)) setIsStartingQuiz(false);
    } else if (result.status === 'failed') {
      reportPreparationFailure('the quiz', result.error);
      if (lifecycle.isCurrent(result.sessionToken)) setIsStartingQuiz(false);
    }
  };

  const selectQuizAnswer = (option: string) => {
    if (!lifecycle.isActive('quiz')) return;
    if (selectedAnswer !== null || quizAnswerLockedRef.current) return;
    const question = quizQuestions[currentQuizIndex];
    if (!question) return;
    quizAnswerLockedRef.current = true;
    const correct = isQuizAnswerCorrect(question, option);
    setSelectedAnswer(option);
    setAnsweredCorrectly(correct);
    if (correct) {
      setQuizScore(previous => previous + 1);
      addXp(5);
      playCorrectSound();
    } else {
      playIncorrectSound();
    }
    scheduleDelayedAudio(
      quizAudioTimersRef.current,
      'quiz',
      question.card.word,
      question.card.audioUrl,
      lifecycle.currentToken(),
    );
  };

  const nextQuizQuestion = () => {
    if (!lifecycle.isActive('quiz')) return;
    if (currentQuizIndex < quizQuestions.length - 1) {
      setCurrentQuizIndex(previous => previous + 1);
      setSelectedAnswer(null);
      setAnsweredCorrectly(null);
      quizAnswerLockedRef.current = false;
      return;
    }
    setShowQuizResults(true);
    triggerConfetti(0.5, 0.4);
    playRewardSound();
  };

  const startSpelling = async () => {
    const result = await lifecycle.prepare(
      'spelling',
      () => loadPoolForPreparation(),
      () => {
        cancelAllDelayedAudio();
        setIsStartingSpelling(true);
      },
    );
    if (result.status === 'ready') {
      const cards = result.value;
      if (cards.length < 4) {
        reportError('You need at least 4 cards for spelling practice.');
      } else if (lifecycle.activate('spelling', result.sessionToken)) {
        setSpellingCards(createSpellingQueue(cards));
        setCurrentSpellingIndex(0);
        setSpellingInput('');
        setSpellingChecked(false);
        setSpellingCorrect(false);
        setSpellingScore(0);
        setShowSpellingResults(false);
        spellingAnswerLockedRef.current = false;
        openView('spelling');
      }
      if (lifecycle.isCurrent(result.sessionToken)) setIsStartingSpelling(false);
    } else if (result.status === 'failed') {
      reportPreparationFailure('spelling practice', result.error);
      if (lifecycle.isCurrent(result.sessionToken)) setIsStartingSpelling(false);
    }
  };

  const checkSpelling = (event: FormEvent) => {
    event.preventDefault();
    if (!lifecycle.isActive('spelling')) return;
    if (spellingChecked || spellingAnswerLockedRef.current || !spellingInput.trim()) return;
    const card = spellingCards[currentSpellingIndex];
    if (!card) return;
    spellingAnswerLockedRef.current = true;
    const correct = normalizeAnswer(spellingInput) === normalizeAnswer(card.word);
    setSpellingCorrect(correct);
    setSpellingChecked(true);
    if (correct) {
      setSpellingScore(previous => previous + 1);
      addXp(5);
      playCorrectSound();
    } else {
      playIncorrectSound();
    }
    scheduleDelayedAudio(
      spellingAudioTimersRef.current,
      'spelling',
      card.word,
      card.audioUrl,
      lifecycle.currentToken(),
    );
  };

  const nextSpelling = () => {
    if (!lifecycle.isActive('spelling')) return;
    if (currentSpellingIndex < spellingCards.length - 1) {
      setCurrentSpellingIndex(previous => previous + 1);
      setSpellingInput('');
      setSpellingChecked(false);
      spellingAnswerLockedRef.current = false;
      return;
    }
    setShowSpellingResults(true);
    triggerConfetti(0.5, 0.4);
    playRewardSound();
  };

  const generateStory = async () => {
    const result = await lifecycle.prepare(
      'story',
      async scope => {
        const cards = await loadPoolForPreparation();
        if (!scope.isCurrent()) return null;
        if (cards.length === 0) return null;
        const { generateStoryContext } = await import('../../lib/gemini');
        if (!scope.isCurrent()) return null;
        const learningCards = cards.filter(card => card.difficulty !== 'easy');
        const pool = learningCards.length >= 3 ? learningCards : cards;
        const selected = createSpellingQueue(pool, 5).map(card => card.word);
        return generateStoryContext(selected);
      },
      () => {
        cancelAllDelayedAudio();
        setStory(null);
        setStoryError(null);
        setIsGeneratingStory(true);
        lifecycle.activate('story', lifecycle.currentToken());
        openView('story');
      },
    );
    if (result.status === 'ready') {
      if (result.value === null) {
        setStoryError('There are no suitable cards for an AI story yet. Add or sync some cards, then try again.');
      } else if (lifecycle.isActive('story')) {
        setStory(result.value);
      }
      if (lifecycle.isCurrent(result.sessionToken)) setIsGeneratingStory(false);
    } else if (result.status === 'failed') {
      console.error('Story generation failed.', result.error);
      setStoryError(result.error instanceof OperationTimeoutError
        ? result.error.message
        : getProtectedFunctionUserMessage(result.error)
          ?? 'Could not generate a story right now. Please try again.');
      if (lifecycle.isCurrent(result.sessionToken)) setIsGeneratingStory(false);
    }
  };

  const clearQuiz = () => {
    cancelDelayedAudio(quizAudioTimersRef.current);
    quizAnswerLockedRef.current = false;
    lifecycle.clear('quiz');
    setQuizQuestions([]);
    setCurrentQuizIndex(0);
    setSelectedAnswer(null);
    setAnsweredCorrectly(null);
    setQuizScore(0);
    setShowQuizResults(false);
  };
  const clearSpelling = () => {
    cancelDelayedAudio(spellingAudioTimersRef.current);
    spellingAnswerLockedRef.current = false;
    lifecycle.clear('spelling');
    setSpellingCards([]);
    setCurrentSpellingIndex(0);
    setSpellingInput('');
    setSpellingChecked(false);
    setSpellingCorrect(false);
    setSpellingScore(0);
    setShowSpellingResults(false);
  };
  const clearStory = () => {
    lifecycle.clear('story');
    setStory(null);
    setStoryError(null);
    setIsGeneratingStory(false);
  };
  const startMatch = async () => {
    const result = await lifecycle.prepare(
      'match',
      () => loadPoolForPreparation(),
      () => {
        cancelAllDelayedAudio();
      },
    );
    if (result.status === 'ready') {
      const cards = result.value;
      if (cards.length < 4) {
        reportError('You need at least 4 cards to play Word Match.');
      } else if (lifecycle.activate('match', result.sessionToken)) {
        setSpellingCards(cards);
        openView('match');
      }
    } else if (result.status === 'failed') {
      reportPreparationFailure('word match', result.error);
    }
  };

  const startShadowing = async () => {
    const result = await lifecycle.prepare(
      'shadowing',
      () => loadPoolForPreparation(),
      () => {
        cancelAllDelayedAudio();
      },
    );
    if (result.status === 'ready') {
      const cards = result.value;
      if (cards.length === 0) {
        reportError('You need cards in your library to practice pronunciation shadowing.');
      } else if (lifecycle.activate('shadowing', result.sessionToken)) {
        setSpellingCards(cards);
        openView('shadowing');
      }
    } else if (result.status === 'failed') {
      reportPreparationFailure('shadowing practice', result.error);
    }
  };

  const reset = () => {
    cancelAllDelayedAudio();
    lifecycle.reset();
    clearQuiz();
    clearSpelling();
    clearStory();
    setIsStartingQuiz(false);
    setIsStartingSpelling(false);
  };

  return {
    quizQuestions, currentQuizIndex, selectedAnswer, answeredCorrectly, quizScore, showQuizResults,
    spellingCards, currentSpellingIndex, spellingInput, setSpellingInput, spellingChecked, spellingCorrect,
    spellingScore, showSpellingResults, story, storyError, isGeneratingStory,
    isStartingQuiz, isStartingSpelling,
    startQuiz, selectQuizAnswer, nextQuizQuestion, startSpelling, checkSpelling, nextSpelling, generateStory, startMatch, startShadowing,
    clearQuiz, clearSpelling, clearStory, reset,
  };
}

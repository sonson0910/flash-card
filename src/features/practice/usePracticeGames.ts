import { useEffect, useRef, useState, type FormEvent } from 'react';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { playCorrectSound, playIncorrectSound, playWordAudio, type WordAudioPlayback } from '../../lib/audio';
import { triggerConfetti } from '../../lib/confetti';
import { playRewardSound } from '../../lib/interactionSounds';
import { OperationTimeoutError, withTimeout } from '../../lib/async';
import { getProtectedFunctionUserMessage, ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { speechLocaleFor } from '../../lib/speechLocale';
import type { CardData } from '../../types/card';
import {
  createQuizQuestions,
  createSpellingQueue,
  createWordMatchRound,
  isQuizAnswerCorrect,
  type QuizQuestion,
} from './practiceModel';
import type { PracticeActivity, PracticeSessionLifecycle } from './practiceSessionLifecycle';

type PracticeView = 'quiz' | 'spelling' | 'story' | 'match' | 'shadowing';

const PRACTICE_POOL_TIMEOUT_MS = 15_000;
const practicePoolTimeoutMessage = 'Preparing this activity took too long. Check your connection and try again.';
const translate = (descriptor: MessageDescriptor) => i18n.locale ? i18n._(descriptor) : descriptor.message ?? descriptor.id;

function storyFailureMessage(error: unknown): string {
  if (error instanceof OperationTimeoutError) {
    return translate(msg({ id: 'practice.error.timeout', message: 'Preparing this activity took too long. Check your connection and try again.' }));
  }
  if (error instanceof ProtectedFunctionError) {
    if (error.reason === 'service-daily-cap') return translate(msg({ id: 'practice.error.service-daily-cap', message: 'AI is paused because today’s shared limit is exhausted. Try again after 00:00 Vietnam time.' }));
    if (error.reason === 'account-daily-spend') return translate(msg({ id: 'practice.error.account-daily-spend', message: 'You have reached your AI spending limit for today. Try again after 00:00 Vietnam time.' }));
    if (error.reason === 'ai-card-quota') return translate(msg({ id: 'practice.error.ai-card-quota', message: 'You have used your AI card allowance for this period. See Pro or wait for the next period; review and manual cards still work.' }));
    if (error.reason === 'ai-daily-allowance') return translate(msg({ id: 'practice.error.ai-daily-allowance', message: 'You have used today’s extra AI allowance. Try again after 00:00 Vietnam time.' }));
    if (error.reason === 'operation-in-flight') return translate(msg({ id: 'practice.error.operation-in-flight', message: 'AI content is still being created. Try again in a few seconds.' }));
    if (error.kind === 'quota') return translate(msg({ id: 'practice.error.quota', message: 'AI usage limit reached. Try again when your allowance resets.' }));
    if (error.kind === 'authentication') return translate(msg({ id: 'practice.error.sign-in', message: 'Sign in again to generate a story.' }));
    if (error.kind === 'permission') return translate(msg({ id: 'practice.error.permission', message: 'Story generation was rejected by the protected cloud service. Reload and sign in again; if it continues, App Check or access rules need administrator attention.' }));
    if (error.kind === 'configuration') return translate(msg({ id: 'practice.error.configuration', message: 'Story generation is unavailable. Please try again later.' }));
    if (error.kind === 'network') return translate(msg({ id: 'practice.error.network', message: 'Could not reach the story service. Check your connection and try again.' }));
  }
  return getProtectedFunctionUserMessage(error)
    ?? translate(msg({ id: 'practice.error.story', message: 'Could not generate a story right now. Please try again.' }));
}

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
  const [story, setStory] = useState<{ story: string; translation: string; language: string; translationLanguage: string } | null>(null);
  const [storyError, setStoryError] = useState<string | null>(null);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [isStartingQuiz, setIsStartingQuiz] = useState(false);
  const [isStartingSpelling, setIsStartingSpelling] = useState(false);
  const quizAnswerLockedRef = useRef(false);
  const spellingAnswerLockedRef = useRef(false);
  const quizAudioTimersRef = useRef<Set<number>>(new Set());
  const spellingAudioTimersRef = useRef<Set<number>>(new Set());
  const audioPlaybackRef = useRef<WordAudioPlayback | null>(null);

  const cancelDelayedAudio = (timers: Set<number>) => {
    timers.forEach(timerId => globalThis.clearTimeout(timerId));
    timers.clear();
  };

  const cancelAllDelayedAudio = () => {
    cancelDelayedAudio(quizAudioTimersRef.current);
    cancelDelayedAudio(spellingAudioTimersRef.current);
  };

  const cancelPracticeAudio = () => {
    cancelAllDelayedAudio();
    audioPlaybackRef.current?.cancel();
    audioPlaybackRef.current = null;
  };

  const scheduleDelayedAudio = (
    timers: Set<number>,
    activity: Extract<PracticeActivity, 'quiz' | 'spelling'>,
    card: CardData,
    answerSession: number,
  ) => {
    const timerId = window.setTimeout(() => {
      timers.delete(timerId);
      if (lifecycle.isCurrent(answerSession) && lifecycle.isActive(activity)) {
        audioPlaybackRef.current?.cancel();
        audioPlaybackRef.current = playWordAudio(card.word, card.audioUrl, speechLocaleFor(card));
      }
    }, 400);
    timers.add(timerId);
  };

  useEffect(() => () => cancelPracticeAudio(), []);

  const loadPoolForPreparation = (includeFuture = true) => withTimeout(
    loadPracticePool(50, includeFuture),
    PRACTICE_POOL_TIMEOUT_MS,
    practicePoolTimeoutMessage,
  );

  const reportPreparationFailure = (activity: string, error: unknown) => {
    console.warn(`Could not prepare ${activity}.`, error);
    reportError(error instanceof OperationTimeoutError
      ? translate(msg({ id: 'practice.error.timeout', message: 'Preparing this activity took too long. Check your connection and try again.' }))
      : translate(msg({ id: 'practice.error.prepare', message: 'Could not prepare this activity. Check your connection and try again.' })));
  };

  const startQuiz = async () => {
    const result = await lifecycle.prepare(
      'quiz',
      () => loadPoolForPreparation(),
      () => {
        cancelPracticeAudio();
        setIsStartingQuiz(true);
      },
    );
    if (result.status === 'ready') {
      const cards = result.value;
      if (cards.length < 4) {
        reportError(translate(msg({ id: 'practice.error.quiz-card-count', message: 'You need at least 4 cards to start a quiz.' })));
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
      question.card,
      lifecycle.currentToken(),
    );
  };

  const nextQuizQuestion = () => {
    if (!lifecycle.isActive('quiz')) return;
    cancelPracticeAudio();
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
        cancelPracticeAudio();
        setIsStartingSpelling(true);
      },
    );
    if (result.status === 'ready') {
      const cards = result.value;
      if (cards.length < 4) {
        reportError(translate(msg({ id: 'practice.error.spelling-card-count', message: 'You need at least 4 cards for spelling practice.' })));
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
      card,
      lifecycle.currentToken(),
    );
  };

  const nextSpelling = () => {
    if (!lifecycle.isActive('spelling')) return;
    cancelPracticeAudio();
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
        const selected = createSpellingQueue(pool, 5);
        const generated = await generateStoryContext(selected.map(card => card.word));
        return {
          ...generated,
          language: selected[0].language || 'en',
          translationLanguage: selected[0].translationLanguage || 'vi',
        };
      },
      () => {
        cancelPracticeAudio();
        setStory(null);
        setStoryError(null);
        setIsGeneratingStory(true);
        lifecycle.activate('story', lifecycle.currentToken());
        openView('story');
      },
    );
    if (result.status === 'ready') {
      if (result.value === null) {
        setStoryError(translate(msg({ id: 'practice.error.story-no-cards', message: 'There are no suitable cards for an AI story yet. Add or sync some cards, then try again.' })));
      } else if (lifecycle.isActive('story')) {
        setStory(result.value);
      }
      if (lifecycle.isCurrent(result.sessionToken)) setIsGeneratingStory(false);
    } else if (result.status === 'failed') {
      console.error('Story generation failed.', result.error);
      setStoryError(storyFailureMessage(result.error));
      if (lifecycle.isCurrent(result.sessionToken)) setIsGeneratingStory(false);
    }
  };

  const clearQuiz = () => {
    cancelPracticeAudio();
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
    cancelPracticeAudio();
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
        cancelPracticeAudio();
      },
    );
    if (result.status === 'ready') {
      const cards = createWordMatchRound(result.value);
      if (cards.length < 4) {
        reportError(translate(msg({ id: 'practice.error.match-card-count', message: 'You need at least 4 cards to play Word Match.' })));
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
        cancelPracticeAudio();
      },
    );
    if (result.status === 'ready') {
      const cards = result.value;
      if (cards.length === 0) {
        reportError(translate(msg({ id: 'practice.error.shadowing-no-cards', message: 'You need cards in your library to practice pronunciation shadowing.' })));
      } else if (lifecycle.activate('shadowing', result.sessionToken)) {
        setSpellingCards(cards);
        openView('shadowing');
      }
    } else if (result.status === 'failed') {
      reportPreparationFailure('shadowing practice', result.error);
    }
  };

  const reset = () => {
    cancelPracticeAudio();
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

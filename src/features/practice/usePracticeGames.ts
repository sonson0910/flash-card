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
import {
  firebasePracticeSessionService,
  practiceTimeZone,
  type PracticeSessionCard,
  type PracticeSessionChallenge,
  type PracticeGamificationOutcome,
  type PracticeSessionService,
} from './practiceSessionService';

type PracticeView = 'quiz' | 'spelling' | 'language-drill' | 'story' | 'match' | 'shadowing';

const PRACTICE_POOL_TIMEOUT_MS = 15_000;
const practicePoolTimeoutMessage = 'Preparing this activity took too long. Check your connection and try again.';
const isLanguageDrillCard = (card: CardData) => ['en', 'ko', 'ja', 'zh'].includes(card.language?.toLowerCase().split('-')[0] || 'en');
const translate = (descriptor: MessageDescriptor) => i18n.locale ? i18n._(descriptor) : descriptor.message ?? descriptor.id;
const practiceOperationId = (game: 'quiz' | 'spelling' | 'match') => {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `practice-${game}-${random}`;
};

export const shuffleQuizOptions = (options: readonly string[], random: () => number = Math.random): string[] => {
  const shuffled = [...options];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
};

const snapshotCard = (cards: readonly CardData[], snapshot: PracticeSessionCard): CardData => {
  const card = cards.find(candidate => candidate.id === snapshot.cardId);
  if (!card) throw new Error('The practice session returned a card outside this game.');
  return { ...card, word: snapshot.word, translation: snapshot.translation };
};

const quizQuestionsFromChallenge = (cards: readonly CardData[], challenge: PracticeSessionChallenge): QuizQuestion[] => {
  if (challenge.kind !== 'quiz') throw new Error('The practice session returned the wrong challenge.');
  return challenge.questions.map(question => {
    const card = cards.find(candidate => candidate.id === question.cardId);
    if (!card) throw new Error('The practice session returned a card outside this game.');
    return {
      card: { ...card, word: question.prompt, translation: question.options[0] },
      type: 'target-to-native', options: shuffleQuizOptions(question.options), correctAnswer: question.options[0],
    };
  });
};

const spellingCardsFromChallenge = (cards: readonly CardData[], challenge: PracticeSessionChallenge): CardData[] => {
  if (challenge.kind !== 'spelling') throw new Error('The practice session returned the wrong challenge.');
  return challenge.prompts.map(prompt => {
    const card = cards.find(candidate => candidate.id === prompt.cardId);
    if (!card) throw new Error('The practice session returned a card outside this game.');
    return { ...card, word: prompt.word, translation: prompt.prompt };
  });
};

const matchCardsFromChallenge = (cards: readonly CardData[], challenge: PracticeSessionChallenge): CardData[] => {
  if (challenge.kind !== 'match') throw new Error('The practice session returned the wrong challenge.');
  return challenge.cards.map(card => snapshotCard(cards, card));
};

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
  languageDrillCards: availableLanguageDrillCards,
  languageDrillScopeKey,
  openView,
  reportError,
  practiceSessionService = firebasePracticeSessionService,
  onAuthoritativeOutcome,
  normalizeAnswer = value => typeof value === 'string' ? value.trim().toLocaleLowerCase() : '',
}: {
  lifecycle: PracticeSessionLifecycle;
  loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  languageDrillCards: readonly CardData[];
  languageDrillScopeKey: string;
  addXp?: (amount: number) => void;
  openView: (view: PracticeView) => void;
  reportError: (message: string) => void;
  practiceSessionService?: PracticeSessionService;
  onAuthoritativeOutcome?: (outcome: PracticeGamificationOutcome, operationId: string, sessionToken: number) => void;
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
  const [languageDrillCards, setLanguageDrillCards] = useState<CardData[]>([]);
  const [currentLanguageDrillIndex, setCurrentLanguageDrillIndex] = useState(0);
  const [languageDrillCorrect, setLanguageDrillCorrect] = useState(0);
  const [showLanguageDrillResults, setShowLanguageDrillResults] = useState(false);
  const [story, setStory] = useState<{ story: string; translation: string; language: string; translationLanguage: string } | null>(null);
  const [storyError, setStoryError] = useState<string | null>(null);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [isStartingQuiz, setIsStartingQuiz] = useState(false);
  const [isStartingSpelling, setIsStartingSpelling] = useState(false);
  const quizAnswerLockedRef = useRef(false);
  const spellingAnswerLockedRef = useRef(false);
  const languageDrillAnswerLockedRef = useRef(false);
  const quizAudioTimersRef = useRef<Set<number>>(new Set());
  const spellingAudioTimersRef = useRef<Set<number>>(new Set());
  const audioPlaybackRef = useRef<WordAudioPlayback | null>(null);
  const quizSessionRef = useRef<{ sessionId: string; completionId: string; sessionToken: number; responses: Record<string, string>; completing: boolean } | null>(null);
  const spellingSessionRef = useRef<{ sessionId: string; completionId: string; sessionToken: number; responses: Record<string, string>; completing: boolean } | null>(null);
  const matchSessionRef = useRef<{ sessionId: string; completionId: string; sessionToken: number; completing: boolean } | null>(null);

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
  useEffect(() => {
    languageDrillAnswerLockedRef.current = false;
    setLanguageDrillCards([]);
    setCurrentLanguageDrillIndex(0);
    setLanguageDrillCorrect(0);
    setShowLanguageDrillResults(false);
  }, [languageDrillScopeKey]);

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

  const completeSession = async (
    session: { sessionId: string; completionId: string; sessionToken: number; completing: boolean },
    answers: { responses: Record<string, string> } | { pairs: Array<{ cardId: string; word: string; translation: string }> },
  ) => {
    if (session.completing) return null;
    session.completing = true;
    try {
      const result = await practiceSessionService.complete({
        sessionId: session.sessionId, completionId: session.completionId, answers, timeZone: practiceTimeZone(),
      });
      if (!lifecycle.isCurrent(session.sessionToken)) return null;
      onAuthoritativeOutcome?.(result.outcome, session.completionId, session.sessionToken);
      return result;
    } catch (error) {
      session.completing = false;
      console.warn('Could not complete practice session.', error);
      reportError(translate(msg({ id: 'practice.error.complete', message: 'Could not save this practice result. Check your connection and try again.' })));
      return null;
    }
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
      } else {
        const questions = createQuizQuestions(cards, 10, Math.random, normalizeAnswer);
        let session;
        try {
          session = await practiceSessionService.start({
            opId: practiceOperationId('quiz'), game: 'quiz', cardIds: questions.map(question => question.card.id),
          });
        } catch (error) {
          reportPreparationFailure('the quiz', error);
          if (lifecycle.isCurrent(result.sessionToken)) setIsStartingQuiz(false);
          return;
        }
        let serverQuestions: QuizQuestion[];
        try {
          serverQuestions = quizQuestionsFromChallenge(cards, session.challenge);
        } catch (error) {
          reportPreparationFailure('the quiz', error);
          if (lifecycle.isCurrent(result.sessionToken)) setIsStartingQuiz(false);
          return;
        }
        if (lifecycle.activate('quiz', result.sessionToken)) {
        quizSessionRef.current = { sessionId: session.sessionId, completionId: practiceOperationId('quiz'), sessionToken: result.sessionToken, responses: {}, completing: false };
        setQuizQuestions(serverQuestions);
        setCurrentQuizIndex(0);
        setSelectedAnswer(null);
        setAnsweredCorrectly(null);
        setQuizScore(0);
        setShowQuizResults(false);
        quizAnswerLockedRef.current = false;
        openView('quiz');
        }
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
      playCorrectSound();
    } else {
      playIncorrectSound();
    }
    if (quizSessionRef.current) quizSessionRef.current.responses[question.card.id] = option;
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
    const session = quizSessionRef.current;
    if (session) void completeSession(session, { responses: session.responses });
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
      } else {
        const queue = createSpellingQueue(cards);
        let session;
        try {
          session = await practiceSessionService.start({
            opId: practiceOperationId('spelling'), game: 'spelling', cardIds: queue.map(card => card.id),
          });
        } catch (error) {
          reportPreparationFailure('spelling practice', error);
          if (lifecycle.isCurrent(result.sessionToken)) setIsStartingSpelling(false);
          return;
        }
        let serverCards: CardData[];
        try {
          serverCards = spellingCardsFromChallenge(cards, session.challenge);
        } catch (error) {
          reportPreparationFailure('spelling practice', error);
          if (lifecycle.isCurrent(result.sessionToken)) setIsStartingSpelling(false);
          return;
        }
        if (lifecycle.activate('spelling', result.sessionToken)) {
        spellingSessionRef.current = { sessionId: session.sessionId, completionId: practiceOperationId('spelling'), sessionToken: result.sessionToken, responses: {}, completing: false };
        setSpellingCards(serverCards);
        setCurrentSpellingIndex(0);
        setSpellingInput('');
        setSpellingChecked(false);
        setSpellingCorrect(false);
        setSpellingScore(0);
        setShowSpellingResults(false);
        spellingAnswerLockedRef.current = false;
        openView('spelling');
        }
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
      playCorrectSound();
    } else {
      playIncorrectSound();
    }
    if (spellingSessionRef.current) spellingSessionRef.current.responses[card.id] = spellingInput;
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
    const session = spellingSessionRef.current;
    if (session) void completeSession(session, { responses: session.responses });
  };

  const startLanguageDrill = async () => {
    const cards = availableLanguageDrillCards.filter(isLanguageDrillCard);
    if (cards.length === 0) {
      reportError(translate(msg({ id: 'practice.error.language-drill-card-count', message: 'You need at least 1 card for a language drill.' })));
      return;
    }
    if (!lifecycle.activate('spelling', lifecycle.currentToken())) return;
    languageDrillAnswerLockedRef.current = false;
    setLanguageDrillCards(createSpellingQueue(cards, 8));
    setCurrentLanguageDrillIndex(0);
    setLanguageDrillCorrect(0);
    setShowLanguageDrillResults(false);
    openView('language-drill');
  };

  const completeLanguageDrill = (correct: boolean) => {
    if (!lifecycle.isActive('spelling') || showLanguageDrillResults || languageDrillAnswerLockedRef.current) return;
    languageDrillAnswerLockedRef.current = true;
    if (correct) setLanguageDrillCorrect(current => current + 1);
    if (currentLanguageDrillIndex < languageDrillCards.length - 1) {
      setCurrentLanguageDrillIndex(current => current + 1);
      languageDrillAnswerLockedRef.current = false;
      return;
    }
    setShowLanguageDrillResults(true);
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
  const clearLanguageDrill = () => {
    lifecycle.clear('spelling');
    languageDrillAnswerLockedRef.current = false;
    setLanguageDrillCards([]);
    setCurrentLanguageDrillIndex(0);
    setLanguageDrillCorrect(0);
    setShowLanguageDrillResults(false);
  };
  const clearStory = () => {
    lifecycle.clear('story');
    setStory(null);
    setStoryError(null);
    setIsGeneratingStory(false);
  };
  const openMatchSession = async (cards: CardData[], sessionToken: number) => {
    if (cards.length < 4) {
      reportError(translate(msg({ id: 'practice.error.match-card-count', message: 'You need at least 4 cards to play Word Match.' })));
      return false;
    }
    let session;
    try {
      session = await practiceSessionService.start({
        opId: practiceOperationId('match'), game: 'match', cardIds: cards.map(card => card.id),
      });
    } catch (error) {
      reportPreparationFailure('word match', error);
      return false;
    }
    let serverCards: CardData[];
    try {
      serverCards = matchCardsFromChallenge(cards, session.challenge);
    } catch (error) {
      reportPreparationFailure('word match', error);
      return false;
    }
    if (!lifecycle.activate('match', sessionToken)) return false;
    matchSessionRef.current = { sessionId: session.sessionId, completionId: practiceOperationId('match'), sessionToken, completing: false };
    setSpellingCards(serverCards);
    openView('match');
    return true;
  };

  const prepareMatch = async (loadCards: () => Promise<CardData[]>) => {
    const result = await lifecycle.prepare(
      'match',
      loadCards,
      () => {
        cancelPracticeAudio();
      },
    );
    if (result.status === 'ready') {
      return openMatchSession(createWordMatchRound(result.value), result.sessionToken);
    } else if (result.status === 'failed') {
      reportPreparationFailure('word match', result.error);
    }
    return false;
  };

  const startMatch = async () => { await prepareMatch(() => loadPoolForPreparation()); };

  const completeMatch = async (pairs: Array<{ cardId: string; word: string; translation: string }>) => {
    const session = matchSessionRef.current;
    const result = session ? await completeSession(session, { pairs }) : null;
    return result ? { awardedXp: result.awardedXp } : null;
  };

  const restartMatch = async () => {
    matchSessionRef.current = null;
    return prepareMatch(async () => spellingCards);
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
    clearLanguageDrill();
    clearStory();
    setIsStartingQuiz(false);
    setIsStartingSpelling(false);
  };

  return {
    quizQuestions, currentQuizIndex, selectedAnswer, answeredCorrectly, quizScore, showQuizResults,
    spellingCards, currentSpellingIndex, spellingInput, setSpellingInput, spellingChecked, spellingCorrect,
    spellingScore, showSpellingResults, story, storyError, isGeneratingStory,
    languageDrillCards, currentLanguageDrillIndex, languageDrillCorrect, showLanguageDrillResults,
    isStartingQuiz, isStartingSpelling,
    startQuiz, selectQuizAnswer, nextQuizQuestion, startSpelling, checkSpelling, nextSpelling, startLanguageDrill, completeLanguageDrill, generateStory, startMatch, restartMatch, completeMatch, startShadowing,
    clearQuiz, clearSpelling, clearLanguageDrill, clearStory, reset,
  };
}

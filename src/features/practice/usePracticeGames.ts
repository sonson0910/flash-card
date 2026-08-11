import { useRef, useState, type FormEvent } from 'react';
import { playCorrectSound, playIncorrectSound, playWordAudio } from '../../lib/audio';
import { OperationTimeoutError, withTimeout } from '../../lib/async';
import { getProtectedFunctionUserMessage } from '../../lib/protectedFunctionsCapability';
import type { CardData } from '../../types/card';
import {
  createQuizQuestions,
  createSpellingQueue,
  isQuizAnswerCorrect,
  type QuizQuestion,
} from './practiceModel';

type PracticeView = 'quiz' | 'spelling' | 'story';
type PracticePreparation = 'quiz' | 'spelling' | 'story';

const PRACTICE_POOL_TIMEOUT_MS = 15_000;
const practicePoolTimeoutMessage = 'Preparing this activity took too long. Check your connection and try again.';

export function usePracticeGames({
  sessionToken,
  isSessionCurrent,
  loadPracticePool,
  addXp,
  openView,
  reportError,
  normalizeAnswer = value => typeof value === 'string' ? value.trim().toLocaleLowerCase() : '',
}: {
  sessionToken: number;
  isSessionCurrent: (token: number) => boolean;
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
  const quizSessionRef = useRef<number | null>(null);
  const spellingSessionRef = useRef<number | null>(null);
  const preparationRef = useRef<{
    id: symbol;
    mode: PracticePreparation;
    sessionToken: number;
  } | null>(null);

  const beginPreparation = (mode: PracticePreparation) => {
    if (preparationRef.current?.sessionToken === sessionToken) return null;
    const operation = { id: Symbol(mode), mode, sessionToken };
    preparationRef.current = operation;
    return operation;
  };

  const finishPreparation = (operation: NonNullable<typeof preparationRef.current>) => {
    if (preparationRef.current?.id !== operation.id) return;
    preparationRef.current = null;
    if (!isSessionCurrent(operation.sessionToken)) return;
    if (operation.mode === 'quiz') setIsStartingQuiz(false);
    if (operation.mode === 'spelling') setIsStartingSpelling(false);
    if (operation.mode === 'story') setIsGeneratingStory(false);
  };

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
    const operation = beginPreparation('quiz');
    if (!operation) return;
    setIsStartingQuiz(true);
    try {
      const cards = await loadPoolForPreparation();
      if (!isSessionCurrent(operation.sessionToken)) return;
      if (cards.length < 4) {
        reportError('You need at least 4 cards to start a quiz.');
        return;
      }
      setQuizQuestions(createQuizQuestions(cards, 10, Math.random, normalizeAnswer));
      setCurrentQuizIndex(0);
      setSelectedAnswer(null);
      setAnsweredCorrectly(null);
      setQuizScore(0);
      setShowQuizResults(false);
      quizAnswerLockedRef.current = false;
      quizSessionRef.current = operation.sessionToken;
      openView('quiz');
    } catch (error) {
      if (isSessionCurrent(operation.sessionToken)) reportPreparationFailure('the quiz', error);
    } finally {
      finishPreparation(operation);
    }
  };

  const selectQuizAnswer = (option: string) => {
    if (quizSessionRef.current !== sessionToken || !isSessionCurrent(sessionToken)) return;
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
    const answerSession = sessionToken;
    window.setTimeout(() => {
      if (isSessionCurrent(answerSession)) {
        playWordAudio(question.card.word, question.card.audioUrl);
      }
    }, 400);
  };

  const nextQuizQuestion = () => {
    if (quizSessionRef.current !== sessionToken || !isSessionCurrent(sessionToken)) return;
    if (currentQuizIndex < quizQuestions.length - 1) {
      setCurrentQuizIndex(previous => previous + 1);
      setSelectedAnswer(null);
      setAnsweredCorrectly(null);
      quizAnswerLockedRef.current = false;
      return;
    }
    setShowQuizResults(true);
    rememberPracticeActivity();
  };

  const startSpelling = async () => {
    const operation = beginPreparation('spelling');
    if (!operation) return;
    setIsStartingSpelling(true);
    try {
      const cards = await loadPoolForPreparation();
      if (!isSessionCurrent(operation.sessionToken)) return;
      if (cards.length < 4) {
        reportError('You need at least 4 cards for spelling practice.');
        return;
      }
      setSpellingCards(createSpellingQueue(cards));
      setCurrentSpellingIndex(0);
      setSpellingInput('');
      setSpellingChecked(false);
      setSpellingCorrect(false);
      setSpellingScore(0);
      setShowSpellingResults(false);
      spellingAnswerLockedRef.current = false;
      spellingSessionRef.current = operation.sessionToken;
      openView('spelling');
    } catch (error) {
      if (isSessionCurrent(operation.sessionToken)) reportPreparationFailure('spelling practice', error);
    } finally {
      finishPreparation(operation);
    }
  };

  const checkSpelling = (event: FormEvent) => {
    event.preventDefault();
    if (spellingSessionRef.current !== sessionToken || !isSessionCurrent(sessionToken)) return;
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
    const answerSession = sessionToken;
    window.setTimeout(() => {
      if (isSessionCurrent(answerSession)) {
        playWordAudio(card.word, card.audioUrl);
      }
    }, 400);
  };

  const nextSpelling = () => {
    if (spellingSessionRef.current !== sessionToken || !isSessionCurrent(sessionToken)) return;
    if (currentSpellingIndex < spellingCards.length - 1) {
      setCurrentSpellingIndex(previous => previous + 1);
      setSpellingInput('');
      setSpellingChecked(false);
      spellingAnswerLockedRef.current = false;
      return;
    }
    setShowSpellingResults(true);
    rememberPracticeActivity();
  };

  const generateStory = async () => {
    const operation = beginPreparation('story');
    if (!operation) return;
    setStory(null);
    setStoryError(null);
    setIsGeneratingStory(true);
    openView('story');
    try {
      const cards = await loadPoolForPreparation();
      if (!isSessionCurrent(operation.sessionToken)) return;
      if (cards.length === 0) {
        setStoryError('There are no suitable cards for an AI story yet. Add or sync some cards, then try again.');
        return;
      }
      const { generateStoryContext } = await import('../../lib/gemini');
      if (!isSessionCurrent(operation.sessionToken)) return;
      const learningCards = cards.filter(card => card.difficulty !== 'easy');
      const pool = learningCards.length >= 3 ? learningCards : cards;
      const selected = createSpellingQueue(pool, 5).map(card => card.word);
      const generatedStory = await generateStoryContext(selected);
      if (!isSessionCurrent(operation.sessionToken)) return;
      setStory(generatedStory);
    } catch (error) {
      if (!isSessionCurrent(operation.sessionToken)) return;
      console.error('Story generation failed.', error);
      setStoryError(error instanceof OperationTimeoutError
        ? error.message
        : getProtectedFunctionUserMessage(error)
          ?? 'Could not generate a story right now. Please try again.');
    } finally {
      finishPreparation(operation);
    }
  };

  const clearQuiz = () => {
    quizAnswerLockedRef.current = false;
    quizSessionRef.current = null;
    setQuizQuestions([]);
    setCurrentQuizIndex(0);
    setSelectedAnswer(null);
    setAnsweredCorrectly(null);
    setQuizScore(0);
    setShowQuizResults(false);
  };
  const clearSpelling = () => {
    spellingAnswerLockedRef.current = false;
    spellingSessionRef.current = null;
    setSpellingCards([]);
    setCurrentSpellingIndex(0);
    setSpellingInput('');
    setSpellingChecked(false);
    setSpellingCorrect(false);
    setSpellingScore(0);
    setShowSpellingResults(false);
  };
  const reset = () => {
    preparationRef.current = null;
    clearQuiz();
    clearSpelling();
    setStory(null);
    setStoryError(null);
    setIsGeneratingStory(false);
    setIsStartingQuiz(false);
    setIsStartingSpelling(false);
  };

  return {
    quizQuestions, currentQuizIndex, selectedAnswer, answeredCorrectly, quizScore, showQuizResults,
    spellingCards, currentSpellingIndex, spellingInput, setSpellingInput, spellingChecked, spellingCorrect,
    spellingScore, showSpellingResults, story, storyError, isGeneratingStory,
    isStartingQuiz, isStartingSpelling,
    startQuiz, selectQuizAnswer, nextQuizQuestion, startSpelling, checkSpelling, nextSpelling, generateStory,
    clearQuiz, clearSpelling, reset,
  };
}
const rememberPracticeActivity = () => {
  try { localStorage.setItem('lingoflash_last_active', new Date().toDateString()); }
  catch { /* gamification state remains available in memory */ }
};

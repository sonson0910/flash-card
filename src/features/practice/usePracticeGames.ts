import { useState, type FormEvent } from 'react';
import { playCorrectSound, playIncorrectSound, playWordAudio } from '../../lib/audio';
import type { CardData } from '../../types/card';
import { createQuizQuestions, createSpellingQueue, type QuizQuestion } from './practiceModel';

type PracticeView = 'quiz' | 'spelling' | 'story';

export function usePracticeGames({
  loadPracticePool,
  addXp,
  openView,
  reportError,
}: {
  loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  addXp: (amount: number) => void;
  openView: (view: PracticeView) => void;
  reportError: (message: string) => void;
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
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);

  const startQuiz = async () => {
    const cards = await loadPracticePool(50);
    if (cards.length < 4) {
      reportError('You need at least 4 cards to start a quiz.');
      return;
    }
    setQuizQuestions(createQuizQuestions(cards));
    setCurrentQuizIndex(0);
    setSelectedAnswer(null);
    setAnsweredCorrectly(null);
    setQuizScore(0);
    setShowQuizResults(false);
    openView('quiz');
  };

  const selectQuizAnswer = (option: string) => {
    if (selectedAnswer !== null) return;
    const question = quizQuestions[currentQuizIndex];
    if (!question) return;
    const correct = option.toLocaleLowerCase() === question.correctAnswer.toLocaleLowerCase();
    setSelectedAnswer(option);
    setAnsweredCorrectly(correct);
    if (correct) {
      setQuizScore(previous => previous + 1);
      addXp(5);
      playCorrectSound();
    } else {
      playIncorrectSound();
    }
    window.setTimeout(() => playWordAudio(question.card.word, question.card.audioUrl), 400);
  };

  const nextQuizQuestion = () => {
    if (currentQuizIndex < quizQuestions.length - 1) {
      setCurrentQuizIndex(previous => previous + 1);
      setSelectedAnswer(null);
      setAnsweredCorrectly(null);
      return;
    }
    setShowQuizResults(true);
    localStorage.setItem('lingoflash_last_active', new Date().toDateString());
  };

  const startSpelling = async () => {
    const cards = await loadPracticePool(50);
    if (cards.length < 4) {
      reportError('You need at least 4 cards for spelling practice.');
      return;
    }
    setSpellingCards(createSpellingQueue(cards));
    setCurrentSpellingIndex(0);
    setSpellingInput('');
    setSpellingChecked(false);
    setSpellingScore(0);
    setShowSpellingResults(false);
    openView('spelling');
  };

  const checkSpelling = (event: FormEvent) => {
    event.preventDefault();
    if (spellingChecked || !spellingInput.trim()) return;
    const card = spellingCards[currentSpellingIndex];
    if (!card) return;
    const correct = spellingInput.trim().toLocaleLowerCase() === card.word.toLocaleLowerCase();
    setSpellingCorrect(correct);
    setSpellingChecked(true);
    if (correct) {
      setSpellingScore(previous => previous + 1);
      addXp(5);
      playCorrectSound();
    } else {
      playIncorrectSound();
    }
    window.setTimeout(() => playWordAudio(card.word, card.audioUrl), 400);
  };

  const nextSpelling = () => {
    if (currentSpellingIndex < spellingCards.length - 1) {
      setCurrentSpellingIndex(previous => previous + 1);
      setSpellingInput('');
      setSpellingChecked(false);
      return;
    }
    setShowSpellingResults(true);
    localStorage.setItem('lingoflash_last_active', new Date().toDateString());
  };

  const generateStory = async () => {
    const cards = await loadPracticePool(50);
    if (cards.length === 0) {
      reportError('There are no suitable cards for an AI story yet.');
      return;
    }
    setIsGeneratingStory(true);
    openView('story');
    try {
      const { generateStoryContext } = await import('../../lib/gemini');
      const learningCards = cards.filter(card => card.difficulty !== 'easy');
      const pool = learningCards.length >= 3 ? learningCards : cards;
      const selected = createSpellingQueue(pool, 5).map(card => card.word);
      setStory(await generateStoryContext(selected));
    } catch (error) {
      console.error('Story generation failed.', error);
      setStory({ story: 'Could not generate a story right now.', translation: 'The translated story is unavailable right now.' });
    } finally {
      setIsGeneratingStory(false);
    }
  };

  const clearQuiz = () => setQuizQuestions([]);
  const clearSpelling = () => setSpellingCards([]);

  return {
    quizQuestions, currentQuizIndex, selectedAnswer, answeredCorrectly, quizScore, showQuizResults,
    spellingCards, currentSpellingIndex, spellingInput, setSpellingInput, spellingChecked, spellingCorrect,
    spellingScore, showSpellingResults, story, isGeneratingStory,
    startQuiz, selectQuizAnswer, nextQuizQuestion, startSpelling, checkSpelling, nextSpelling, generateStory,
    clearQuiz, clearSpelling,
  };
}

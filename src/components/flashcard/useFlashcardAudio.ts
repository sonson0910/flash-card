import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { cancelSpeech } from '../../lib/audio';
import { triggerHaptic } from '../../lib/haptics';

export interface FlashcardAudioOptions {
  readonly cardId: string;
  readonly word: string;
  readonly explanation: string;
  readonly audioUrl?: string | null;
}

export interface FlashcardAudioControlEvent {
  readonly stopPropagation: () => void;
}

export interface FlashcardAudioResult {
  readonly audioRef: RefObject<HTMLAudioElement | null>;
  readonly audioSpeed: 1.0 | 0.75;
  readonly isPlayingAudio: boolean;
  readonly pronunciationError: string | null;
  readonly setPronunciationError: (message: string | null) => void;
  readonly toggleAudioSpeed: (event: FlashcardAudioControlEvent) => void;
  readonly playAudio: (event: FlashcardAudioControlEvent) => void;
  readonly playExplanationAudio: (event: FlashcardAudioControlEvent) => void;
}

const unsupportedAudioMessage = 'Audio playback is not supported by this browser.';
const speechErrorMessage = 'Audio could not be played. Check this site’s audio permission and try again.';

const getSpeechSynthesis = (): SpeechSynthesis | null => (
  typeof window !== 'undefined'
  && 'speechSynthesis' in window
  && typeof SpeechSynthesisUtterance !== 'undefined'
    ? window.speechSynthesis
    : null
);

export function useFlashcardAudio({
  cardId,
  word,
  explanation,
  audioUrl,
}: FlashcardAudioOptions): FlashcardAudioResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const runIdRef = useRef(0);
  const fallbackRunRef = useRef<number | null>(null);
  const [audioSpeed, setAudioSpeed] = useState<1.0 | 0.75>(1.0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [pronunciationError, setPronunciationError] = useState<string | null>(null);

  const pauseAndResetNative = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // Some Safari streams cannot seek until their metadata is ready.
    }
    audio.onended = null;
    audio.onerror = null;
  }, []);

  const stopActiveRun = useCallback((resetState: boolean) => {
    runIdRef.current += 1;
    fallbackRunRef.current = null;
    pauseAndResetNative();
    if (utteranceRef.current) cancelSpeech();
    utteranceRef.current = null;
    if (resetState) {
      setIsPlayingAudio(false);
      setPronunciationError(null);
    }
  }, [pauseAndResetNative]);

  useLayoutEffect(() => {
    stopActiveRun(true);
    return () => stopActiveRun(false);
  }, [audioUrl, cardId, stopActiveRun]);

  const speakFallback = useCallback((text: string, runId: number) => {
    if (runIdRef.current !== runId) return;
    const speech = getSpeechSynthesis();
    if (!speech) {
      setIsPlayingAudio(false);
      setPronunciationError(unsupportedAudioMessage);
      return;
    }

    cancelSpeech();
    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = new SpeechSynthesisUtterance(text);
    } catch {
      setIsPlayingAudio(false);
      setPronunciationError(speechErrorMessage);
      return;
    }

    utterance.lang = 'en-US';
    utterance.rate = audioSpeed === 0.75 ? 0.65 : 0.9;
    utteranceRef.current = utterance;
    const finishSpeech = (failed = false) => {
      if (runIdRef.current !== runId || utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setIsPlayingAudio(false);
      if (failed) setPronunciationError(speechErrorMessage);
    };
    utterance.onend = () => finishSpeech();
    utterance.onerror = () => finishSpeech(true);

    try {
      speech.resume();
      // Keep this call inside the original click event. Safari can block delayed TTS.
      speech.speak(utterance);
    } catch {
      finishSpeech(true);
    }
  }, [audioSpeed]);

  const beginRun = useCallback((event: FlashcardAudioControlEvent, showPlayingState: boolean) => {
    event.stopPropagation();
    runIdRef.current += 1;
    fallbackRunRef.current = null;
    pauseAndResetNative();
    if (utteranceRef.current) cancelSpeech();
    utteranceRef.current = null;
    setPronunciationError(null);
    setIsPlayingAudio(showPlayingState);
    return runIdRef.current;
  }, [pauseAndResetNative]);

  const startSpeechFallback = useCallback((text: string, runId: number) => {
    if (runIdRef.current !== runId || fallbackRunRef.current === runId) return;
    fallbackRunRef.current = runId;
    pauseAndResetNative();
    speakFallback(text, runId);
  }, [pauseAndResetNative, speakFallback]);

  const playAudio = useCallback((event: FlashcardAudioControlEvent) => {
    const runId = beginRun(event, true);
    const audio = audioRef.current;
    if (!audio) {
      startSpeechFallback(word, runId);
      return;
    }

    try {
      audio.currentTime = 0;
      audio.playbackRate = audioSpeed;
    } catch {
      // Some Safari streams cannot seek until their metadata is ready.
    }
    audio.onended = () => {
      if (runIdRef.current !== runId) return;
      setIsPlayingAudio(false);
    };
    audio.onerror = () => startSpeechFallback(word, runId);
    const handleNativeFailure = (error: unknown) => {
      if (runIdRef.current !== runId || fallbackRunRef.current === runId) return;
      console.warn('Audio play failed, using web speech fallback:', error);
      startSpeechFallback(word, runId);
    };
    try {
      void Promise.resolve(audio.play()).catch(handleNativeFailure);
    } catch (error) {
      handleNativeFailure(error);
    }
  }, [audioSpeed, beginRun, startSpeechFallback, word]);

  const playExplanationAudio = useCallback((event: FlashcardAudioControlEvent) => {
    const runId = beginRun(event, false);
    startSpeechFallback(explanation, runId);
  }, [beginRun, explanation, startSpeechFallback]);

  const toggleAudioSpeed = useCallback((event: FlashcardAudioControlEvent) => {
    event.stopPropagation();
    triggerHaptic('light');
    setAudioSpeed(previous => previous === 1.0 ? 0.75 : 1.0);
  }, []);

  return {
    audioRef,
    audioSpeed,
    isPlayingAudio,
    pronunciationError,
    setPronunciationError,
    toggleAudioSpeed,
    playAudio,
    playExplanationAudio,
  };
}

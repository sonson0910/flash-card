import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { playWordAudio } from '../../lib/audio';
import { triggerHaptic } from '../../lib/haptics';

export interface FlashcardAudioOptions {
  readonly cardId: string;
  readonly word: string;
  readonly explanation: string;
  readonly speechLocale?: string;
  readonly voice?: SpeechSynthesisVoice;
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

export function useFlashcardAudio({ cardId, word, explanation, audioUrl, speechLocale, voice }: FlashcardAudioOptions): FlashcardAudioResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopPlaybackRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef(0);
  const [audioSpeed, setAudioSpeed] = useState<1.0 | 0.75>(1.0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [pronunciationError, setPronunciationError] = useState<string | null>(null);

  const stopActiveRun = useCallback(() => {
    runIdRef.current += 1;
    stopPlaybackRef.current?.();
    stopPlaybackRef.current = null;
    audioRef.current?.pause();
  }, []);
  useLayoutEffect(() => {
    stopActiveRun();
    setIsPlayingAudio(false);
    setPronunciationError(null);
    return stopActiveRun;
  }, [audioUrl, cardId, speechLocale, voice, stopActiveRun]);

  const play = useCallback((event: FlashcardAudioControlEvent, text: string, native: boolean) => {
    event.stopPropagation();
    stopActiveRun();
    const runId = runIdRef.current;
    setPronunciationError(null);
    setIsPlayingAudio(native);
    stopPlaybackRef.current = playWordAudio(text, native ? audioUrl ?? null : null, {
      speechLocale, voice,
      audio: native ? audioRef.current : null,
      speed: audioSpeed,
      onEnd: () => { if (runId === runIdRef.current) setIsPlayingAudio(false); },
      onError: message => { if (runId === runIdRef.current) setPronunciationError(message); },
    });
  }, [audioSpeed, audioUrl, speechLocale, voice, stopActiveRun]);
  const playAudio = useCallback((event: FlashcardAudioControlEvent) => play(event, word, true), [play, word]);
  const playExplanationAudio = useCallback((event: FlashcardAudioControlEvent) => play(event, explanation, false), [explanation, play]);
  const toggleAudioSpeed = useCallback((event: FlashcardAudioControlEvent) => {
    event.stopPropagation();
    triggerHaptic('light');
    setAudioSpeed(previous => previous === 1.0 ? 0.75 : 1.0);
  }, []);

  return { audioRef, audioSpeed, isPlayingAudio, pronunciationError, setPronunciationError,
    toggleAudioSpeed, playAudio, playExplanationAudio };
}

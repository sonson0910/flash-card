import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { scoreSpeechMatch } from '../../lib/speechMatch';
import type { SpeechMatchFeedbackValue } from './SpeechMatchFeedback';

type SpeechMatchTarget = 'word' | 'explanation';

interface SpeechRecognitionResultEvent {
  readonly results?: unknown;
}

interface SpeechRecognitionErrorEvent {
  readonly error?: unknown;
}

interface SpeechRecognitionSession {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionSession;

interface SpeechRecognitionEnvironment {
  readonly SpeechRecognition?: SpeechRecognitionConstructor;
  readonly webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export interface FlashcardSpeechMatchOptions {
  readonly cardId: string;
  readonly word: string;
  readonly explanation: string;
  readonly onPronunciationError: (message: string | null) => void;
}

export interface FlashcardSpeechMatchControlEvent {
  readonly stopPropagation: () => void;
}

export interface FlashcardSpeechMatchResult {
  readonly isRecording: boolean;
  readonly recordingTarget: SpeechMatchTarget | null;
  readonly pronunciationScore: SpeechMatchFeedbackValue | null;
  readonly startPronunciationCheck: (
    event: FlashcardSpeechMatchControlEvent,
    targetType?: SpeechMatchTarget,
  ) => void;
}

const unsupportedSpeechMessage = 'This browser does not support speech recognition. Try Google Chrome.';
const deniedSpeechMessage = 'Microphone access is blocked. Allow microphone access for this site, then try again.';
const genericSpeechMessage = 'Speech could not be recognised. Check microphone permission and try again.';
const startSpeechMessage = 'The microphone could not start. Check permission and try again.';

const getSpeechRecognition = (): SpeechRecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  const environment = window as unknown as SpeechRecognitionEnvironment;
  return environment.SpeechRecognition ?? environment.webkitSpeechRecognition ?? null;
};

const normalizeTranscript = (value: string) => value
  .toLowerCase()
  .replace(/[.,?!:;'"()\-]/g, '')
  .trim();

const getFinalTranscript = (event: SpeechRecognitionResultEvent | null | undefined) => {
  if (!event || typeof event !== 'object') return null;
  const results = event.results;
  if (!results || typeof results !== 'object') return null;

  const result = (results as { readonly [index: number]: unknown })[0];
  if (!result || typeof result !== 'object') return null;
  if ((result as { readonly isFinal?: unknown }).isFinal !== true) return null;

  const alternative = (result as { readonly [index: number]: unknown })[0];
  if (!alternative || typeof alternative !== 'object') return null;
  const transcript = (alternative as { readonly transcript?: unknown }).transcript;
  if (typeof transcript !== 'string') return null;

  const normalizedTranscript = normalizeTranscript(transcript);
  if (!normalizedTranscript) return null;

  const rawConfidence = Number((alternative as { readonly confidence?: unknown }).confidence ?? 0.75);
  return {
    transcript: normalizedTranscript,
    confidence: Number.isFinite(rawConfidence) ? rawConfidence : 0.75,
  };
};

const getSpeechError = (event: SpeechRecognitionErrorEvent | null | undefined) => (
  typeof event?.error === 'string' ? event.error.toLowerCase() : ''
);

export function useFlashcardSpeechMatch({
  cardId,
  word,
  explanation,
  onPronunciationError,
}: FlashcardSpeechMatchOptions): FlashcardSpeechMatchResult {
  const recognitionRef = useRef<SpeechRecognitionSession | null>(null);
  const runIdRef = useRef(0);
  const cardIdRef = useRef(cardId);
  cardIdRef.current = cardId;
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTarget, setRecordingTarget] = useState<SpeechMatchTarget | null>(null);
  const [pronunciationScore, setPronunciationScore] = useState<SpeechMatchFeedbackValue | null>(null);

  const invalidateRecognition = useCallback((resetState: boolean) => {
    runIdRef.current += 1;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.abort();
    } catch {
      // Browser implementations may throw after recognition has already ended.
    }
    if (resetState) {
      setIsRecording(false);
      setRecordingTarget(null);
      setPronunciationScore(null);
      onPronunciationError(null);
    }
  }, [onPronunciationError]);

  useLayoutEffect(() => {
    invalidateRecognition(true);
    return () => invalidateRecognition(false);
  }, [cardId, explanation, invalidateRecognition, word]);

  const startPronunciationCheck = useCallback((
    event: FlashcardSpeechMatchControlEvent,
    requestedTarget: SpeechMatchTarget = 'word',
  ) => {
    event.stopPropagation();
    const targetType = requestedTarget === 'explanation' ? 'explanation' : 'word';
    invalidateRecognition(true);
    const runId = runIdRef.current;
    const sessionCardId = cardId;
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      onPronunciationError(unsupportedSpeechMessage);
      return;
    }

    let recognition: SpeechRecognitionSession;
    try {
      recognition = new Recognition();
    } catch (error) {
      console.error('Could not start speech recognition', error);
      onPronunciationError(startSpeechMessage);
      return;
    }

    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const isCurrentSession = () => (
      runIdRef.current === runId
      && cardIdRef.current === sessionCardId
      && recognitionRef.current === recognition
    );
    const clearSession = () => {
      if (!isCurrentSession()) return false;
      recognitionRef.current = null;
      setIsRecording(false);
      setRecordingTarget(null);
      return true;
    };

    recognition.onstart = () => {
      if (!isCurrentSession()) return;
      onPronunciationError(null);
      setIsRecording(true);
      setRecordingTarget(targetType);
      setPronunciationScore(null);
    };

    recognition.onresult = eventValue => {
      if (!isCurrentSession()) return;
      const parsed = getFinalTranscript(eventValue);
      if (!parsed) return;
      const targetText = targetType === 'word' ? word : explanation;
      const match = scoreSpeechMatch(targetText, parsed.transcript, parsed.confidence);
      setPronunciationScore({
        score: match.score,
        confidence: match.confidence,
        transcript: parsed.transcript,
        type: targetType,
      });
    };

    recognition.onerror = eventValue => {
      if (!clearSession()) return;
      console.error('Speech recognition error', eventValue?.error);
      const error = getSpeechError(eventValue);
      onPronunciationError(
        error === 'not-allowed' || error === 'service-not-allowed'
          ? deniedSpeechMessage
          : genericSpeechMessage,
      );
    };

    recognition.onend = () => {
      clearSession();
    };

    setIsRecording(true);
    setRecordingTarget(targetType);
    try {
      recognition.start();
    } catch (error) {
      console.error('Could not start speech recognition', error);
      if (!clearSession()) return;
      onPronunciationError(startSpeechMessage);
    }
  }, [cardId, explanation, invalidateRecognition, onPronunciationError, word]);

  return {
    isRecording,
    recordingTarget,
    pronunciationScore,
    startPronunciationCheck,
  };
}

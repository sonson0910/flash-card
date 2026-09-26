import { ChevronLeft, ChevronRight, Mic, MicOff, Sparkles, Volume2, X } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { playWordAudio, type WordAudioPlayback } from '../../lib/audio';
import { triggerConfetti } from '../../lib/confetti';
import { triggerHaptic } from '../../lib/haptics';
import { playRewardSound } from '../../lib/interactionSounds';
import { speechLocaleFor } from '../../lib/speechLocale';
import { scoreSpeechMatch, type SpeechMatchResult } from '../../lib/speechMatch';
import type { CardData } from '../../types/card';

interface ShadowingViewProps {
  cards: CardData[];
  onClose: () => void;
  onAddXp?: (amount: number) => void;
}

export function ShadowingView({ cards, onClose, onAddXp }: ShadowingViewProps) {
  const { _ } = useLingui();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [matchResult, setMatchResult] = useState<SpeechMatchResult | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);
  const audioPlaybackRef = useRef<WordAudioPlayback | null>(null);
  const finalizedRecognitionRef = useRef<unknown>(null);

  const card = cards[currentIndex];
  const targetSentence = card?.exampleSentence || card?.word || '';

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    finalizedRecognitionRef.current = null;
    if (recognition) {
      try {
        recognition.stop();
      } catch {}
      try {
        recognition.abort?.();
      } catch {}
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    stopListening();
    setSpeechError(null);
    setTranscript('');
    setMatchResult(null);

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechError(_(msg({ id: 'practice.shadowing.unsupported', message: 'This browser does not support speech recognition.' })));
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      finalizedRecognitionRef.current = null;
      recognition.lang = speechLocaleFor(card);
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (recognitionRef.current !== recognition) return;
        setIsListening(true);
        triggerHaptic('medium');
      };

      recognition.onresult = (event: any) => {
        if (recognitionRef.current !== recognition) return;
        const currentTranscript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setTranscript(currentTranscript);

        if (event.results[0].isFinal && finalizedRecognitionRef.current !== recognition) {
          finalizedRecognitionRef.current = recognition;
          const confidence = event.results[0][0].confidence || 0.8;
          const evaluated = scoreSpeechMatch(targetSentence, currentTranscript, confidence);
          setMatchResult(evaluated);

          if (evaluated.score >= 80) {
            playRewardSound();
            triggerConfetti(0.5, 0.5);
            triggerHaptic('success');
            onAddXp?.(10);
          } else {
            triggerHaptic('warning');
          }
        }
      };

      recognition.onerror = (e: any) => {
        if (recognitionRef.current !== recognition) return;
        if (e.error !== 'no-speech') {
          setSpeechError(_(msg({ id: 'practice.shadowing.error', message: 'Speech recognition error: {error}' }).id, { error: e.error }));
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setSpeechError(_(msg({ id: 'practice.shadowing.microphone-error', message: 'Unable to open the microphone. Please grant microphone access in your browser.' })));
      setIsListening(false);
    }
  }, [_, card, targetSentence, onAddXp, stopListening]);

  useEffect(() => {
    return () => {
      stopListening();
      audioPlaybackRef.current?.cancel();
    };
  }, [stopListening]);

  const playPronunciation = () => {
    audioPlaybackRef.current?.cancel();
    audioPlaybackRef.current = playWordAudio(card.word, card.audioUrl, speechLocaleFor(card));
  };

  const close = () => {
    stopListening();
    audioPlaybackRef.current?.cancel();
    onClose();
  };

  const move = (nextIndex: number) => {
    stopListening();
    audioPlaybackRef.current?.cancel();
    setMatchResult(null);
    setTranscript('');
    setCurrentIndex(nextIndex);
  };

  if (!card) return null;

  const targetWords = targetSentence.split(' ');
  const targetLanguage = card.language || 'en';
  const nativeLanguage = card.translationLanguage || 'vi';

  return (
    <div className="practice-board practice-board--shadowing mx-auto flex h-full max-w-6xl flex-col px-1 py-3 sm:px-4 sm:py-6">
      <div className="mb-7 flex w-full items-center justify-between gap-3">
        <button
          type="button"
          onClick={close}
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-control)] text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
          aria-label={_(msg({ id: 'practice.shadowing.close', message: 'Close shadowing practice' }))}
        >
          <X size={24} />
        </button>
        <span className="min-w-0 flex-1 truncate text-center font-display text-xs font-black uppercase tracking-[.14em] text-[var(--sf-text-muted)]">
          <Trans id="practice.shadowing.title" message="Shadowing · say it after me" /> · {currentIndex + 1} / {cards.length}
        </span>
        <div className="size-11" />
      </div>

      <section className="mx-auto w-full max-w-5xl text-center">
        <div className="relative">
          <p className="mb-3 font-display text-xs font-black uppercase tracking-[.14em] text-[var(--sf-text-muted)]">
            <Trans id="practice.shadowing.focus-word" message="Focus word" />{' '}
            <span lang={targetLanguage} className="text-[var(--sf-brand-text)]">{card.word}</span>
          </p>
          <h2 lang={targetLanguage} className="mx-auto max-w-4xl text-balance font-serif text-3xl font-bold leading-tight tracking-tight text-[var(--sf-text)] sm:text-5xl">
            {targetSentence}
          </h2>
          <button
            type="button"
            onClick={playPronunciation}
            className="mx-auto mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 text-sm font-bold text-[var(--sf-brand-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
            aria-label={_(msg({ id: 'practice.shadowing.play-pronunciation', message: 'Play pronunciation for {word}' }).id, { word: card.word })}
          >
            <Volume2 size={16} aria-hidden="true" /> <Trans id="practice.shadowing.listen" message="Listen" />
          </button>
        </div>

        {card.phonetic && (
          <p lang={targetLanguage} className="mt-3 font-mono text-sm font-semibold text-[var(--sf-text-muted)]">
            {card.phonetic}
          </p>
        )}

        <div className="mt-8 border-y border-[var(--sf-border)] bg-[color-mix(in_srgb,var(--sf-surface-raised)_72%,transparent)] p-4 sm:mx-auto sm:max-w-3xl sm:rounded-2xl sm:border">
          <div lang={targetLanguage} className="flex flex-wrap items-center justify-center gap-1.5 text-base font-semibold leading-relaxed sm:text-lg">
            {targetWords.map((w, i) => {
              const cleanWord = w.toLowerCase().replace(/[^a-z0-9]/g, '');
              const isMatched = matchResult?.matchedWords.includes(cleanWord);
              return (
                <span
                  key={i}
                  className={`rounded-md px-1.5 py-0.5 transition-colors motion-reduce:transition-none ${
                    matchResult
                      ? isMatched
                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 font-bold'
                        : 'bg-rose-500/20 text-rose-600 dark:text-rose-300'
                      : 'text-[var(--sf-text)]'
                  }`}
                >
                  {w}
                </span>
              );
            })}
          </div>
          {card.exampleTranslation && (
            <p lang={nativeLanguage} className="mt-3 text-xs text-[var(--sf-text-muted)]">
              {card.exampleTranslation}
            </p>
          )}
        </div>

        {transcript && (
          <div lang={targetLanguage} className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--sf-brand)_30%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,var(--sf-surface))] p-3 text-xs text-[var(--sf-brand-text)]">
            <span className="font-bold"><Trans id="practice.shadowing.you-said" message="You said:" /> </span>"{transcript}"
          </div>
        )}

        {matchResult && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <div className="flex items-center gap-1.5 rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-black text-emerald-600 dark:text-emerald-300">
              <Sparkles size={16} />
              <span><Trans id="practice.shadowing.accuracy" message="Accuracy: {score}%" values={{ score: matchResult.score }} /></span>
            </div>
            {matchResult.score >= 80 && (
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                <Trans id="practice.shadowing.success" message="Nice pronunciation" />
              </span>
            )}
          </div>
        )}

        {speechError && (
          <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-600 dark:text-rose-300">
            {speechError}
          </p>
        )}

        <div className="mt-7 flex justify-center">
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            className={`group relative flex size-20 items-center justify-center rounded-full text-white shadow-2xl transition-[background-color,box-shadow,transform] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-4 motion-reduce:transition-none ${
              isListening
                ? 'bg-rose-600 ring-8 ring-rose-500/30 motion-safe:animate-pulse'
                : 'bg-[var(--sf-brand)] hover:scale-105 shadow-[var(--sf-shadow)]'
            }`}
            aria-label={isListening ? _(msg({ id: 'practice.shadowing.stop-recording', message: 'Stop recording' })) : _(msg({ id: 'practice.shadowing.start-reading', message: 'Start reading' }))}
          >
            {isListening ? <MicOff size={32} /> : <Mic size={32} />}
          </button>
        </div>
        <p className="mt-3 text-xs font-bold text-[var(--sf-text-muted)]">
          {isListening ? <Trans id="practice.shadowing.listening" message="Listening…" /> : <Trans id="practice.shadowing.start-copy" message="Tap the microphone and read the sentence." />}
        </p>
      </section>

      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => move(Math.max(0, currentIndex - 1))}
          disabled={currentIndex === 0}
          className="flex size-12 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 motion-reduce:transition-none"
          aria-label={_(msg({ id: 'practice.shadowing.previous', message: 'Previous word' }))}
        >
          <ChevronLeft size={20} />
        </button>
        <span className="font-mono text-xs font-bold tabular-nums text-[var(--sf-text-muted)]">
          {currentIndex + 1} / {cards.length}
        </span>
        <button
          type="button"
          onClick={() => move(Math.min(cards.length - 1, currentIndex + 1))}
          disabled={currentIndex === cards.length - 1}
          className="flex size-12 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 motion-reduce:transition-none"
          aria-label={_(msg({ id: 'practice.shadowing.next', message: 'Next word' }))}
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}

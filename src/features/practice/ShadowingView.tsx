import { ChevronLeft, ChevronRight, Mic, MicOff, Sparkles, Volume2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { playWordAudio } from '../../lib/audio';
import { triggerConfetti } from '../../lib/confetti';
import { triggerHaptic } from '../../lib/haptics';
import { playRewardSound } from '../../lib/interactionSounds';
import { scoreSpeechMatch, type SpeechMatchResult } from '../../lib/speechMatch';
import type { CardData } from '../../types/card';

interface ShadowingViewProps {
  cards: CardData[];
  onClose: () => void;
  onAddXp?: (amount: number) => void;
}

export function ShadowingView({ cards, onClose, onAddXp }: ShadowingViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [matchResult, setMatchResult] = useState<SpeechMatchResult | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  const card = cards[currentIndex];
  const targetSentence = card?.exampleSentence || card?.word || '';

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    setSpeechError(null);
    setTranscript('');
    setMatchResult(null);

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechError('This browser does not support Web Speech recognition.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        triggerHaptic('medium');
      };

      recognition.onresult = (event: any) => {
        const currentTranscript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setTranscript(currentTranscript);

        if (event.results[0].isFinal) {
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
        if (e.error !== 'no-speech') {
          setSpeechError(`Speech recognition error: ${e.error}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setSpeechError('Unable to open the microphone. Please grant microphone access in your browser.');
      setIsListening(false);
    }
  }, [targetSentence, onAddXp]);

  useEffect(() => {
    return () => stopListening();
  }, [stopListening]);

  if (!card) return null;

  const targetWords = targetSentence.split(' ');

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center py-4 sm:py-6">
      {/* Top Bar */}
      <div className="mb-6 flex w-full items-center justify-between px-2">
        <button
          type="button"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-full p-2 text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)]"
          aria-label="Close speech match practice"
        >
          <X size={24} />
        </button>
        <span className="text-xs font-black uppercase tracking-wider text-[var(--sf-text-muted)]">
          Shadowing Arena · {currentIndex + 1} / {cards.length}
        </span>
        <div className="size-11" />
      </div>

      {/* Target Card Display */}
      <div className="w-full rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-center shadow-xl sm:p-8">
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-3xl font-black text-[var(--sf-text)] tracking-tight sm:text-4xl">
            {card.word}
          </h2>
          <button
            type="button"
            onClick={() => playWordAudio(card.word, card.audioUrl)}
            className="flex size-9 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)] hover:scale-105 active:scale-95 transition-all"
            aria-label={`Play pronunciation for ${card.word}`}
          >
            <Volume2 size={16} />
          </button>
        </div>

        {card.phonetic && (
          <p className="mt-1 font-mono text-sm font-semibold text-[var(--sf-text-muted)]">
            {card.phonetic}
          </p>
        )}

        {/* Example Sentence with Colored Breakdown */}
        <div className="mt-6 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-5">
          <p className="text-xs font-black uppercase tracking-wider text-[var(--sf-text-muted)] mb-3">
            Shadowing sentence
          </p>
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-base sm:text-lg font-semibold leading-relaxed">
            {targetWords.map((w, i) => {
              const cleanWord = w.toLowerCase().replace(/[^a-z0-9]/g, '');
              const isMatched = matchResult?.matchedWords.includes(cleanWord);
              return (
                <span
                  key={i}
                  className={`rounded-md px-1.5 py-0.5 transition-colors ${
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
            <p className="mt-3 text-xs text-[var(--sf-text-muted)]">
              {card.exampleTranslation}
            </p>
          )}
        </div>

        {/* Live Transcript / Score Gauge */}
        {transcript && (
          <div className="mt-4 rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3 text-xs text-cyan-700 dark:text-cyan-300">
            <span className="font-bold">You said: </span>"{transcript}"
          </div>
        )}

        {matchResult && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <div className="flex items-center gap-1.5 rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-black text-emerald-600 dark:text-emerald-300">
              <Sparkles size={16} />
              <span>Sentence match: {matchResult.score}%</span>
            </div>
            {matchResult.score >= 80 && (
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                Excellent speech match! 🎉
              </span>
            )}
          </div>
        )}

        <p className="mt-4 max-w-md text-[11px] font-medium leading-relaxed text-[var(--sf-text-muted)]">
          The browser checks whether the intended words were recognised; it does not assess individual sounds, phonemes, or accent.
        </p>
        <p className="mt-2 max-w-md text-[11px] font-medium leading-relaxed text-[var(--sf-text-muted)]">
          Pronunciation assessment is unavailable in this build; browser transcript matching remains available.
        </p>

        {speechError && (
          <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-600 dark:text-rose-300">
            {speechError}
          </p>
        )}

        {/* Big Mic Button */}
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            className={`group relative flex size-20 items-center justify-center rounded-full text-white shadow-2xl transition-all active:scale-95 ${
              isListening
                ? 'bg-rose-600 ring-8 ring-rose-500/30 animate-pulse'
                : 'bg-gradient-to-tr from-cyan-500 to-blue-600 hover:scale-105 shadow-cyan-500/30'
            }`}
            aria-label={isListening ? 'Stop recording' : 'Start reading'}
          >
            {isListening ? <MicOff size={32} /> : <Mic size={32} />}
          </button>
        </div>
        <p className="mt-3 text-xs font-bold text-[var(--sf-text-muted)]">
          {isListening ? 'Listening…' : 'Tap the mic to start reading'}
        </p>
      </div>

      {/* Navigation Arrows */}
      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => {
            stopListening();
            setMatchResult(null);
            setTranscript('');
            setCurrentIndex(Math.max(0, currentIndex - 1));
          }}
          disabled={currentIndex === 0}
          className="flex size-12 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] disabled:opacity-50"
          aria-label="Previous word"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="font-mono text-xs font-bold tabular-nums text-[var(--sf-text-muted)]">
          {currentIndex + 1} / {cards.length}
        </span>
        <button
          type="button"
          onClick={() => {
            stopListening();
            setMatchResult(null);
            setTranscript('');
            setCurrentIndex(Math.min(cards.length - 1, currentIndex + 1));
          }}
          disabled={currentIndex === cards.length - 1}
          className="flex size-12 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] disabled:opacity-50"
          aria-label="Next word"
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}

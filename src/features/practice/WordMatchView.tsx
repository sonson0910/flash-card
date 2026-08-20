import { Flame, RotateCcw, Timer, Trophy, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playCorrectSound, playIncorrectSound } from '../../lib/audio';
import { triggerConfetti } from '../../lib/confetti';
import { triggerHaptic } from '../../lib/haptics';
import { playRewardSound } from '../../lib/interactionSounds';
import type { CardData } from '../../types/card';

interface WordMatchViewProps {
  cards: CardData[];
  onClose: () => void;
  onAddXp?: (amount: number) => void;
}

interface MatchTile {
  id: string;
  cardId: string;
  type: 'word' | 'translation';
  text: string;
}

const GAME_DURATION_SECONDS = 60;
const PAIRS_PER_ROUND = 6;

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function WordMatchView({ cards, onClose, onAddXp }: WordMatchViewProps) {
  const [roundKey, setRoundKey] = useState(0);
  const [selectedTile, setSelectedTile] = useState<MatchTile | null>(null);
  const [matchedIds, setMatchedIds] = useState<Set<string>>(new Set());
  const [mismatchedIds, setMismatchedIds] = useState<Set<string>>(new Set());
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_SECONDS);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isVictory, setIsVictory] = useState(false);
  const [matchesCount, setMatchesCount] = useState(0);
  const lockSelectionRef = useRef(false);

  // Generate 12 tiles (6 English, 6 Vietnamese)
  const tiles: MatchTile[] = useMemo(() => {
    const validCards = cards.filter(c => c.word && c.translation);
    const pool = shuffleArray(validCards).slice(0, PAIRS_PER_ROUND);

    const generated: MatchTile[] = [];
    pool.forEach(card => {
      generated.push({
        id: `${card.id}-word`,
        cardId: card.id,
        type: 'word',
        text: card.word,
      });
      generated.push({
        id: `${card.id}-trans`,
        cardId: card.id,
        type: 'translation',
        text: card.translation,
      });
    });

    return shuffleArray(generated);
  }, [cards, roundKey]);

  // Timer countdown
  useEffect(() => {
    if (isGameOver || isVictory) return;
    const timer = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setIsGameOver(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isGameOver, isVictory]);

  const handleTileClick = useCallback(
    (tile: MatchTile) => {
      if (
        lockSelectionRef.current ||
        matchedIds.has(tile.id) ||
        isGameOver ||
        isVictory
      ) {
        return;
      }

      // If clicking the same tile, deselect
      if (selectedTile?.id === tile.id) {
        setSelectedTile(null);
        return;
      }

      // First tile of pair
      if (!selectedTile) {
        setSelectedTile(tile);
        triggerHaptic('light');
        return;
      }

      // Second tile clicked - check match
      lockSelectionRef.current = true;

      // Cannot match two of same type (e.g. 2 English words)
      if (selectedTile.type !== tile.type && selectedTile.cardId === tile.cardId) {
        // MATCH!
        playCorrectSound();
        triggerHaptic('success');
        const nextMatched = new Set(matchedIds);
        nextMatched.add(selectedTile.id);
        nextMatched.add(tile.id);
        setMatchedIds(nextMatched);
        setMatchesCount(prev => prev + 1);
        setSelectedTile(null);
        lockSelectionRef.current = false;

        // Check Victory
        if (nextMatched.size === tiles.length) {
          setIsVictory(true);
          playRewardSound();
          triggerConfetti(0.5, 0.5);
          onAddXp?.(20);
        }
      } else {
        // MISMATCH!
        playIncorrectSound();
        triggerHaptic('warning');
        setMismatchedIds(new Set([selectedTile.id, tile.id]));

        setTimeout(() => {
          setMismatchedIds(new Set());
          setSelectedTile(null);
          lockSelectionRef.current = false;
        }, 500);
      }
    },
    [selectedTile, matchedIds, isGameOver, isVictory, tiles.length, onAddXp]
  );

  const restartGame = () => {
    setRoundKey(prev => prev + 1);
    setSelectedTile(null);
    setMatchedIds(new Set());
    setMismatchedIds(new Set());
    setTimeLeft(GAME_DURATION_SECONDS);
    setIsGameOver(false);
    setIsVictory(false);
    setMatchesCount(0);
    lockSelectionRef.current = false;
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center py-4 sm:py-6">
      {/* Top Bar */}
      <div className="mb-6 flex w-full items-center justify-between px-2">
        <button
          type="button"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-full p-2 text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)]"
          aria-label="Close game"
        >
          <X size={24} />
        </button>

        {/* Timer Pill */}
        <div
          className={`flex items-center gap-2 rounded-2xl border px-4 py-2 font-mono text-sm font-black tabular-nums transition-colors ${
            timeLeft <= 10
              ? 'border-rose-400 bg-rose-500/15 text-rose-600 dark:text-rose-400 animate-pulse'
              : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)]'
          }`}
        >
          <Timer size={16} className={timeLeft <= 10 ? 'text-rose-500' : 'text-[var(--sf-brand-text)]'} />
          <span>{timeLeft}s</span>
        </div>

        {/* Score badge */}
        <div className="flex items-center gap-1.5 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-2 text-xs font-black text-amber-600 dark:text-amber-300">
          <Flame size={15} className="text-amber-500" />
          <span>{matchesCount} / {PAIRS_PER_ROUND}</span>
        </div>
      </div>

      <div className="mb-4 text-center">
        <h2 className="text-xl font-black tracking-tight text-[var(--sf-text)] sm:text-2xl">
          Word Match Speed-Run
        </h2>
        <p className="mt-1 text-xs text-[var(--sf-text-muted)]">
          Match each English word with its Vietnamese meaning before time runs out!
        </p>
      </div>

      {/* Game Grid */}
      {!isGameOver && !isVictory ? (
        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-3.5">
          {tiles.map(tile => {
            const isMatched = matchedIds.has(tile.id);
            const isSelected = selectedTile?.id === tile.id;
            const isMismatched = mismatchedIds.has(tile.id);

            if (isMatched) {
              return (
                <div
                  key={tile.id}
                  className="flex min-h-20 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-3 opacity-30 pointer-events-none scale-95 transition-all"
                >
                  <span className="text-xs font-bold text-emerald-600 line-through">
                    {tile.text}
                  </span>
                </div>
              );
            }

            return (
              <button
                key={tile.id}
                type="button"
                onClick={() => handleTileClick(tile)}
                className={`flex min-h-20 items-center justify-center rounded-2xl border p-3 text-center text-xs font-bold transition-all active:scale-95 sm:text-sm ${
                  isMismatched
                    ? 'border-rose-400 bg-rose-500/20 text-rose-600 dark:text-rose-300 animate-shake'
                    : isSelected
                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 shadow-md ring-2 ring-cyan-400'
                      : 'border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text)] shadow-xs hover:border-[var(--sf-brand)] hover:bg-[var(--sf-surface-raised)]'
                }`}
              >
                <span className="break-words line-clamp-3 leading-snug">
                  {tile.text}
                </span>
              </button>
            );
          })}
        </div>
      ) : isVictory ? (
        /* Victory Screen */
        <div className="w-full rounded-[32px] border border-emerald-400/40 bg-[var(--sf-surface)] p-6 text-center shadow-xl sm:p-8">
          <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-lg shadow-emerald-500/30">
            <Trophy size={32} />
          </div>
          <h3 className="mt-4 text-2xl font-black text-[var(--sf-text)]">
            Excellent! Board complete 🎉
          </h3>
          <p className="mt-1 text-sm text-[var(--sf-text-muted)]">
            You matched all {PAIRS_PER_ROUND} pairs in just {GAME_DURATION_SECONDS - timeLeft} seconds!
          </p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-2.5 text-sm font-black text-amber-600 dark:text-amber-300">
            <Zap size={18} className="text-amber-500" />
            <span>+20 XP Speed bonus</span>
          </div>

          <div className="mt-8 flex justify-center gap-3">
            <button
              type="button"
              onClick={restartGame}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--sf-brand)] px-6 text-xs font-bold text-[var(--sf-on-brand)] shadow-md transition-all hover:bg-[var(--sf-brand-hover)] active:scale-95"
            >
              <RotateCcw size={16} />
              <span>Play a new round</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-12 items-center justify-center rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-6 text-xs font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]"
            >
              <span>Back</span>
            </button>
          </div>
        </div>
      ) : (
        /* Game Over Screen */
        <div className="w-full rounded-[32px] border border-rose-400/30 bg-[var(--sf-surface)] p-6 text-center shadow-xl sm:p-8">
          <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-rose-500/15 text-rose-500">
            <Timer size={32} />
          </div>
          <h3 className="mt-4 text-2xl font-black text-[var(--sf-text)]">
            Time is up! ⏰
          </h3>
          <p className="mt-1 text-sm text-[var(--sf-text-muted)]">
            You matched {matchesCount} / {PAIRS_PER_ROUND} pairs.
          </p>

          <div className="mt-8 flex justify-center gap-3">
            <button
              type="button"
              onClick={restartGame}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--sf-brand)] px-6 text-xs font-bold text-[var(--sf-on-brand)] shadow-md transition-all hover:bg-[var(--sf-brand-hover)] active:scale-95"
            >
              <RotateCcw size={16} />
              <span>Try again</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-12 items-center justify-center rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-6 text-xs font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]"
            >
              <span>Back</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

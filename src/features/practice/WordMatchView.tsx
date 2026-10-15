import { Flame, RotateCcw, Timer, Trophy, X, Zap } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playCorrectSound, playIncorrectSound } from '../../lib/audio';
import { triggerConfetti } from '../../lib/confetti';
import { triggerHaptic } from '../../lib/haptics';
import { playRewardSound } from '../../lib/interactionSounds';
import type { CardData } from '../../types/card';
import { useFocusModePreference } from '../settings/focus-mode-preference';
import { createWordMatchRound } from './practiceModel';

interface WordMatchViewProps {
  cards: CardData[];
  onClose: () => void;
  onComplete?: (pairs: Array<{ cardId: string; word: string; translation: string }>) =>
    | { awardedXp: number }
    | null
    | void
    | Promise<{ awardedXp: number } | null | void>;
  onNewRound?: () => boolean | void | Promise<boolean | void>;
  /** Compatibility input; XP is only awarded by the completed server session. */
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
const retryActionClass = 'mt-3 min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 text-xs font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';
const secondaryActionClass = 'flex min-h-12 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-6 text-xs font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function WordMatchView({ cards, onClose, onComplete, onNewRound }: WordMatchViewProps) {
  const { _, i18n } = useLingui();
  const { focusModeEnabled } = useFocusModePreference();
  const [roundKey, setRoundKey] = useState(0);
  const [selectedTile, setSelectedTile] = useState<MatchTile | null>(null);
  const [matchedIds, setMatchedIds] = useState<Set<string>>(new Set());
  const [mismatchedIds, setMismatchedIds] = useState<Set<string>>(new Set());
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_SECONDS);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isVictory, setIsVictory] = useState(false);
  const [matchesCount, setMatchesCount] = useState(0);
  const [completionStatus, setCompletionStatus] = useState<'idle' | 'verifying' | 'confirmed' | 'failed' | 'unavailable' | 'new-round-failed'>('idle');
  const [awardedXp, setAwardedXp] = useState(0);
  const [isStartingNewRound, setIsStartingNewRound] = useState(false);
  const lockSelectionRef = useRef(false);
  const matchedCardIdsRef = useRef(new Set<string>());
  const completionReportedRef = useRef(false);
  const completionPairsRef = useRef<Array<{ cardId: string; word: string; translation: string }>>([]);
  const roundGenerationRef = useRef(0);
  const isMountedRef = useRef(true);

  // Generate paired target words and native meanings.
  const tiles: MatchTile[] = useMemo(() => {
    const pool = createWordMatchRound(cards, PAIRS_PER_ROUND);

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
  const pairCount = tiles.length / 2;
  const targetLanguage = cards[0]?.language || 'en';
  const nativeLanguage = cards[0]?.translationLanguage || 'vi';
  const languageNames = new Intl.DisplayNames([i18n.locale], { type: 'language' });
  const targetLanguageName = languageNames.of(targetLanguage) || targetLanguage;
  const nativeLanguageName = languageNames.of(nativeLanguage) || nativeLanguage;

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
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const submitCompletion = useCallback(async (pairs: Array<{ cardId: string; word: string; translation: string }>) => {
    const roundGeneration = roundGenerationRef.current;
    if (!onComplete) {
      setCompletionStatus('unavailable');
      return;
    }
    setCompletionStatus('verifying');
    try {
      const completion = await onComplete(pairs);
      if (!isMountedRef.current || roundGeneration !== roundGenerationRef.current) return;
      if (completion) {
        setAwardedXp(completion.awardedXp);
        setCompletionStatus('confirmed');
        playRewardSound();
        triggerConfetti(0.5, 0.5);
      } else {
        setCompletionStatus('failed');
      }
    } catch {
      if (!isMountedRef.current || roundGeneration !== roundGenerationRef.current) return;
      setCompletionStatus('failed');
    }
  }, [onComplete]);

  const handleTileClick = useCallback(
    (tile: MatchTile) => {
      if (
        lockSelectionRef.current ||
        matchedIds.has(tile.id) ||
        matchedCardIdsRef.current.has(tile.cardId) ||
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

      // A pair needs one word and one meaning from the same card.
      if (selectedTile.type !== tile.type && selectedTile.cardId === tile.cardId) {
        if (matchedCardIdsRef.current.has(tile.cardId)) return;
        // MATCH!
        playCorrectSound();
        triggerHaptic('success');
        const nextMatched = new Set(matchedIds);
        nextMatched.add(selectedTile.id);
        nextMatched.add(tile.id);
        matchedCardIdsRef.current.add(tile.cardId);
        setMatchedIds(nextMatched);
        setMatchesCount(prev => prev + 1);
        setSelectedTile(null);
        lockSelectionRef.current = false;

        // Check Victory
        if (nextMatched.size === tiles.length) {
          setIsVictory(true);
          if (!completionReportedRef.current) {
            completionReportedRef.current = true;
            const pairs = [...matchedCardIdsRef.current].flatMap(cardId => {
              const card = cards.find(candidate => candidate.id === cardId);
              return card ? [{ cardId, word: card.word, translation: card.translation }] : [];
            });
            completionPairsRef.current = pairs;
            void submitCompletion(pairs);
          }
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
    [selectedTile, matchedIds, isGameOver, isVictory, tiles.length, cards, submitCompletion]
  );

  const restartGame = async () => {
    if (completionReportedRef.current) {
      if (isStartingNewRound) return;
      setIsStartingNewRound(true);
      roundGenerationRef.current += 1;
      const started = await onNewRound?.();
      if (!isMountedRef.current) return;
      setIsStartingNewRound(false);
      if (started === false || !onNewRound) {
        setCompletionStatus('new-round-failed');
        return;
      }
      completionReportedRef.current = false;
    }
    setRoundKey(prev => prev + 1);
    setSelectedTile(null);
    setMatchedIds(new Set());
    setMismatchedIds(new Set());
    setTimeLeft(GAME_DURATION_SECONDS);
    setIsGameOver(false);
    setIsVictory(false);
    setMatchesCount(0);
    setCompletionStatus('idle');
    setAwardedXp(0);
    setIsStartingNewRound(false);
    lockSelectionRef.current = false;
    matchedCardIdsRef.current.clear();
    completionPairsRef.current = [];
  };

  const renderTile = (tile: MatchTile) => {
    const isMatched = matchedIds.has(tile.id);
    const isSelected = selectedTile?.id === tile.id;
    const isMismatched = mismatchedIds.has(tile.id);
    const language = tile.type === 'word' ? targetLanguage : nativeLanguage;

    if (isMatched) {
      return <div key={tile.id} className="flex min-h-15 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3 opacity-35 pointer-events-none scale-[.98] transition-transform motion-reduce:transition-none sm:min-h-16 sm:rounded-2xl">
        <span lang={language} className="text-sm font-semibold text-emerald-600 line-through">{tile.text}</span>
      </div>;
    }

    return <button key={tile.id} type="button" onClick={() => handleTileClick(tile)} lang={language}
      className={`flex min-h-15 items-center justify-between rounded-xl border bg-[var(--sf-surface-glass)] px-4 py-3 text-left text-base font-semibold shadow-[var(--sf-panel-shadow)] transition-[border-color,background-color,box-shadow,transform] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none sm:min-h-16 sm:rounded-2xl sm:text-lg ${
        isMismatched
          ? 'border-rose-400 bg-rose-500/20 text-rose-600 dark:text-rose-300 motion-safe:animate-shake'
          : isSelected
            ? 'border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_14%,var(--sf-surface))] text-[var(--sf-brand-text)] ring-2 ring-[color-mix(in_srgb,var(--sf-brand)_35%,transparent)]'
            : 'border-[var(--sf-border)] text-[var(--sf-text)] hover:border-[var(--sf-brand)] hover:bg-[var(--sf-surface-raised)]'
      }`}
    >
      <span className="break-words leading-snug">{tile.text}</span>
    </button>;
  };

  return (
    <div className="practice-board practice-board--match mx-auto flex h-full max-w-6xl flex-col px-1 py-3 sm:px-4 sm:py-6">
      <div className="mb-5 flex w-full items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={completionStatus === 'verifying'}
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-control)] text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
          aria-label={_(msg({ id: 'practice.match.close', message: 'Close word match' }))}
        >
          <X size={24} />
        </button>

        <p className="hidden min-w-0 flex-1 truncate font-display text-xs font-black uppercase tracking-[.14em] text-[var(--sf-text-muted)] sm:block">
          <Trans id="practice.match.title" message="Word match · 60 seconds" />
        </p>
        {!focusModeEnabled && matchesCount >= 2 && <span data-practice-combo={matchesCount} className="rounded-full border border-[var(--sf-brand)] bg-[var(--sf-surface-raised)] px-3 py-1.5 text-xs font-black text-[var(--sf-brand-text)]"><Trans id="study.combo" message="Combo ×{count}" values={{ count: matchesCount }} /></span>}
        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--sf-brand)_28%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,var(--sf-surface))] px-3 py-2 text-xs font-black text-[var(--sf-brand-text)]">
          <Flame size={15} className="text-amber-500" />
          <span>{matchesCount} / {pairCount}</span>
        </div>
      </div>

      <div className="mb-5 text-center sm:hidden">
        <h2 className="font-display text-lg font-black uppercase tracking-[.12em] text-[var(--sf-text)]">
          <Trans id="practice.match.title" message="Word match · 60 seconds" />
        </h2>
      </div>

      {!isGameOver && !isVictory ? (
        <>
          <div className="grid w-full items-center gap-5 sm:grid-cols-[minmax(0,1fr)_11rem_minmax(0,1fr)] sm:gap-10">
            <div className="grid gap-2.5 sm:gap-3">{tiles.filter(tile => tile.type === 'word').map(renderTile)}</div>
            <div className="order-first mx-auto flex size-32 flex-col items-center justify-center rounded-full border-4 border-[color-mix(in_srgb,var(--sf-brand)_32%,var(--sf-border))] bg-[var(--sf-surface-glass)] text-center shadow-[var(--sf-panel-shadow)] sm:order-none sm:size-40">
              <Timer size={18} className="mb-1 text-[var(--sf-brand-text)]" aria-hidden="true" />
              <span className={`font-mono text-4xl font-black tabular-nums ${timeLeft <= 10 ? 'text-rose-500 motion-safe:animate-pulse' : 'text-[var(--sf-brand-text)]'}`}><Trans id="practice.match.seconds" message="{seconds}s" values={{ seconds: timeLeft }} /></span>
              <span className="mt-1 text-[10px] font-black uppercase tracking-[.14em] text-[var(--sf-text-muted)]"><Trans id="practice.match.pairs" message="Pairs" /></span>
              <span className="text-sm font-black text-[var(--sf-text)]">{matchesCount} / {pairCount}</span>
            </div>
            <div className="grid gap-2.5 sm:gap-3">{tiles.filter(tile => tile.type === 'translation').map(renderTile)}</div>
          </div>
          <p className="mt-5 text-center text-xs text-[var(--sf-text-muted)]"><Trans id="practice.match.instruction" message="Choose a word in {targetLanguageName}, then its meaning in {nativeLanguageName}." values={{ targetLanguageName, nativeLanguageName }} /></p>
        </>
      ) : isVictory ? (
        <div className="mx-auto w-full max-w-xl rounded-[28px] border border-emerald-400/40 bg-[var(--sf-surface-glass)] p-6 text-center shadow-[var(--sf-panel-shadow)] sm:p-8 crystal-chamfer">
          <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-lg shadow-[var(--sf-shadow)]">
            <Trophy size={32} />
          </div>
          <h3 className="mt-4 text-2xl font-black text-[var(--sf-text)]">
            <Trans id="practice.match.complete-title" message="Pairs complete" />
          </h3>
          <p className="mt-1 text-sm text-[var(--sf-text-muted)]">
            <Trans id="practice.match.complete-copy" message="You matched all {pairCount} pairs in {seconds} seconds." values={{ pairCount, seconds: GAME_DURATION_SECONDS - timeLeft }} />
          </p>

          {completionStatus === 'verifying' && (
            <p className="mt-6 text-sm font-bold text-[var(--sf-text-muted)]" role="status">
              <Trans id="practice.match.verifying-reward" message="Verifying your result…" />
            </p>
          )}
          {completionStatus === 'confirmed' && (
            <div className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-2.5 text-sm font-black text-amber-600 dark:text-amber-300">
              <Zap size={18} className="text-amber-500" />
              <span>{awardedXp > 0
                ? <Trans id="practice.match.verified-xp" message="Verified +{awardedXp} XP" values={{ awardedXp }} />
                : <Trans id="practice.match.verified-no-xp" message="Result verified" />}
              </span>
            </div>
          )}
          {completionStatus === 'failed' && (
            <div className="mt-6">
              <p className="text-sm font-bold text-rose-600 dark:text-rose-300" role="alert">
                <Trans id="practice.match.verification-failed" message="We could not verify your result. Your completed pairs are still here." />
              </p>
              <button
                type="button"
                onClick={() => void submitCompletion(completionPairsRef.current)}
                className={retryActionClass}
              >
                <Trans id="practice.match.retry-verification" message="Retry verification" />
              </button>
            </div>
          )}
          {completionStatus === 'unavailable' && (
            <p className="mt-6 text-sm font-bold text-[var(--sf-text-muted)]" role="status">
              <Trans id="practice.match.no-reward" message="This round did not award XP." />
            </p>
          )}
          {completionStatus === 'new-round-failed' && (
            <div className="mt-6">
              <p className="text-sm font-bold text-rose-600 dark:text-rose-300" role="alert">
                <Trans id="practice.match.new-round-failed" message="We could not start a new verified round. Check your connection and try again." />
              </p>
              <button
                type="button"
                onClick={() => void restartGame()}
                className={retryActionClass}
              >
                <Trans id="practice.match.retry-new-round" message="Retry new round" />
              </button>
            </div>
          )}

          <div className="mt-8 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => void restartGame()}
              disabled={isStartingNewRound || completionStatus === 'verifying'}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-6 text-xs font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
            >
              <RotateCcw size={16} />
              <span>{isStartingNewRound
                ? <Trans id="practice.match.starting-new-round" message="Starting new round…" />
                : <Trans id="practice.match.new-round" message="New round" />}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={completionStatus === 'verifying'}
              className={secondaryActionClass}
            >
              <span><Trans id="practice.match.back" message="Back" /></span>
            </button>
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-xl rounded-[28px] border border-rose-400/30 bg-[var(--sf-surface-glass)] p-6 text-center shadow-[var(--sf-panel-shadow)] sm:p-8 crystal-chamfer">
          <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-rose-500/15 text-rose-500">
            <Timer size={32} />
          </div>
          <h3 className="mt-4 text-2xl font-black text-[var(--sf-text)]">
            <Trans id="practice.match.time-up" message="Time is up" />
          </h3>
          <p className="mt-1 text-sm text-[var(--sf-text-muted)]">
            <Trans id="practice.match.time-up-copy" message="You matched {matchesCount} of {pairCount} pairs." values={{ matchesCount, pairCount }} />
          </p>

          <div className="mt-8 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => void restartGame()}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-6 text-xs font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
            >
              <RotateCcw size={16} />
              <span><Trans id="practice.match.try-again" message="Try again" /></span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className={secondaryActionClass}
            >
              <span><Trans id="practice.match.back" message="Back" /></span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

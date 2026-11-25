import { Check, Flame, RotateCcw, Timer, Trophy, Zap } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playCorrectSound, playIncorrectSound } from '../../lib/audio';
import { triggerConfetti } from '../../lib/confetti';
import { triggerHaptic } from '../../lib/haptics';
import { playRewardSound } from '../../lib/interactionSounds';
import type { CardData } from '../../types/card';
import { useFocusModePreference } from '../settings/focus-mode-preference';
import { useTheme } from '../theme/ThemeProvider';
import { PracticeTopBar } from './practice-board-parts';
import { WORD_MATCH_DURATION_SECONDS } from './practiceModel';
import './practice-board.css';

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

const GAME_DURATION_SECONDS = WORD_MATCH_DURATION_SECONDS;
const PAIRS_PER_ROUND = 6;
/** Radius of the countdown ring inside its 220-unit box. */
const TIMER_RADIUS = 100;
const retryActionClass = 'practice-secondary practice-match__retry crystal-chamfer-sm min-h-11 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';
const primaryActionClass = 'practice-primary crystal-chamfer-sm min-h-12 transition-colors disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';
const secondaryActionClass = 'practice-secondary crystal-chamfer-sm min-h-12 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';

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
  const crystal = useTheme().family === 'crystal';
  const { focusModeEnabled } = useFocusModePreference();
  const [roundKey, setRoundKey] = useState(0);
  const deadlineRef = useRef(Date.now() + GAME_DURATION_SECONDS * 1000);
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
  const mismatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pair every card the session was started with: eligibility was decided before the session began, and
  // the server verifies a pair for each session card, so the board must not drop any of them.
  const tiles: MatchTile[] = useMemo(() => {
    const pool = cards.slice(0, PAIRS_PER_ROUND);

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
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) setIsGameOver(true);
    };
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [isGameOver, isVictory]);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; if (mismatchTimerRef.current !== null) clearTimeout(mismatchTimerRef.current); };
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
      if (Date.now() >= deadlineRef.current) { setTimeLeft(0); setIsGameOver(true); return; }
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

        const generation = roundGenerationRef.current;
        mismatchTimerRef.current = setTimeout(() => {
          if (!isMountedRef.current || generation !== roundGenerationRef.current) return;
          mismatchTimerRef.current = null;
          setMismatchedIds(new Set());
          setSelectedTile(null);
          lockSelectionRef.current = false;
        }, 500);
      }
    },
    [selectedTile, matchedIds, isGameOver, isVictory, tiles.length, cards, submitCompletion]
  );

  const restartGame = async () => {
    if (mismatchTimerRef.current !== null) { clearTimeout(mismatchTimerRef.current); mismatchTimerRef.current = null; }
    deadlineRef.current = Date.now() + GAME_DURATION_SECONDS * 1000;
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

    // A matched pair stays in its place, dimmed, so the board does not reshuffle under the learner.
    if (isMatched) {
      return (
        <div key={tile.id} className="practice-match__tile" data-kind={tile.type} data-state="matched">
          <span lang={language} className="practice-match__text">{tile.text}</span>
          <span className="practice-match__tag">
            <Check size={15} aria-hidden="true" />
            <span className="sr-only"><Trans {...msg({ context: 'practice.match.matched', message: 'Matched' })} /></span>
          </span>
        </div>
      );
    }

    const state = isMismatched ? 'wrong' : isSelected ? 'selected' : 'idle';
    return (
      <button
        key={tile.id}
        type="button"
        onClick={() => handleTileClick(tile)}
        lang={language}
        aria-pressed={isSelected}
        data-kind={tile.type}
        data-state={state}
        className={`practice-match__tile ${crystal ? 'transition-[border-color,background-color,box-shadow,transform] [html[data-theme-family=crystal]_&]:active:scale-[.98]' : 'fx-press'} focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none ${
          isMismatched
            ? 'sf-shake [html[data-theme-family=crystal]_&]:motion-safe:animate-shake'
            : isSelected ? '[html[data-theme-family=crystal]_&]:ring-2' : ''
        }`}
      >
        <span className="practice-match__text">{tile.text}</span>
        {state !== 'idle' && (
          <span className="practice-match__tag" aria-hidden="true">
            {isMismatched
              ? <Trans {...msg({ context: 'practice.match.not-a-pair', message: 'Not a pair' })} />
              : <Trans {...msg({ context: 'practice.match.selected', message: 'Selected' })} />}
          </span>
        )}
      </button>
    );
  };

  const minutes = Math.floor(timeLeft / 60);
  const clock = `${minutes}:${String(timeLeft % 60).padStart(2, '0')}`;
  const timeFraction = Math.max(0, Math.min(1, timeLeft / GAME_DURATION_SECONDS));
  const ringLength = 2 * Math.PI * TIMER_RADIUS;

  return (
    <div className="practice-board practice-board--match practice-stage" data-practice-mode="match">
      <PracticeTopBar
        closeLabel={<Trans {...msg({ context: 'practice.match.close', message: 'Close word match' })} />}
        closeAriaLabel={_(msg({ id: 'practice.match.close', message: 'Close word match' }))}
        closeDisabled={completionStatus === 'verifying'}
        onClose={onClose}
        mode={<Trans {...msg({ context: 'practice.match.mode', message: 'Word match' })} />}
        detail={<Trans {...msg({ context: 'practice.match.mode-detail', message: '60-second run' })} />}
      />

      {!isGameOver && !isVictory ? (
        <>
          <div className="practice-match">
            <div className="practice-match__column" role="group" aria-label={targetLanguageName}>
              {tiles.filter(tile => tile.type === 'word').map(renderTile)}
            </div>
            <div className="practice-match__center">
              <div className={`practice-match__timer${timeLeft <= 10 ? ' sf-pulse' : ''}`} data-low={timeLeft <= 10 || undefined} role="timer" aria-label={_({ ...msg({ id: 'practice.match.seconds-left', message: '{seconds, plural, one {# second left} other {# seconds left}}' }), values: { seconds: timeLeft } })}>
                <svg viewBox="0 0 220 220" aria-hidden="true">
                  <defs>
                    <linearGradient id="practice-match-ring-crystal" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#ff8fa3" />
                      <stop offset="1" stopColor="#ff2a4d" />
                    </linearGradient>
                  </defs>
                  <polygon className="practice-match__hex" points="110,6.6 199.1,58.3 199.1,161.7 110,213.4 20.9,161.7 20.9,58.3" />
                  <g className="practice-match__dial">
                    <circle className="practice-match__ring-track" cx="110" cy="110" r={TIMER_RADIUS} />
                    {crystal ? (
                      <circle
                        className="practice-match__ring"
                        cx="110"
                        cy="110"
                        r={TIMER_RADIUS}
                        strokeDasharray={`${ringLength * timeFraction} ${ringLength}`}
                        transform="rotate(-90 110 110)"
                      />
                    ) : (
                      <circle
                        className="practice-match__ring sf-draw-to"
                        cx="110"
                        cy="110"
                        r={TIMER_RADIUS}
                        pathLength={1}
                        strokeDasharray={1}
                        strokeDashoffset={1 - timeFraction}
                        transform="rotate(-90 110 110)"
                      />
                    )}
                  </g>
                </svg>
                <span className="practice-match__clock" aria-hidden="true">{clock}</span>
                <span className="practice-match__clock-label" aria-hidden="true"><Trans {...msg({ context: 'practice.match.left', message: 'left' })} /></span>
              </div>
              <p className="practice-match__pairs">
                <span className={crystal ? 'practice-match__pairs-count' : 'practice-match__pairs-count sf-tick'}>{matchesCount} / {pairCount}</span>
                <span className="practice-match__pairs-label"><Trans {...msg({ context: 'practice.match.pairs-matched', message: 'pairs matched' })} /></span>
              </p>
              {!focusModeEnabled && matchesCount >= 2 && (
                <span data-practice-combo={matchesCount} className={crystal ? 'practice-match__combo' : 'practice-match__combo fx-reward'}>
                  <span className="practice-match__combo-text">
                    <Flame size={14} aria-hidden="true" />
                    <Trans {...msg({ context: 'study.combo', message: 'Combo ×{count}' })} values={{ count: matchesCount }} />
                  </span>
                </span>
              )}
            </div>
            <div className="practice-match__column" role="group" aria-label={nativeLanguageName}>
              {tiles.filter(tile => tile.type === 'translation').map(renderTile)}
            </div>
          </div>
          <p className="practice-match__hint"><Trans {...msg({ context: 'practice.match.instruction', message: 'Choose a word in {targetLanguageName}, then its meaning in {nativeLanguageName}.' })} values={{ targetLanguageName, nativeLanguageName }} /></p>
        </>
      ) : isVictory ? (
        <div className="practice-results practice-match__result crystal-chamfer surface-glass" data-outcome="complete">
          <div className="practice-match__result-icon crystal-chamfer-sm">
            <Trophy size={30} aria-hidden="true" />
          </div>
          <h3 className="practice-match__result-title">
            <Trans {...msg({ context: 'practice.match.complete-title', message: 'Pairs complete' })} />
          </h3>
          <p className="practice-match__result-copy">
            <Trans {...msg({ context: 'practice.match.complete-copy', message: 'You matched all {pairCount} pairs in {seconds} seconds.' })} values={{ pairCount, seconds: GAME_DURATION_SECONDS - timeLeft }} />
          </p>

          {completionStatus === 'verifying' && (
            <p className="practice-match__status" role="status">
              <Trans {...msg({ context: 'practice.match.verifying-reward', message: 'Verifying your result…' })} />
            </p>
          )}
          {completionStatus === 'confirmed' && (
            <p className="practice-match__reward crystal-chamfer-sm">
              <Zap size={17} aria-hidden="true" />
              <span>{awardedXp > 0
                ? <Trans {...msg({ context: 'practice.match.verified-xp', message: 'Verified +{awardedXp} XP' })} values={{ awardedXp }} />
                : <Trans {...msg({ context: 'practice.match.verified-no-xp', message: 'Result verified' })} />}
              </span>
            </p>
          )}
          {completionStatus === 'failed' && (
            <div className="practice-match__status">
              <p className="practice-match__alert" role="alert">
                <Trans {...msg({ context: 'practice.match.verification-failed', message: 'We could not verify your result. Your completed pairs are still here.' })} />
              </p>
              <button
                type="button"
                onClick={() => void submitCompletion(completionPairsRef.current)}
                className={`${retryActionClass}${crystal ? '' : ' fx-press'}`}
              >
                <Trans {...msg({ context: 'practice.match.retry-verification', message: 'Retry verification' })} />
              </button>
            </div>
          )}
          {completionStatus === 'unavailable' && (
            <p className="practice-match__status" role="status">
              <Trans {...msg({ context: 'practice.match.no-reward', message: 'This round did not award XP.' })} />
            </p>
          )}
          {completionStatus === 'new-round-failed' && (
            <div className="practice-match__status">
              <p className="practice-match__alert" role="alert">
                <Trans {...msg({ context: 'practice.match.new-round-failed', message: 'We could not start a new verified round. Check your connection and try again.' })} />
              </p>
              <button
                type="button"
                onClick={() => void restartGame()}
                className={`${retryActionClass}${crystal ? '' : ' fx-press'}`}
              >
                <Trans {...msg({ context: 'practice.match.retry-new-round', message: 'Retry new round' })} />
              </button>
            </div>
          )}

          <div className="practice-match__result-actions">
            <button
              type="button"
              onClick={() => void restartGame()}
              disabled={isStartingNewRound || completionStatus === 'verifying'}
              className={`${primaryActionClass}${crystal ? '' : ' fx-press'}`}
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span>{isStartingNewRound
                ? <Trans {...msg({ context: 'practice.match.starting-new-round', message: 'Starting new round…' })} />
                : <Trans {...msg({ context: 'practice.match.new-round', message: 'New round' })} />}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={completionStatus === 'verifying'}
              className={`${secondaryActionClass}${crystal ? '' : ' fx-press'}`}
            >
              <span><Trans {...msg({ context: 'practice.match.back', message: 'Back' })} /></span>
            </button>
          </div>
        </div>
      ) : (
        <div className="practice-results practice-match__result crystal-chamfer surface-glass" data-outcome="time-up">
          <div className="practice-match__result-icon crystal-chamfer-sm">
            <Timer size={30} aria-hidden="true" />
          </div>
          <h3 className="practice-match__result-title">
            <Trans {...msg({ context: 'practice.match.time-up', message: 'Time is up' })} />
          </h3>
          <p className="practice-match__result-copy">
            <Trans {...msg({ context: 'practice.match.time-up-copy', message: 'You matched {matchesCount} of {pairCount} pairs.' })} values={{ matchesCount, pairCount }} />
          </p>

          <div className="practice-match__result-actions">
            <button
              type="button"
              onClick={() => void restartGame()}
              className={`${primaryActionClass}${crystal ? '' : ' fx-press'}`}
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span><Trans {...msg({ context: 'practice.match.try-again', message: 'Try again' })} /></span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className={`${secondaryActionClass}${crystal ? '' : ' fx-press'}`}
            >
              <span><Trans {...msg({ context: 'practice.match.back', message: 'Back' })} /></span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

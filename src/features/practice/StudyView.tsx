import { ChevronLeft, ChevronRight, Focus, Keyboard, ListChecks, Moon, Sun, X } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { cloneElement, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { Flashcard, type FlashcardProps } from '../../components/Flashcard';
import { ActiveRecallPrompt } from '../../components/flashcard/ActiveRecallPrompt';
import { CardTierName, CardTierStatus, type CardTier } from '../../components/flashcard/CardFront';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { Lumi, type LumiPose } from '../../components/lumi/Lumi';
import { useVerifiedStats } from '../../components/stats/VerifiedStatsContext';
import { ReviewControls } from '../../components/study/ReviewControls';
import { isSupportedImageUrl } from '../../lib/mediaUrlPolicy';
import { triggerHaptic } from '../../lib/haptics';
import { triggerConfetti } from '../../lib/confetti';
import { getReducedMotionScrollBehavior } from '../../lib/motion';
import { getEffectiveReducedMotion } from '../../lib/motionPreference';
import { getZenGlassMode } from '../../lib/useZenGlassMode';
import { playFlipSound, playRewardSound } from '../../lib/interactionSounds';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import { buildDailyGoals } from '../dailyGoals/dailyGoalsModel';
import { resolveStudyTimeZone } from '../dailyGoals/studyDayCountdown';
import { useMinuteClock } from '../dailyGoals/useMinuteClock';
import { buildStreakView } from '../gamification/streakView';
import { readDailyPace } from '../settings/dailyPacePreference';
import { readLumiEnabled } from '../settings/lumi-preference';
import { readFocusModeEnabled, useFocusModePreference } from '../settings/focus-mode-preference';
import { useTheme } from '../theme/ThemeProvider';
import { SessionRecapModal } from './SessionRecapModal';
import './study-shell.css';
import { resolveRecallMode, type RecallMode } from '../../lib/recall';
import type { ReviewRating } from '../../lib/reviewScheduler';
import type { CardData } from '../../types/card';
import type { StudyRatingSettlement } from './usePracticeSession';
import type { StudyReviewSummary } from './practiceSessionLifecycle';

interface StudyViewProps {
  cards: CardData[];
  index: number;
  recallMode: RecallMode;
  revealed: boolean;
  needsIntroduction?: boolean;
  reviewedCardId: string | null;
  reviewStatus?: 'idle' | 'saving' | 'saved' | 'error';
  reviewError?: string | null;
  paused?: boolean;
  goodCount?: number;
  againCount?: number;
  weakCards?: CardData[];
  showRecap?: boolean;
  summary?: StudyReviewSummary;
  xpEarned?: number;
  /** Study time the server credited to this session's saved reviews. */
  studyTimeMs?: number;
  onRetryWeak?: () => void;
  onDismissRecap?: () => void;
  onLearnFirst?: () => void;
  customDecks: string[];
  onClose: () => void;
  onViewWeeklyRecap?: () => void;
  onRecallMode: (mode: RecallMode) => void;
  onReveal: () => void;
  onBeginStudyRecall?: () => void;
  onBookmark: (cardId: string) => void;
  onAssignDeck: (cardId: string, deckName: string | null) => void;
  onUpdateCard: (cardId: string, fields: Partial<CardData>) => void;
  onDeleteCard?: (cardId: string) => Promise<boolean>;
  onRate: (rating: ReviewRating) => Promise<StudyRatingSettlement>;
  onIndex: (index: number) => void;
  onEditorOpenChange?: (cardId: string, open: boolean) => void;
}

type StudyKeyboardEvent = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'defaultPrevented' | 'key' | 'metaKey' | 'preventDefault' | 'shiftKey' | 'target'> & {
  readonly code?: string;
  readonly isComposing?: boolean;
  readonly nativeEvent?: { readonly isComposing: boolean };
};

const ALT_SHORTCUT_KEYS = new Set(['1', '2', '3', '4', 's', 'p', 'r']);

/**
 * The shortcut character of an Alt chord. Option on macOS turns the typed character into a symbol (Option+3 types a
 * pound sign), so fall back to the physical key, but only when the typed character is not a plain ASCII one: on a
 * Dvorak or Colemak layout the key at the S position types another ASCII character and must not fire the shortcut.
 */
const altShortcutKey = (event: Pick<StudyKeyboardEvent, 'key' | 'code'>): string => {
  const typed = event.key.toLocaleLowerCase();
  if (ALT_SHORTCUT_KEYS.has(typed) || /^[\x20-\x7e]$/.test(typed)) return typed;
  const physical = /^(?:Digit([1-4])|Key([SPR]))$/.exec(event.code ?? '');
  return physical ? (physical[1] ?? physical[2]).toLowerCase() : typed;
};

// Radix dialogs (Edit card, Report card, delete confirmation) render their content through a portal, so in the
// real DOM they are not descendants of the swipeable study card even though React's synthetic events still bubble
// through them as if they were. Ignore a touch that starts outside the card element in the real DOM, or that
// starts on an interactive/dialog surface that may share the card's React subtree without sharing its DOM subtree.
const STUDY_TOUCH_BLOCKING_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"]';

export function shouldIgnoreStudyCardTouch(
  target: unknown,
  cardElement: { contains?(node: unknown): boolean } | null | undefined,
): boolean {
  if (!cardElement?.contains?.(target)) return true;
  const element = target as { closest?: (selectors: string) => Element | null } | null | undefined;
  return Boolean(element?.closest?.(STUDY_TOUCH_BLOCKING_SELECTOR));
}


export function resolveStudyRecallMode(
  card: Pick<CardData, 'imageUrl'> | null | undefined,
  requestedMode: RecallMode,
  imageUnavailable = false,
): RecallMode {
  if (
    requestedMode === 'image-to-word'
    && card
    && (imageUnavailable || !isSupportedImageUrl(card.imageUrl))
  ) {
    // Keep the target-language answer direction without asking the learner to
    // identify media that is no longer available.
    return 'native-to-target';
  }
  return requestedMode;
}

/**
 * Brings in the next card. Classic deals it the way its seed boards do (Aurora.dc.html and Atelier.dc.html,
 * au-deal-a 560 ms and ip-deal-a 600 ms in study-shell.css); Crystal keeps its GSAP step.
 */
function StudyCardEntrance({ index, direction, children }: { index: number; direction: 1 | -1; children: ReactNode }) {
  if (globalThis.document?.documentElement.dataset.themeFamily !== 'crystal') {
    return <div key={index} data-study-deal className="study-shell-deal">{children}</div>;
  }
  return <GsapEntrance animationKey={index} direction={direction} variant="step">{children}</GsapEntrance>;
}

/**
 * True when revealing the answer turns the Crystal card over, as the AnimeReview board turns the revealed card
 * 180deg; the card's own flip then plays the flip sound. Classic, Zen glass and reduced motion show the answer side
 * at once.
 */
export function revealTurnsCard(root: { dataset?: { themeFamily?: string } } | null | undefined): boolean {
  return root?.dataset?.themeFamily === 'crystal' && !getZenGlassMode() && !getEffectiveReducedMotion();
}

/**
 * Starts the revealed card's turn through the card's own flip, by tapping its face as a learner would, so the turn,
 * light pillar, sound and side announcement are the card's. Does nothing unless the card still rests on the side
 * the prompt asked from.
 */
export function turnRevealedCard(studyCard: Pick<ParentNode, 'querySelector'> | null | undefined, fromSide: 'front' | 'back'): boolean {
  const shell = studyCard?.querySelector<HTMLElement>('[data-card-side][data-card-flipping]');
  if (!shell || shell.dataset.cardSide !== fromSide || shell.dataset.cardFlipping !== 'false') return false;
  const stage = shell.querySelector<HTMLElement>('[data-flashcard-stage]');
  stage?.click();
  return Boolean(stage);
}

function formatStudyElapsedTime(elapsedSeconds: number): string {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function StudyView({
  cards,
  index,
  recallMode,
  revealed,
  needsIntroduction = false,
  reviewedCardId,
  reviewStatus = 'idle',
  reviewError = null,
  paused = false,
  goodCount: externalGoodCount,
  againCount: externalAgainCount,
  weakCards: externalWeakCards,
  showRecap: externalShowRecap,
  summary,
  xpEarned: externalXpEarned,
  studyTimeMs: externalStudyTimeMs,
  onRetryWeak,
  onDismissRecap,
  onLearnFirst,
  customDecks,
  onClose,
  onViewWeeklyRecap,
  onRecallMode,
  onReveal,
  onBeginStudyRecall,
  onBookmark,
  onAssignDeck,
  onUpdateCard,
  onDeleteCard,
  onRate,
  onIndex,
  onEditorOpenChange,
}: StudyViewProps) {
  const { _, i18n } = useLingui();
  const { focusModeEnabled, setFocusModeEnabled } = useFocusModePreference();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const previousIndexRef = useRef(index);
  const elapsedTimeRef = useRef(0);
  const elapsedStartedAtRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedTime = formatStudyElapsedTime(elapsedSeconds);
  const direction: 1 | -1 = index < previousIndexRef.current ? -1 : 1;

  useEffect(() => {
    previousIndexRef.current = index;
  }, [index]);

  useEffect(() => {
    if (paused) return;
    elapsedStartedAtRef.current = performance.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((elapsedTimeRef.current + performance.now() - elapsedStartedAtRef.current!) / 1_000));
    }, 1_000);
    return () => {
      window.clearInterval(timer);
      if (elapsedStartedAtRef.current === null) return;
      elapsedTimeRef.current += performance.now() - elapsedStartedAtRef.current;
      elapsedStartedAtRef.current = null;
    };
  }, [paused]);

  const card = cards[index];
  const languageNames = new Intl.DisplayNames([i18n?.locale || 'en'], { type: 'language' });
  const targetLanguage = languageNames.of(card?.language || 'en') || card?.language || 'en';
  const nativeLanguage = languageNames.of(card?.translationLanguage || 'vi') || card?.translationLanguage || 'vi';
  const imageKey = card && isSupportedImageUrl(card.imageUrl)
    ? `${card.id}:${card.imageUrl}`
    : null;
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null);
  const imageUnavailable = imageKey !== null && failedImageKey === imageKey;
  const activeRecallMode = resolveStudyRecallMode(card, recallMode, imageUnavailable);
  const imageRecallAvailable = Boolean(imageKey && !imageUnavailable);
  const ratingRef = useRef<HTMLDivElement | null>(null);
  const studySurfaceRef = useRef<HTMLDivElement | null>(null);
  const recallTransitionPendingRef = useRef(false);
  // The card whose recall prompt was last on screen; its reveal is the one that turns the card over.
  const promptCardIdRef = useRef<string | null>(null);
  // Whether that prompt hid the picture; the turned card starts with the same blind front, as the board keeps its blind state across the turn.
  const promptBlindRef = useRef(false);

  useEffect(() => {
    if (needsIntroduction || !recallTransitionPendingRef.current) return;
    recallTransitionPendingRef.current = false;
    const surface = studySurfaceRef.current;
    const workspace = surface?.closest<HTMLElement>('.claude-workspace');
    if (surface && workspace) {
      const top = workspace.scrollTop + surface.getBoundingClientRect().top - workspace.getBoundingClientRect().top - workspace.clientTop;
      workspace.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    }
    surface?.focus({ preventScroll: true });
  }, [needsIntroduction]);

  const handleDeleteCard = useCallback(async (cardId: string) => {
    const deleted = await onDeleteCard?.(cardId) ?? false;
    if (deleted) globalThis.requestAnimationFrame?.(() => studySurfaceRef.current?.focus({ preventScroll: true }));
    return deleted;
  }, [onDeleteCard]);
  const handleImageUnavailable = useCallback(() => {
    if (imageKey) setFailedImageKey(imageKey);
  }, [imageKey]);

  useEffect(() => {
    if (activeRecallMode !== recallMode) onRecallMode(activeRecallMode);
  }, [activeRecallMode, onRecallMode, recallMode]);

  useEffect(() => {
    if (!revealed || !card) return;
    const scrollTimer = window.setTimeout(() => {
      ratingRef.current?.scrollIntoView({
        behavior: getReducedMotionScrollBehavior(),
        block: 'nearest',
      });
    }, 0);
    return () => window.clearTimeout(scrollTimer);
  }, [card?.id, revealed]);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchDeltaRef = useRef(0);
  const studyCardRef = useRef<HTMLDivElement | null>(null);
  const swipeBadgeRef = useRef<'good' | 'again' | null>(null);
  const [swipeBadge, setSwipeBadge] = useState<'good' | 'again' | null>(null);
  const [sessionGoodCount, setSessionGoodCount] = useState(0);
  const [sessionAgainCount, setSessionAgainCount] = useState(0);
  const [sessionXpEarned, setSessionXpEarned] = useState(0);
  const [sessionStudyTimeMs, setSessionStudyTimeMs] = useState(0);
  const answeredCount = summary?.saved ?? (externalGoodCount ?? sessionGoodCount) + (externalAgainCount ?? sessionAgainCount);
  const progressRatio = answeredCount / Math.max(cards.length, 1);
  const completeSegments = Array.from({ length: 12 }, (_, segment) => segment).filter(segment => (segment + 1) / 12 <= progressRatio).length;
  // The segment the next answer fills is marked while cards remain, as the board marks the card in hand.
  const currentSegment = answeredCount < cards.length ? completeSegments : -1;
  const [weakCards, setWeakCards] = useState<CardData[]>([]);
  const [showRecap, setShowRecap] = useState(false);
  const [lumiReaction, setLumiReaction] = useState<LumiPose | null>(null);
  // Crystal's combo banner counts the answers remembered in a row this session; Again breaks the run, as on the board.
  const [comboRun, setComboRun] = useState(0);
  const [xpPop, setXpPop] = useState<StudyXpPop | null>(null);
  const ratingInFlightRef = useRef(false);

  useEffect(() => {
    if (!xpPop) return;
    const timer = window.setTimeout(() => setXpPop(null), 1400);
    return () => window.clearTimeout(timer);
  }, [xpPop]);

  useEffect(() => {
    if (!lumiReaction) return;
    const timer = window.setTimeout(() => setLumiReaction(null), 1200);
    return () => window.clearTimeout(timer);
  }, [lumiReaction]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (paused) return;
    if (shouldIgnoreStudyCardTouch(e.target, e.currentTarget)) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    touchDeltaRef.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    if (!start || !revealed) return;
    const deltaX = e.touches[0].clientX - start.x;
    const deltaY = e.touches[0].clientY - start.y;
    if (Math.abs(deltaX) < Math.abs(deltaY) * 1.5) {
      touchDeltaRef.current = 0;
      studyCardRef.current?.style.removeProperty('transform');
      if (swipeBadgeRef.current !== null) {
        swipeBadgeRef.current = null;
        setSwipeBadge(null);
      }
      return;
    }
    touchDeltaRef.current = deltaX;
    const offset = Math.max(-120, Math.min(120, deltaX * 0.75));
    if (studyCardRef.current) studyCardRef.current.style.transform = `translateX(${offset}px) rotate(${offset * 0.04}deg)`;
    const badge = offset > 40 ? 'good' : offset < -40 ? 'again' : null;
    if (swipeBadgeRef.current !== badge) {
      swipeBadgeRef.current = badge;
      setSwipeBadge(badge);
    }
  };

  const resetTouch = () => {
    touchStartRef.current = null;
    touchDeltaRef.current = 0;
    studyCardRef.current?.style.removeProperty('transform');
    swipeBadgeRef.current = null;
    setSwipeBadge(null);
  };

  const handleTouchEnd = () => {
    if (!touchStartRef.current) return;
    const deltaX = touchDeltaRef.current;
    resetTouch();
    if (revealed && deltaX > 120) {
      // Swiped Right -> Good
      void handleRating('good');
    } else if (revealed && deltaX < -120) {
      // Swiped Left -> Again
      void handleRating('again');
    }
  };

  const handleRating = async (rating: ReviewRating) => {
    if (needsIntroduction || paused || !card || ratingInFlightRef.current) return;
    ratingInFlightRef.current = true;
    try {
      const settlement = await onRate(rating);
      if (settlement === 'retryable-error' || settlement === 'ignored') return;
      const effectiveRating = settlement.rating ?? rating;
      if (!readFocusModeEnabled() && (answeredCount + 1) % 3 === 0) {
        playRewardSound();
        triggerHaptic('heavy');
      } else {
        triggerHaptic(effectiveRating === 'again' || effectiveRating === 'hard' ? 'medium' : 'success');
      }

      if (
        globalThis.document?.documentElement.dataset.themeFamily === 'crystal'
        && readLumiEnabled()
      ) {
        setLumiReaction(effectiveRating === 'again' ? 'oops' : effectiveRating === 'hard' ? 'focus' : 'happy');
      }

      const isPositive = effectiveRating === 'good' || effectiveRating === 'easy';
      setSessionXpEarned(previous => previous + settlement.xpAwarded);
      setComboRun(previous => (effectiveRating === 'again' ? 0 : previous + 1));
      if (settlement.xpAwarded > 0) setXpPop(previous => ({ id: (previous?.id ?? 0) + 1, xp: settlement.xpAwarded }));
      if (settlement.studyTimeMs) setSessionStudyTimeMs(previous => previous + (settlement.studyTimeMs ?? 0));
      if (isPositive) {
        setSessionGoodCount(prev => prev + 1);
      } else {
        setSessionAgainCount(prev => prev + 1);
        setWeakCards(prev => [...prev.filter(c => c.id !== card.id), card]);
      }

      if (index === cards.length - 1) {
        if (isPositive && answeredCount + 1 === cards.length) triggerConfetti(0.5, 0.5);
        setShowRecap(true);
      } else onIndex(index + 1);
    } finally {
      ratingInFlightRef.current = false;
    }
  };

  const handleStudyShortcut = useCallback((event: StudyKeyboardEvent, surface: HTMLDivElement) => {
    if (needsIntroduction || paused || !card) return;
    if (event.defaultPrevented || event.nativeEvent?.isComposing || event.isComposing) return;
    const target = event.target as { closest?: (selectors: string) => Element | null } | null;
    if (target?.closest?.('button, a, input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [data-radix-popper-content-wrapper]')) return;

    const noModifiers = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const altShortcut = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const altKey = altShortcut ? altShortcutKey(event) : '';
    if (noModifiers && (event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar' || event.key === 'Enter')) {
      event.preventDefault();
      if (!revealed) {
        if (!revealTurnsCard(surface.ownerDocument?.documentElement)) playFlipSound();
        onReveal();
      } else surface.querySelector<HTMLButtonElement>('[data-study-card] [data-flip-card]')?.click();
    } else if (noModifiers && event.key === 'ArrowRight') {
      event.preventDefault();
      onIndex(Math.min(cards.length - 1, index + 1));
    } else if (noModifiers && event.key === 'ArrowLeft') {
      event.preventDefault();
      onIndex(Math.max(0, index - 1));
    } else if (altShortcut && ['1', '2', '3', '4'].includes(altKey)) {
      event.preventDefault();
      const ratings: Record<string, ReviewRating> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
      void handleRating(ratings[altKey]);
    } else if (altShortcut && altKey === 's') {
      event.preventDefault();
      if (!card.bookmarked) playRewardSound();
      void onBookmark(card.id);
    } else if (altShortcut && altKey === 'p') {
      event.preventDefault();
      surface.querySelector<HTMLButtonElement>(`[data-study-card] [aria-label="${_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}"]`)?.click();
    } else if (altShortcut && altKey === 'r') {
      event.preventDefault();
      surface.querySelector<HTMLButtonElement>(`[data-study-card] [aria-label="${_(msg({ id: 'flashcard.audio.check-pronunciation', message: 'Check pronunciation' }))}"]`)?.click();
    }
  }, [needsIntroduction, _, card?.bookmarked, cards.length, handleRating, index, onBookmark, onIndex, onReveal, paused, revealed]);

  if (!card) return null;
  if (!revealed && !needsIntroduction) {
    promptCardIdRef.current = card.id;
    promptBlindRef.current = !(resolveRecallMode(card, activeRecallMode) === 'image-to-word' && imageRecallAvailable);
  }
  // Classic counts every saved answer; Crystal counts the run its board banner shows.
  const comboCount = globalThis.document?.documentElement.dataset.themeFamily === 'crystal' ? comboRun : answeredCount;

  // Above the card in the classic shells; Crystal keeps the board's card slot clear and puts it in the session footer.
  const learnFirst = !needsIntroduction && onLearnFirst
    ? <button type="button" onClick={onLearnFirst} className="study-shell-learn-first my-4 min-h-11 rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-button-radius,999px)] border border-[var(--sf-border)] px-4 py-2 font-bold"><Trans {...msg({ context: 'practice.learn-first', message: 'I don\'t know this — learn first' })} /></button>
    : null;

  return (
    <div ref={studySurfaceRef} tabIndex={-1} data-study-session data-study-state={revealed ? 'revealed' : 'prompt'} data-study-paused={paused ? 'true' : 'false'} onKeyDown={event => handleStudyShortcut(event, event.currentTarget)} className="practice-board practice-board--study study-shell mx-auto flex h-full max-w-5xl flex-col items-center px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-5 sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div data-study-header className="study-shell-header mb-3 flex w-full items-center gap-3">
        <div className="study-shell-start">
          <button type="button" onClick={onClose} disabled={paused} className="study-shell-close crystal-chamfer-sm min-h-11 min-w-11 border border-[var(--sf-border)] bg-[var(--sf-surface-control)] text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none" aria-label={_(msg({ id: 'study.close', message: 'Close study mode' }))}>
            <X size={18} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <p data-study-title className="study-shell-title">
            <span className="study-shell-title__kicker" aria-hidden="true"><Trans {...msg({ context: 'practice.topbar.kicker', message: 'Practice' })} /> <span className="study-shell-title__slashes">//</span> </span>
            <Trans {...msg({ context: 'study.title', message: 'Review' })} />
          </p>
        </div>
        <div data-study-progress role="progressbar" aria-label={_(msg({ id: 'study.progress', message: 'Study progress' }))} aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={answeredCount} className="study-shell-progress">
          <div data-study-progress-segments aria-hidden="true">
            {Array.from({ length: 12 }, (_, segment) => (
              <span key={segment} data-study-progress-segment={segment < completeSegments ? 'complete' : segment === currentSegment ? 'current' : 'pending'} />
            ))}
          </div>
          <span data-study-count className="study-shell-count">
            <span aria-hidden="true"><span className="study-shell-count__current">{answeredCount}</span> / {cards.length}</span>
            <span className="sr-only"><Trans {...msg({ context: 'study.card-count', message: '{current} / {total} saved' })} values={{ current: answeredCount, total: cards.length }} /></span>
          </span>
        </div>
        <div className="study-shell-end">
          <span data-study-timer aria-label={_(msg({ id: 'study.elapsed-time', message: 'Elapsed study time: {time}' }).id, { time: elapsedTime })} className="study-shell-timer">
            {elapsedTime}
          </span>
          <button type="button" data-study-focus-mode aria-label={_(msg({ id: 'study.focus-mode', message: 'Focus mode' }))} aria-pressed={focusModeEnabled} onClick={() => setFocusModeEnabled(!focusModeEnabled)} className={`study-shell-tool grid min-h-11 min-w-11 place-items-center rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-full border bg-[var(--sf-surface-control)] focus-visible:outline-2 focus-visible:outline-offset-2 ${focusModeEnabled ? 'border-[var(--sf-brand)] text-[var(--sf-brand-text)]' : 'border-[var(--sf-border)] text-[var(--sf-text-muted)]'}`}>
            <Focus size={18} aria-hidden="true" />
          </button>
          <button type="button" data-study-summary onClick={() => setSummaryOpen(true)} className="study-shell-summary min-h-11 min-w-11 rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-button-radius,999px)] px-3 text-sm font-bold focus-visible:outline-2">
            <ListChecks size={18} aria-hidden="true" className="study-shell-summary__icon" />
            <span className="study-shell-summary__label"><Trans {...msg({ context: 'study-view.summary', message: 'Summary' })} /></span>
          </button>
          <StudyShellPreferences />
        </div>
      </div>

      <StudyLumiAside quiet={needsIntroduction} revealed={revealed} pose={lumiReaction ?? (needsIntroduction ? 'study' : revealed ? 'hint' : 'idle')} />

      {/* Crystal lifts these two into the board's right column on wide screens; elsewhere the wrapper adds no box. */}
      <div className="study-shell-aside" data-study-aside>
      <StudyBoardColumn combo={comboRun} xpPop={xpPop} showCombo={!focusModeEnabled} />
      <div className="study-shell-combo mb-2 flex min-h-7 w-full justify-end" aria-live="polite">
        {!focusModeEnabled && comboCount >= 2 && <span data-study-combo={comboCount} className="rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-button-radius,999px)] border border-[var(--sf-brand)] bg-[var(--sf-surface-raised)] px-3 py-1 font-display text-xs font-black uppercase tracking-wider text-[var(--sf-brand-text)]"><span className="study-shell-combo__text"><Trans {...msg({ context: 'study.combo', message: 'Combo ×{count}' })} values={{ count: comboCount }} /></span></span>}
      </div>

      <label data-study-recall-mode className="mb-4 flex flex-wrap items-center justify-center gap-2 text-[11px] font-black uppercase tracking-widest text-[var(--sf-text-muted)]">
        <span className="study-shell-recall__label"><Trans {...msg({ context: 'study.recall-mode', message: 'Recall mode' })} /></span>
        <select name="study-recall-mode" value={activeRecallMode} onChange={event => onRecallMode(resolveStudyRecallMode(card, event.target.value as RecallMode))} className="study-shell-recall__select min-h-11 rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-input-radius,999px)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 text-sm normal-case tracking-normal text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2">
          <option value="target-to-native"><Trans {...msg({ context: 'study.recall-mode.target-to-native', message: '{targetLanguage} → {nativeLanguage}' })} values={{ targetLanguage, nativeLanguage }} /></option>
          <option value="adaptive"><Trans {...msg({ context: 'study.recall-mode.adaptive', message: 'Adaptive difficulty' })} /></option>
          <option value="native-to-target"><Trans {...msg({ context: 'study.recall-mode.native-to-target', message: '{nativeLanguage} → {targetLanguage}' })} values={{ targetLanguage, nativeLanguage }} /></option>
          <option value="image-to-word" disabled={!imageRecallAvailable}><Trans {...msg({ context: 'study.recall-mode.image-to-word', message: 'Image → Word' })} /></option>
          <option value="listen-to-word"><Trans {...msg({ context: 'study.recall-mode.listen-to-word', message: 'Listen → Word' })} /></option>
          <option value="cloze"><Trans {...msg({ context: 'study.recall-mode.cloze', message: 'Fill the sentence' })} /></option>
        </select>
      </label>
      </div>

      {/* Swipeable Flashcard Container */}
      <div ref={studyCardRef} data-study-card className="relative mb-5 w-full max-w-3xl touch-pan-y select-none transition-transform duration-100 ease-out motion-reduce:transition-none" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={resetTouch}>
        {/* Swipe Feedback Badges */}
        {swipeBadge === 'good' && (
          <div className="absolute left-6 top-6 z-50 rounded-2xl [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-panel-radius,18px)] border-2 border-emerald-400 bg-emerald-500/90 px-4 py-1.5 text-sm font-black uppercase tracking-widest text-white shadow-xl backdrop-blur-md">
            <Trans {...msg({ context: 'study.swipe.good', message: 'GOOD 👍' })} />
          </div>
        )}
        {swipeBadge === 'again' && (
          <div className="absolute right-6 top-6 z-50 rounded-2xl [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-panel-radius,18px)] border-2 border-rose-400 bg-rose-500/90 px-4 py-1.5 text-sm font-black uppercase tracking-widest text-white shadow-xl backdrop-blur-md">
            <Trans {...msg({ context: 'study.swipe.again', message: 'AGAIN 👎' })} />
          </div>
        )}

        <CrystalFamilySlot crystal={false}>{learnFirst}</CrystalFamilySlot>
        <StudyCardEntrance index={index} direction={direction}>
          {needsIntroduction ? (
            <section data-study-introduction className="study-shell-intro mx-auto w-full max-w-2xl rounded-[32px] [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-card-radius,22px)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3 shadow-xl sm:p-5" aria-labelledby="study-introduction-heading">
              <div className="study-shell-intro__head mb-4 text-center">
                <h2 id="study-introduction-heading" className="study-shell-intro__title text-lg font-black text-[var(--sf-text)]"><Trans {...msg({ context: 'study-view.meet-this-word', message: 'Meet this word' })} /></h2>
                <p className="study-shell-intro__lede mt-1 text-sm text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'study-view.take-a-moment-to-review-the-card-before-recall-practice', message: 'Take a moment to review the card before recall practice.' })} /></p>
              </div>
              <Flashcard
                data={card}
                initialSide="back"
                imagePriority
                onToggleBookmark={onBookmark}
                customDecks={customDecks}
                onAssignDeck={onAssignDeck}
                onUpdateCard={onUpdateCard}
              />
              <button
                type="button"
                onClick={() => {
                  recallTransitionPendingRef.current = true;
                  onBeginStudyRecall?.();
                }}
                className="study-shell-intro__begin mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-button-radius,999px)] bg-[var(--sf-brand)] px-4 py-3 text-sm font-black text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] motion-reduce:transition-none"
              ><Trans {...msg({ context: 'study-view.i-ve-reviewed-it-start-recall', message: 'I’ve reviewed it — start recall' })} /></button>
            </section>
          ) : revealed ? (
            <CrystalRevealTurn studyCard={studyCardRef} fromPrompt={promptCardIdRef.current === card.id} promptBlind={promptBlindRef.current}>
            <Flashcard
              data={card}
              initialSide={activeRecallMode === 'target-to-native' || (activeRecallMode === 'adaptive' && (card.correctStreak || 0) === 0) ? 'back' : 'front'}
              imagePriority
              onToggleBookmark={onBookmark}
              customDecks={customDecks}
              onAssignDeck={onAssignDeck}
              onUpdateCard={onUpdateCard}
              onEditDelete={handleDeleteCard}
              onEditOpenChange={open => onEditorOpenChange?.(card.id, open)}
              editorContext={{ kind: 'review', current: index + 1, total: cards.length }}
            />
            </CrystalRevealTurn>
          ) : (
            <ActiveRecallPrompt
              card={card}
              mode={activeRecallMode}
              onReveal={onReveal}
              onImageUnavailable={handleImageUnavailable}
              onToggleBookmark={onBookmark}
            />
          )}
        </StudyCardEntrance>
        {lumiReaction && (
          <div className="study-shell-reaction pointer-events-none absolute -bottom-5 -right-1 z-20 hidden sm:block" aria-hidden="true">
            <Lumi pose={lumiReaction} size={72} className="crystal-ornament drop-shadow-[0_8px_16px_var(--sf-shadow)]" />
          </div>
        )}
      </div>

      {!needsIntroduction && !revealed && <p data-study-hint className="study-shell-hint">
        <Trans {...msg({ context: 'study.hint', message: 'Say it out loud first, then reveal <0>Space</0>' })} components={{ 0: <kbd className="study-shell-kbd crystal-chamfer-sm" /> }} />
      </p>}

      {!needsIntroduction && <div ref={ratingRef} inert={paused || undefined} data-study-rating className="w-full max-w-xl scroll-mt-4">
        <ReviewControls
          revealed={revealed}
          reviewed={reviewedCardId === card.id}
          saving={reviewStatus === 'saving'}
          error={reviewError}
          lastRating={card.reviewHistory?.at(-1)?.rating}
          onRate={handleRating}
        />
      </div>}

      <CrystalFamilySlot crystal>{learnFirst}</CrystalFamilySlot>

      <div className="study-shell-nav flex items-center gap-4 sm:gap-6">
        <button type="button" onClick={() => onIndex(Math.max(0, index - 1))} disabled={paused || index === 0} className="study-shell-nav__step crystal-chamfer-sm min-h-11 min-w-11 [html:not([data-theme-family=crystal])_&]:rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-control)] p-3 text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] transition hover:border-[var(--sf-brand)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transform-none motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50" aria-label={_(msg({ id: 'study.previous-card', message: 'Previous card' }))}>
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <div className="study-shell-nav__position crystal-chamfer-sm [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-button-radius,999px)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-5 py-3 font-mono font-bold tabular-nums text-[var(--sf-brand-text)]">{index + 1} / {cards.length}</div>
        <button data-color-role="primary" type="button" onClick={() => onIndex(Math.min(cards.length - 1, index + 1))} disabled={paused || index === cards.length - 1} className="study-shell-nav__step crystal-chamfer-sm min-h-11 min-w-11 [html:not([data-theme-family=crystal])_&]:rounded-full bg-[var(--sf-brand)] p-3 text-[var(--sf-on-brand)] shadow-[var(--sf-panel-shadow)] transition hover:bg-[var(--sf-brand-hover)] hover:text-white active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transform-none motion-reduce:transition-none disabled:opacity-50" aria-label={_(msg({ id: 'study.next-card', message: 'Next card' }))}>
          <ChevronRight size={24} aria-hidden="true" />
        </button>
      </div>

      <SessionRecapModal
        open={showRecap || externalShowRecap || summaryOpen}
        onClose={() => { setShowRecap(false); setSummaryOpen(false); (onDismissRecap ?? onClose)(); }}
        summary={summary}
        onRetryWeak={onRetryWeak}
        onViewWeeklyRecap={onViewWeeklyRecap}
        totalCards={cards.length}
        goodCount={externalGoodCount ?? sessionGoodCount}
        againCount={externalAgainCount ?? sessionAgainCount}
        xpEarned={externalXpEarned ?? sessionXpEarned}
        studyTimeMs={externalStudyTimeMs ?? sessionStudyTimeMs}
        weakCards={externalWeakCards ?? weakCards}
        targetLanguage={cards[0]?.language ?? 'en'}
      />

      <div className="study-shell-shortcuts mx-auto mt-8 hidden w-full max-w-sm rounded-2xl [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-panel-radius,18px)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-center shadow-xs md:block">
        <div className="study-shell-shortcuts__title mb-3 flex items-center justify-center gap-1.5 text-xs font-black text-[var(--sf-text-muted)]"><Keyboard size={13} className="text-[var(--sf-brand-text)]" aria-hidden="true" /><span><Trans {...msg({ context: 'study.shortcuts', message: 'Study shortcuts' })} /></span></div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[10px] text-[var(--sf-text-muted)] font-medium text-left">
          <Shortcut keys="Space" label={_(msg({ id: 'study.shortcut.flip-card', message: 'Flip card' }))} />
          <Shortcut keys="← / →" label={_(msg({ id: 'study.shortcut.previous-next', message: 'Previous / next' }))} />
          <div className="col-span-2 border-t border-[var(--sf-border)] pt-2.5"><Shortcut keys="Alt+1…4" label={_(msg({ id: 'study.shortcut.rate-memory', message: 'Rate memory' }))} /></div>
          <div className="col-span-2 border-t border-[var(--sf-border)] pt-2.5"><Shortcut keys="Alt+S / Alt+P / Alt+R" label={_(msg({ id: 'study.shortcut.star-play-speak', message: 'Star / play / speak' }))} /></div>
        </div>
      </div>
    </div>
  );
}

/**
 * The app bar steps aside while the learner reviews, so the shell carries its light and dark switch
 * and the same streak the app bar shows: the verified run the app already holds, with no read of its own.
 */
function StudyShellPreferences() {
  const { _ } = useLingui();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const verifiedState = useVerifiedStats()?.state ?? null;
  const streak = useMemo(() => (verifiedState ? buildStreakView(verifiedState, new Date()).length : 0), [verifiedState]);
  return <>
    <button type="button" data-study-theme onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')} aria-pressed={themeMode === 'dark'} aria-label={_(msg({ id: 'shell.theme.quick-toggle', message: 'Switch light and dark mode' }))} className="study-shell-theme claude-theme-quick-toggle flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-control)] text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none">
      {themeMode === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
    {streak > 0 && <span data-study-streak role="img" className="study-shell-streak claude-streak" aria-label={_(msg({ id: 'shell.streak', message: '{count} day streak' }).id, { count: streak })}>
      <svg className="claude-streak-flame" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 2c1 3.5-1.5 5.5-1.5 8.2 0 1.4 1 2.5 2.3 2.5 1.5 0 2.4-1.2 2.2-3 2.3 1.7 3.5 4.3 3.5 6.8C18.5 20 15.6 22 12 22s-6.5-2.3-6.5-5.9c0-4.7 4.3-7 6.5-14.1z" /></svg>
      <span aria-hidden="true">{streak}<span className="study-shell-streak__unit"> <Trans {...msg({ context: 'study.streak-unit', message: '{count, plural, one {day} other {days}}' })} values={{ count: streak }} /></span></span>
    </span>}
  </>;
}

/** Drops the key cap from the reveal hint where Lumi says the line. */
function NoKeyCap() {
  return null;
}

/**
 * The revealed answer card. When the reveal turns the card over (see revealTurnsCard), it mounts on the side the
 * prompt asked from and turns to the answer side on the next frame; otherwise it mounts on the answer side as before.
 * The start side is fixed at mount, because the card reads its initial side only once.
 */
export function CrystalRevealTurn({ studyCard, fromPrompt, promptBlind = false, children }: {
  studyCard: RefObject<HTMLDivElement | null>;
  fromPrompt: boolean;
  /** The prompt hid the picture: a turn that starts on the front starts on the same blind front. */
  promptBlind?: boolean;
  children: ReactElement<FlashcardProps>;
}) {
  const answerSide = children.props.initialSide ?? 'front';
  const [startSide] = useState<'front' | 'back'>(() => (
    fromPrompt && revealTurnsCard(globalThis.document?.documentElement)
      ? (answerSide === 'back' ? 'front' : 'back')
      : answerSide
  ));
  const turnPendingRef = useRef(startSide !== answerSide);

  useEffect(() => {
    if (!turnPendingRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      turnPendingRef.current = false;
      turnRevealedCard(studyCard.current, startSide);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [startSide, studyCard]);

  const [startBlind] = useState(() => startSide !== answerSide && startSide === 'front' && promptBlind);
  return cloneElement(children, startBlind ? { initialSide: startSide, initialBlind: true } : { initialSide: startSide });
}

/** Renders its children only in the Crystal family (crystal) or only outside it (crystal={false}). */
function CrystalFamilySlot({ crystal, children }: { crystal: boolean; children: ReactNode }) {
  const { family } = useTheme();
  return (family === 'crystal') === crystal ? <>{children}</> : null;
}

/**
 * Crystal's left column on wide screens: Lumi under her LUMI · LINK panel, as on the AnimeReview board. Before the
 * answer she gives the reveal hint; on the answer she asks how well the card was remembered, the question the grade
 * row answers. The panel keeps its place while it has nothing to say, so Lumi does not jump.
 */
function StudyLumiAside({ quiet, revealed, pose }: { quiet: boolean; revealed: boolean; pose: LumiPose }) {
  const { family } = useTheme();
  if (family !== 'crystal' || !readLumiEnabled()) return null;
  return (
    <aside data-study-lumi className="study-shell-lumi" aria-hidden="true">
      <div className="study-shell-lumi__panel" data-quiet={quiet ? 'true' : undefined}>
        <span className="study-shell-lumi__strip" />
        <p className="study-shell-lumi__label"><Trans {...msg({ context: 'practice.lumi.label', message: 'Lumi · Link' })} /></p>
        <p className="study-shell-lumi__line">{revealed
          ? <Trans {...msg({ id: 'review.prompt', message: 'How well did you remember this card?' })} />
          : <Trans {...msg({ context: 'study.hint', message: 'Say it out loud first, then reveal <0>Space</0>' })} components={{ 0: <NoKeyCap /> }} />}</p>
      </div>
      <Lumi pose={pose} className="study-shell-lumi__art crystal-ornament pointer-events-none" />
    </aside>
  );
}

/** The XP the server granted for the last saved review; `id` restarts the pop when a new grant arrives. */
interface StudyXpPop {
  readonly id: number;
  readonly xp: number;
}

/** The board's combo names, from no answer in a row to five or more. */
const COMBO_NAMES = [
  msg({ context: 'study.combo-name.ready', message: 'Ready' }),
  msg({ context: 'study.combo-name.nice', message: 'Nice' }),
  msg({ context: 'study.combo-name.sweet', message: 'Sweet' }),
  msg({ context: 'study.combo-name.lovely', message: 'Lovely' }),
  msg({ context: 'study.combo-name.sparkly', message: 'Sparkly' }),
  msg({ context: 'study.combo-name.dreamy', message: 'Dreamy' }),
] as const;

const COMBO_STAR_POINTS = [
  ['50.0,52.0 38.2,35.7 50.0,4.0', '#ff5470'], ['50.0,52.0 50.0,4.0 61.8,35.7', '#7a0820'],
  ['50.0,52.0 61.8,35.7 95.7,37.2', '#ff5470'], ['50.0,52.0 95.7,37.2 69.2,58.2', '#7a0820'],
  ['50.0,52.0 69.2,58.2 78.2,90.8', '#ff5470'], ['50.0,52.0 78.2,90.8 50.0,72.2', '#7a0820'],
  ['50.0,52.0 50.0,72.2 21.8,90.8', '#ff5470'], ['50.0,52.0 21.8,90.8 30.8,58.2', '#7a0820'],
  ['50.0,52.0 30.8,58.2 4.3,37.2', '#ff5470'], ['50.0,52.0 4.3,37.2 38.2,35.7', '#7a0820'],
] as const;

const LEGEND_TIERS: readonly CardTier[] = ['new', 'learning', 'mastered'];

/**
 * Crystal's right column on wide screens, as on the AnimeReview board: the combo banner, today's card goal and the
 * Bud, Bloom and Star legend. Focus mode hides the banner, as it hides every combo banner.
 */
function StudyBoardColumn({ combo, xpPop, showCombo }: { combo: number; xpPop: StudyXpPop | null; showCombo: boolean }) {
  const { family } = useTheme();
  if (family !== 'crystal') return null;
  return <>
    {showCombo && <StudyComboBanner combo={combo} xpPop={xpPop} />}
    <StudyDailyGoal />
    <ul data-study-tier-legend className="study-shell-legend">
      {LEGEND_TIERS.map(tier => (
        <li key={tier} className="study-shell-legend__row">
          <span className="study-shell-legend__grade" data-tier={tier}><CardTierName tier={tier} /></span>
          <span className="study-shell-legend__label"><CardTierStatus tier={tier} /></span>
        </li>
      ))}
    </ul>
  </>;
}

/** The combo name and count over the slanted crimson banner, with the XP the server granted popping under it. */
function StudyComboBanner({ combo, xpPop }: { combo: number; xpPop: StudyXpPop | null }) {
  return (
    <div data-study-combo-banner={combo} data-xp-pop={xpPop ? 'true' : undefined} className="study-shell-combo-banner" aria-live="polite">
      <span className="study-shell-combo-banner__band" aria-hidden="true" />
      <span className="study-shell-combo-banner__star" aria-hidden="true">
        <svg viewBox="0 0 100 100" width="100%" height="100%" focusable="false">
          {COMBO_STAR_POINTS.map(([points, fill]) => <polygon key={points} points={points} fill={fill} />)}
        </svg>
      </span>
      <span className="study-shell-combo-banner__name"><Trans {...COMBO_NAMES[Math.min(combo, COMBO_NAMES.length - 1)]} /></span>
      <span className="study-shell-combo-banner__count"><Trans {...msg({ context: 'study.combo', message: 'Combo ×{count}' })} values={{ count: combo }} /></span>
      {xpPop && <span key={xpPop.id} className="study-shell-combo-banner__xp"><Trans {...msg({ id: 'daily-goals.xp', message: '+{xp} XP' })} values={{ xp: xpPop.xp }} /></span>}
    </div>
  );
}

/**
 * Today's card goal from the verified counters the Today screen reads: the daily pace sets the target and the
 * server's count of studied cards fills the bar. Until those counters arrive the count reads as a dash, never a
 * number the server did not write.
 */
function StudyDailyGoal() {
  const { _ } = useLingui();
  const verifiedState = useVerifiedStats()?.state ?? null;
  const pace = useMemo(() => readDailyPace(), []);
  // A session left open past midnight moves to the new study day's goal.
  const now = useMinuteClock();
  // The goal wording lives with the Today screen's messages; load them when the study screen opens first.
  useEffect(() => { void loadCatalog(getActiveUiLocale(), 'today').catch(() => undefined); }, []);
  const goal = buildDailyGoals({
    now,
    timeZone: resolveStudyTimeZone(verifiedState?.rewardTimeZone),
    dailyPace: pace,
    planHasMatch: false,
    xpHistory: verifiedState?.xpHistory ?? {},
    streak: verifiedState?.streak ?? 0,
    lastStudyDay: verifiedState?.lastStudyDay,
    dailyGoals: verifiedState?.dailyGoals,
    hydrated: verifiedState ? verifiedState.hydrated : false,
    streakState: verifiedState?.streakState,
    rewards: verifiedState?.rewards,
    hydrationFailed: verifiedState?.hydrationFailed,
  }).goals[0];
  if (goal.id !== 'study-cards') return null;
  const label = _({ ...msg({ id: 'daily-goals.goal.study-cards', message: '{count, plural, one {Study # card} other {Study # cards}}' }), values: { count: goal.cards } });
  const { progress } = goal;
  return (
    <section data-study-daily-goal={progress.state} className="study-shell-goal" aria-label={_(msg({ id: 'daily-goals.heading', message: 'Daily goals' }))}>
      <p className="study-shell-goal__kicker" aria-hidden="true">{_(msg({ id: 'daily-goals.heading', message: 'Daily goals' }))}</p>
      <p className="study-shell-goal__title">{label}</p>
      {progress.state === 'counted' ? (
        <span
          className="study-shell-goal__bar"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={progress.target}
          aria-valuenow={progress.done}
          aria-valuetext={_({ ...msg({ id: 'daily-goals.progress-value', message: '{done} of {target}' }), values: { done: progress.done, target: progress.target } })}
        ><span className="study-shell-goal__fill" style={{ width: `${progress.percent}%` }} /></span>
      ) : (
        <span className="study-shell-goal__bar" aria-hidden="true"><span className="study-shell-goal__fill" style={{ width: '0%' }} /></span>
      )}
      <p className="study-shell-goal__foot">
        {progress.state === 'counted'
          ? <span aria-hidden="true">{progress.done} / {progress.target}</span>
          : <span><span aria-hidden="true">— / {progress.target}</span><span className="sr-only">{_(msg({ id: 'daily-goals.not-counted', message: 'Not counted yet today' }))}</span></span>}
        <span className="study-shell-goal__xp">{_({ ...msg({ id: 'daily-goals.xp', message: '+{xp} XP' }), values: { xp: goal.xp } })}</span>
      </p>
    </section>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return <div className="flex items-center gap-1.5"><kbd className="study-shell-shortcuts__key px-1.5 py-0.5 bg-[var(--sf-surface)] border border-[var(--sf-border)] rounded shadow-xs font-mono font-bold text-[var(--sf-text)]">{keys}</kbd><span>{label}</span></div>;
}

import { ChevronLeft, ChevronRight, Focus, Keyboard, X } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flashcard } from '../../components/Flashcard';
import { ActiveRecallPrompt } from '../../components/flashcard/ActiveRecallPrompt';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { Lumi, type LumiPose } from '../../components/lumi/Lumi';
import { ReviewControls } from '../../components/study/ReviewControls';
import { isSupportedImageUrl } from '../../lib/mediaUrlPolicy';
import { triggerHaptic } from '../../lib/haptics';
import { triggerConfetti } from '../../lib/confetti';
import { getReducedMotionScrollBehavior } from '../../lib/motion';
import { playFlipSound, playRewardSound } from '../../lib/interactionSounds';
import { readLumiEnabled } from '../settings/lumi-preference';
import { readFocusModeEnabled, useFocusModePreference } from '../settings/focus-mode-preference';
import { SessionRecapModal } from './SessionRecapModal';
import type { RecallMode } from '../../lib/recall';
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
  reviewStatus?: 'idle' | 'saving' | 'sync-pending' | 'saved' | 'error';
  reviewError?: string | null;
  paused?: boolean;
  goodCount?: number;
  againCount?: number;
  weakCards?: CardData[];
  showRecap?: boolean;
  summary?: StudyReviewSummary;
  xpEarned?: number;
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
  readonly isComposing?: boolean;
  readonly nativeEvent?: { readonly isComposing: boolean };
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
  const answeredCount = summary?.saved ?? (externalGoodCount ?? sessionGoodCount) + (externalAgainCount ?? sessionAgainCount);
  const progressRatio = answeredCount / Math.max(cards.length, 1);
  const [weakCards, setWeakCards] = useState<CardData[]>([]);
  const [showRecap, setShowRecap] = useState(false);
  const [lumiReaction, setLumiReaction] = useState<LumiPose | null>(null);
  const ratingInFlightRef = useRef(false);

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
        setLumiReaction(effectiveRating === 'again' || effectiveRating === 'hard' ? 'oops' : 'happy');
      }

      const isPositive = effectiveRating === 'good' || effectiveRating === 'easy';
      setSessionXpEarned(previous => previous + settlement.xpAwarded);
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
    if (noModifiers && (event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar' || event.key === 'Enter')) {
      event.preventDefault();
      if (!revealed) {
        playFlipSound();
        onReveal();
      } else surface.querySelector<HTMLButtonElement>('[data-study-card] [data-flip-card]')?.click();
    } else if (noModifiers && event.key === 'ArrowRight') {
      event.preventDefault();
      onIndex(Math.min(cards.length - 1, index + 1));
    } else if (noModifiers && event.key === 'ArrowLeft') {
      event.preventDefault();
      onIndex(Math.max(0, index - 1));
    } else if (altShortcut && ['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      const ratings: Record<string, ReviewRating> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
      void handleRating(ratings[event.key]);
    } else if (altShortcut && event.key.toLocaleLowerCase() === 's') {
      event.preventDefault();
      if (!card.bookmarked) playRewardSound();
      void onBookmark(card.id);
    } else if (altShortcut && event.key.toLocaleLowerCase() === 'p') {
      event.preventDefault();
      surface.querySelector<HTMLButtonElement>(`[data-study-card] [aria-label="${_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}"]`)?.click();
    } else if (altShortcut && event.key.toLocaleLowerCase() === 'r') {
      event.preventDefault();
      surface.querySelector<HTMLButtonElement>(`[data-study-card] [aria-label="${_(msg({ id: 'flashcard.audio.check-pronunciation', message: 'Check pronunciation' }))}"]`)?.click();
    }
  }, [needsIntroduction, _, card?.bookmarked, cards.length, handleRating, index, onBookmark, onIndex, onReveal, paused, revealed]);

  if (!card) return null;


  return (
    <div ref={studySurfaceRef} tabIndex={-1} data-study-session data-study-state={revealed ? 'revealed' : 'prompt'} data-study-paused={paused ? 'true' : 'false'} onKeyDown={event => handleStudyShortcut(event, event.currentTarget)} className="practice-board practice-board--study mx-auto flex h-full max-w-5xl flex-col items-center px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-5 sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div data-study-header className="mb-3 flex w-full items-center gap-3">
        <button type="button" onClick={onClose} disabled={paused} className="crystal-chamfer-sm min-h-11 min-w-11 border border-[var(--sf-border)] bg-[var(--sf-surface-control)] p-2 text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none" aria-label={_(msg({ id: 'study.close', message: 'Close study mode' }))}>
          <X size={24} aria-hidden="true" />
        </button>
        <p data-study-title className="hidden min-w-max text-xs font-black uppercase tracking-[0.12em] text-[var(--sf-text-muted)] sm:block"><Trans {...msg({ id: 'study.progress', message: 'Study progress' })} /></p>
        <div data-study-progress role="progressbar" aria-label={_(msg({ id: 'study.progress', message: 'Study progress' }))} aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={answeredCount} className="min-w-0 flex flex-1 items-center gap-1">
          <div data-study-progress-segments className="flex min-w-0 flex-1 gap-1" aria-hidden="true">
            {Array.from({ length: 12 }, (_, segment) => (
              <span key={segment} data-study-progress-segment={(segment + 1) / 12 <= progressRatio ? 'complete' : 'pending'} />
            ))}
          </div>
          <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'study.card-count', message: '{current} / {total} saved' })} values={{ current: answeredCount, total: cards.length }} /></span>
        </div>
        <span data-study-timer aria-label={_(msg({ id: 'study.elapsed-time', message: 'Elapsed study time: {time}' }).id, { time: elapsedTime })} className="min-w-12 font-mono text-xs font-bold tabular-nums text-[var(--sf-text-muted)]">
          {elapsedTime}
        </span>
        <button type="button" data-study-focus-mode aria-label={_(msg({ id: 'study.focus-mode', message: 'Focus mode' }))} aria-pressed={focusModeEnabled} onClick={() => setFocusModeEnabled(!focusModeEnabled)} className={`grid min-h-11 min-w-11 place-items-center rounded-xl border bg-[var(--sf-surface-control)] focus-visible:outline-2 focus-visible:outline-offset-2 ${focusModeEnabled ? 'border-[var(--sf-brand)] text-[var(--sf-brand-text)]' : 'border-[var(--sf-border)] text-[var(--sf-text-muted)]'}`}>
          <Focus size={18} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setSummaryOpen(true)} className="min-h-11 rounded-xl px-3 text-sm font-bold focus-visible:outline-2"><Trans {...msg({ context: 'study-view.summary', message: 'Summary' })} /></button>
      </div>

      <div className="mb-2 flex min-h-7 w-full justify-end" aria-live="polite">
        {!focusModeEnabled && answeredCount >= 2 && <span data-study-combo={answeredCount} className="rounded-xl border border-[var(--sf-brand)] bg-[var(--sf-surface-raised)] px-3 py-1 font-display text-xs font-black uppercase tracking-wider text-[var(--sf-brand-text)]"><Trans {...msg({ context: 'study.combo', message: 'Combo ×{count}' })} values={{ count: answeredCount }} /></span>}
      </div>

      <label data-study-recall-mode className="mb-4 flex flex-wrap items-center justify-center gap-2 text-[11px] font-black uppercase tracking-widest text-[var(--sf-text-muted)]">
        <Trans {...msg({ context: 'study.recall-mode', message: 'Recall mode' })} />
        <select name="study-recall-mode" value={activeRecallMode} onChange={event => onRecallMode(resolveStudyRecallMode(card, event.target.value as RecallMode))} className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 text-sm normal-case tracking-normal text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2">
          <option value="target-to-native"><Trans {...msg({ context: 'study.recall-mode.target-to-native', message: '{targetLanguage} → {nativeLanguage}' })} values={{ targetLanguage, nativeLanguage }} /></option>
          <option value="adaptive"><Trans {...msg({ context: 'study.recall-mode.adaptive', message: 'Adaptive difficulty' })} /></option>
          <option value="native-to-target"><Trans {...msg({ context: 'study.recall-mode.native-to-target', message: '{nativeLanguage} → {targetLanguage}' })} values={{ targetLanguage, nativeLanguage }} /></option>
          <option value="image-to-word" disabled={!imageRecallAvailable}><Trans {...msg({ context: 'study.recall-mode.image-to-word', message: 'Image → Word' })} /></option>
          <option value="listen-to-word"><Trans {...msg({ context: 'study.recall-mode.listen-to-word', message: 'Listen → Word' })} /></option>
          <option value="cloze"><Trans {...msg({ context: 'study.recall-mode.cloze', message: 'Fill the sentence' })} /></option>
        </select>
      </label>

      {/* Swipeable Flashcard Container */}
      <div ref={studyCardRef} data-study-card className="relative mb-5 w-full max-w-3xl touch-pan-y select-none transition-transform duration-100 ease-out motion-reduce:transition-none" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={resetTouch}>
        {/* Swipe Feedback Badges */}
        {swipeBadge === 'good' && (
          <div className="absolute left-6 top-6 z-50 rounded-2xl border-2 border-emerald-400 bg-emerald-500/90 px-4 py-1.5 text-sm font-black uppercase tracking-widest text-white shadow-xl backdrop-blur-md">
            <Trans {...msg({ context: 'study.swipe.good', message: 'GOOD 👍' })} />
          </div>
        )}
        {swipeBadge === 'again' && (
          <div className="absolute right-6 top-6 z-50 rounded-2xl border-2 border-rose-400 bg-rose-500/90 px-4 py-1.5 text-sm font-black uppercase tracking-widest text-white shadow-xl backdrop-blur-md">
            <Trans {...msg({ context: 'study.swipe.again', message: 'AGAIN 👎' })} />
          </div>
        )}

        {!needsIntroduction && onLearnFirst && <button type="button" onClick={onLearnFirst} className="my-4 min-h-11 rounded-xl border border-[var(--sf-border)] px-4 py-2 font-bold"><Trans {...msg({ context: 'practice.learn-first', message: 'I don\'t know this — learn first' })} /></button>}
        <GsapEntrance animationKey={index} direction={direction} variant="step">
          {needsIntroduction ? (
            <section data-study-introduction className="mx-auto w-full max-w-2xl rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3 shadow-xl sm:p-5" aria-labelledby="study-introduction-heading">
              <div className="mb-4 text-center">
                <h2 id="study-introduction-heading" className="text-lg font-black text-[var(--sf-text)]"><Trans {...msg({ context: 'study-view.meet-this-word', message: 'Meet this word' })} /></h2>
                <p className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'study-view.take-a-moment-to-review-the-card-before-recall-practice', message: 'Take a moment to review the card before recall practice.' })} /></p>
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
                onClick={() => onBeginStudyRecall?.()}
                className="mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl bg-[var(--sf-brand)] px-4 py-3 text-sm font-black text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] motion-reduce:transition-none"
              ><Trans {...msg({ context: 'study-view.i-ve-reviewed-it-start-recall', message: 'I’ve reviewed it — start recall' })} /></button>
            </section>
          ) : revealed ? (
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
          ) : (
            <ActiveRecallPrompt
              card={card}
              mode={activeRecallMode}
              onReveal={onReveal}
              onImageUnavailable={handleImageUnavailable}
            />
          )}
        </GsapEntrance>
        {lumiReaction && (
          <div className="pointer-events-none absolute -bottom-5 -right-1 z-20 hidden sm:block" aria-hidden="true">
            <Lumi pose={lumiReaction} size={72} className="crystal-ornament drop-shadow-[0_8px_16px_var(--sf-shadow)]" />
          </div>
        )}
      </div>

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

      <div className="flex items-center gap-4 sm:gap-6">
        <button type="button" onClick={() => onIndex(Math.max(0, index - 1))} disabled={paused || index === 0} className="crystal-chamfer-sm min-h-11 min-w-11 border border-[var(--sf-border)] bg-[var(--sf-surface-control)] p-3 text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] transition hover:border-[var(--sf-brand)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transform-none motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50" aria-label={_(msg({ id: 'study.previous-card', message: 'Previous card' }))}>
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <div className="crystal-chamfer-sm border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-5 py-3 font-mono font-bold tabular-nums text-[var(--sf-brand-text)]">{index + 1} / {cards.length}</div>
        <button data-color-role="primary" type="button" onClick={() => onIndex(Math.min(cards.length - 1, index + 1))} disabled={paused || index === cards.length - 1} className="crystal-chamfer-sm min-h-11 min-w-11 bg-[var(--sf-brand)] p-3 text-[var(--sf-on-brand)] shadow-[var(--sf-panel-shadow)] transition hover:bg-[var(--sf-brand-hover)] hover:text-white active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transform-none motion-reduce:transition-none disabled:opacity-50" aria-label={_(msg({ id: 'study.next-card', message: 'Next card' }))}>
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
        weakCards={externalWeakCards ?? weakCards}
        targetLanguage={cards[0]?.language ?? 'en'}
      />

      <div className="mx-auto mt-8 hidden w-full max-w-sm rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-center shadow-xs md:block">
        <div className="mb-3 flex items-center justify-center gap-1.5 text-xs font-black text-[var(--sf-text-muted)]"><Keyboard size={13} className="text-[var(--sf-brand-text)]" aria-hidden="true" /><span><Trans {...msg({ context: 'study.shortcuts', message: 'Study shortcuts' })} /></span></div>
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

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return <div className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 bg-[var(--sf-surface)] border border-[var(--sf-border)] rounded shadow-xs font-mono font-bold text-[var(--sf-text)]">{keys}</kbd><span>{label}</span></div>;
}

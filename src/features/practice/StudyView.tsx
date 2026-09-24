import { ChevronLeft, ChevronRight, Keyboard, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flashcard } from '../../components/Flashcard';
import { ActiveRecallPrompt } from '../../components/flashcard/ActiveRecallPrompt';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { ReviewControls } from '../../components/study/ReviewControls';
import { isSupportedImageUrl } from '../../lib/mediaUrlPolicy';
import { triggerConfetti } from '../../lib/confetti';
import { triggerHaptic } from '../../lib/haptics';
import { getReducedMotionScrollBehavior } from '../../lib/motion';
import { playFlipSound, playRewardSound } from '../../lib/interactionSounds';
import { REVIEW_XP } from '../../lib/review-xp';
import { SessionRecapModal } from './SessionRecapModal';
import type { RecallMode } from '../../lib/recall';
import type { ReviewRating } from '../../lib/reviewScheduler';
import type { CardData } from '../../types/card';
import type { StudyRatingSettlement } from './usePracticeSession';

interface StudyViewProps {
  cards: CardData[];
  index: number;
  recallMode: RecallMode;
  revealed: boolean;
  reviewedCardId: string | null;
  reviewStatus?: 'idle' | 'saving' | 'sync-pending' | 'saved' | 'error';
  reviewError?: string | null;
  customDecks: string[];
  onClose: () => void;
  onRecallMode: (mode: RecallMode) => void;
  onReveal: () => void;
  onBookmark: (cardId: string) => void;
  onAssignDeck: (cardId: string, deckName: string | null) => void;
  onUpdateCard: (cardId: string, fields: Partial<CardData>) => void;
  onRate: (rating: ReviewRating) => Promise<StudyRatingSettlement>;
  onIndex: (index: number) => void;
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
    // Keep the same English-answer direction without asking the learner to
    // identify media that is no longer available.
    return 'vi-to-en';
  }
  return requestedMode;
}

export function StudyView({
  cards,
  index,
  recallMode,
  revealed,
  reviewedCardId,
  reviewStatus = 'idle',
  reviewError = null,
  customDecks,
  onClose,
  onRecallMode,
  onReveal,
  onBookmark,
  onAssignDeck,
  onUpdateCard,
  onRate,
  onIndex,
}: StudyViewProps) {
  const previousIndexRef = useRef(index);
  const direction: 1 | -1 = index < previousIndexRef.current ? -1 : 1;

  useEffect(() => {
    previousIndexRef.current = index;
  }, [index]);

  const card = cards[index];
  const imageKey = card && isSupportedImageUrl(card.imageUrl)
    ? `${card.id}:${card.imageUrl}`
    : null;
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null);
  const imageUnavailable = imageKey !== null && failedImageKey === imageKey;
  const activeRecallMode = resolveStudyRecallMode(card, recallMode, imageUnavailable);
  const imageRecallAvailable = Boolean(imageKey && !imageUnavailable);
  const ratingRef = useRef<HTMLDivElement | null>(null);
  const studySurfaceRef = useRef<HTMLDivElement | null>(null);
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
  const [weakCards, setWeakCards] = useState<CardData[]>([]);
  const [showRecap, setShowRecap] = useState(false);
  const [provisionalReviewPending, setProvisionalReviewPending] = useState(false);
  const ratingInFlightRef = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
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
      triggerHaptic('success');
      void handleRating('good');
    } else if (revealed && deltaX < -120) {
      // Swiped Left -> Again
      triggerHaptic('medium');
      void handleRating('again');
    }
  };

  const handleRating = async (rating: ReviewRating) => {
    if (!card || ratingInFlightRef.current) return;
    ratingInFlightRef.current = true;
    try {
      const settlement = await onRate(rating);
      if (settlement === 'sync-pending') {
        setProvisionalReviewPending(true);
        if (index < cards.length - 1) onIndex(index + 1);
        return;
      }
      if (settlement !== 'committed') return;

      const isPositive = rating === 'good' || rating === 'easy';
      if (isPositive) {
        setSessionGoodCount(prev => prev + 1);
      } else {
        setSessionAgainCount(prev => prev + 1);
        setWeakCards(prev => [...prev.filter(c => c.id !== card.id), card]);
      }

      if (index === cards.length - 1) {
        if (isPositive) triggerConfetti(0.5, 0.5);
        setShowRecap(true);
      } else onIndex(index + 1);
    } finally {
      ratingInFlightRef.current = false;
    }
  };

  const handleStudyShortcut = useCallback((event: StudyKeyboardEvent, surface: HTMLDivElement) => {
    if (event.defaultPrevented || event.nativeEvent?.isComposing || event.isComposing) return;
    const target = event.target as { closest?: (selectors: string) => Element | null } | null;
    if (target?.closest?.('button, a, input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [data-radix-popper-content-wrapper]')) return;

    const noModifiers = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const altShortcut = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (noModifiers && (event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar' || event.key === 'Enter')) {
      event.preventDefault();
      playFlipSound();
      if (!revealed) onReveal();
      else surface.querySelector<HTMLButtonElement>('[data-study-card] [data-flip-card]')?.click();
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
      surface.querySelector<HTMLButtonElement>('[data-study-card] [aria-label="Play pronunciation"]')?.click();
    } else if (altShortcut && event.key.toLocaleLowerCase() === 'r') {
      event.preventDefault();
      surface.querySelector<HTMLButtonElement>('[data-study-card] [aria-label="Check pronunciation"]')?.click();
    }
  }, [card.bookmarked, cards.length, handleRating, index, onBookmark, onIndex, onReveal, revealed]);

  if (!card) return null;

  return (
    <div ref={studySurfaceRef} tabIndex={-1} data-study-session onKeyDown={event => handleStudyShortcut(event, event.currentTarget)} className="mx-auto flex h-full max-w-4xl flex-col items-center px-2 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pt-6 sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div className="mb-4 flex w-full items-center justify-between gap-3 px-2">
        <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-full p-2 text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2 motion-reduce:transition-none" aria-label="Close study mode">
          <X size={24} aria-hidden="true" />
        </button>
        <div data-study-progress role="progressbar" aria-label="Study progress" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={index + 1} className="min-w-0 flex-1 max-w-sm rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-2.5 text-center shadow-xs">
          <div className="flex items-center justify-between gap-3 text-xs font-bold text-[var(--sf-text-muted)]">
            <span>Study progress</span>
            <span className="tabular-nums">Card {index + 1} / {cards.length}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--sf-surface-raised)]" aria-hidden="true">
            <div className="h-full rounded-full bg-[var(--sf-brand)] transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${((index + 1) / Math.max(cards.length, 1)) * 100}%` }} />
          </div>
        </div>
        <div className="w-10" aria-hidden="true" />
      </div>

      <label className="mb-4 flex flex-wrap items-center justify-center gap-3 text-xs font-black uppercase tracking-widest text-[var(--sf-text-muted)]">
        Recall mode
        <select name="study-recall-mode" value={activeRecallMode} onChange={event => onRecallMode(resolveStudyRecallMode(card, event.target.value as RecallMode))} className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 text-sm normal-case tracking-normal text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2">
          <option value="en-to-vi">English → Vietnamese</option>
          <option value="adaptive">Adaptive difficulty</option>
          <option value="vi-to-en">Vietnamese → English</option>
          <option value="image-to-word" disabled={!imageRecallAvailable}>Image → Word</option>
          <option value="listen-to-word">Listen → Word</option>
          <option value="cloze">Fill the sentence</option>
        </select>
      </label>

      {/* Swipeable Flashcard Container */}
      <div ref={studyCardRef} data-study-card className="relative mb-5 w-full touch-pan-y select-none transition-transform duration-100 ease-out motion-reduce:transition-none" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={resetTouch}>
        {/* Swipe Feedback Badges */}
        {swipeBadge === 'good' && (
          <div className="absolute left-6 top-6 z-50 rounded-2xl border-2 border-emerald-400 bg-emerald-500/90 px-4 py-1.5 text-sm font-black uppercase tracking-widest text-white shadow-xl backdrop-blur-md">
            GOOD 👍
          </div>
        )}
        {swipeBadge === 'again' && (
          <div className="absolute right-6 top-6 z-50 rounded-2xl border-2 border-rose-400 bg-rose-500/90 px-4 py-1.5 text-sm font-black uppercase tracking-widest text-white shadow-xl backdrop-blur-md">
            AGAIN 👎
          </div>
        )}

        <GsapEntrance animationKey={index} direction={direction} variant="step">
          {revealed ? (
            <Flashcard
              data={card}
              initialSide={activeRecallMode === 'en-to-vi' || (activeRecallMode === 'adaptive' && (card.correctStreak || 0) === 0) ? 'back' : 'front'}
              imagePriority
              onToggleBookmark={onBookmark}
              customDecks={customDecks}
              onAssignDeck={onAssignDeck}
              onUpdateCard={onUpdateCard}
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
      </div>

      <div ref={ratingRef} data-study-rating className="w-full max-w-md scroll-mt-4">
        <ReviewControls
          revealed={revealed}
          reviewed={reviewedCardId === card.id}
          saving={reviewStatus === 'saving' || reviewStatus === 'sync-pending'}
          error={reviewError}
          lastRating={card.reviewHistory?.at(-1)?.rating}
          onRate={handleRating}
        />
        {(reviewStatus === 'sync-pending' || provisionalReviewPending) && (
          <p data-study-provisional className="mt-2 text-center text-sm font-semibold text-[var(--sf-text-muted)]" role="status">
            Review saved on this device and waiting to sync.
          </p>
        )}
      </div>

      <div className="flex items-center gap-4 sm:gap-6">
        <button type="button" onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0} className="min-h-14 min-w-14 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 text-[var(--sf-text)] shadow-md transition hover:border-[var(--sf-brand)] active:scale-95 focus-visible:outline-2 motion-reduce:transform-none motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50" aria-label="Previous card">
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <div className="rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-5 py-3 font-mono font-bold tabular-nums text-[var(--sf-brand-text)]">{index + 1} / {cards.length}</div>
        <button data-color-role="primary" type="button" onClick={() => onIndex(Math.min(cards.length - 1, index + 1))} disabled={index === cards.length - 1} className="min-h-14 min-w-14 rounded-full bg-[var(--sf-brand)] p-4 text-[var(--sf-on-brand)] shadow-md transition hover:bg-[var(--sf-brand-hover)] hover:text-white active:scale-95 focus-visible:outline-2 motion-reduce:transform-none motion-reduce:transition-none disabled:opacity-50" aria-label="Next card">
          <ChevronRight size={24} aria-hidden="true" />
        </button>
      </div>

      <SessionRecapModal
        open={showRecap}
        onClose={() => setShowRecap(false)}
        totalCards={cards.length}
        goodCount={sessionGoodCount}
        againCount={sessionAgainCount}
        xpEarned={(sessionGoodCount + sessionAgainCount) * REVIEW_XP}
        weakCards={weakCards}
      />

      <div className="mx-auto mt-8 hidden w-full max-w-sm rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-center shadow-xs md:block">
        <div className="mb-3 flex items-center justify-center gap-1.5 text-xs font-black text-[var(--sf-text-muted)]"><Keyboard size={13} className="text-[var(--sf-brand-text)]" aria-hidden="true" /><span>Study shortcuts</span></div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[10px] text-[var(--sf-text-muted)] font-medium text-left">
          <Shortcut keys="Space" label="Flip card" />
          <Shortcut keys="← / →" label="Previous / next" />
          <div className="col-span-2 border-t border-[var(--sf-border)] pt-2.5"><Shortcut keys="Alt+1…4" label="Rate memory" /></div>
          <div className="col-span-2 border-t border-[var(--sf-border)] pt-2.5"><Shortcut keys="Alt+S / Alt+P / Alt+R" label="Star / play / speak" /></div>
        </div>
      </div>
    </div>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return <div className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 bg-[var(--sf-surface)] border border-[var(--sf-border)] rounded shadow-xs font-mono font-bold text-[var(--sf-text)]">{keys}</kbd><span>{label}</span></div>;
}

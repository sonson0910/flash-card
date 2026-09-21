import { ChevronLeft, ChevronRight, Keyboard, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flashcard } from '../../components/Flashcard';
import { ActiveRecallPrompt } from '../../components/flashcard/ActiveRecallPrompt';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { ReviewControls } from '../../components/study/ReviewControls';
import { isSupportedImageUrl } from '../../lib/mediaUrlPolicy';
import { triggerHaptic } from '../../lib/haptics';
import { triggerConfetti } from '../../lib/confetti';
import { playFlipSound, playRewardSound } from '../../lib/interactionSounds';
import { getReducedMotionScrollBehavior } from '../../lib/motion';
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
  onRecallMode: (mode: RecallMode) => void;
  onReveal: () => void;
  onBeginStudyRecall?: () => void;
  onBookmark: (cardId: string) => void;
  onAssignDeck: (cardId: string, deckName: string | null) => void;
  onUpdateCard: (cardId: string, fields: Partial<CardData>) => void;
  onRate: (rating: ReviewRating) => Promise<StudyRatingSettlement>;
  onIndex: (index: number) => void;
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
  needsIntroduction = false,
  reviewedCardId,
  reviewStatus = 'idle',
  reviewError = null,
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
  onRecallMode,
  onReveal,
  onBeginStudyRecall,
  onBookmark,
  onAssignDeck,
  onUpdateCard,
  onRate,
  onIndex,
}: StudyViewProps) {
  const previousIndexRef = useRef(index);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [sessionGoodCount, setSessionGoodCount] = useState(0);
  const [sessionAgainCount, setSessionAgainCount] = useState(0);
  const [sessionWeakCards, setSessionWeakCards] = useState<CardData[]>([]);
  const [sessionRecapOpen, setSessionRecapOpen] = useState(false);
  const [provisionalReviewPending, setProvisionalReviewPending] = useState(false);
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
  const ratingInFlightRef = useRef(false);
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

  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (needsIntroduction) return;
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (needsIntroduction || touchStartX === null) return;
    const deltaX = e.touches[0].clientX - touchStartX;
    // Dampen drag effect
    setDragOffset(deltaX * 0.75);
  };

  const handleTouchEnd = () => {
    if (needsIntroduction || touchStartX === null || !revealed) {
      setTouchStartX(null);
      setDragOffset(0);
      return;
    }
    if (dragOffset > 90) {
      // Swiped Right -> Good
      triggerHaptic('success');
      handleRating('good');
    } else if (dragOffset < -90) {
      // Swiped Left -> Again
      triggerHaptic('medium');
      handleRating('again');
    }
    setTouchStartX(null);
    setDragOffset(0);
  };

  const handleRating = async (rating: ReviewRating) => {
    if (needsIntroduction) return;
    if (ratingInFlightRef.current) return;
    ratingInFlightRef.current = true;
    try {
      const settlement = await onRate(rating);
      if (settlement === 'sync-pending') {
        setProvisionalReviewPending(true);
        if (index < cards.length - 1) onIndex(index + 1);
        return;
      }
      if (settlement !== 'committed') return;
      if (externalGoodCount === undefined || externalAgainCount === undefined) {
        if (rating === 'good' || rating === 'easy') setSessionGoodCount(previous => previous + 1);
        else {
          setSessionAgainCount(previous => previous + 1);
          if (card) setSessionWeakCards(previous => [...previous.filter(item => item.id !== card.id), card]);
        }
      }
      if (index < cards.length - 1) {
        onIndex(index + 1);
      } else if (externalShowRecap === undefined) {
        if (rating === 'good' || rating === 'easy') triggerConfetti(0.5, 0.5);
        setSessionRecapOpen(true);
      }
    } finally {
      ratingInFlightRef.current = false;
    }
  };

  const handleStudyShortcut = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || needsIntroduction) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [data-radix-popper-content-wrapper], [data-card-control]')) return;
    const noModifiers = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const altShortcut = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (noModifiers && (event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar' || event.key === 'Enter')) {
      event.preventDefault();
      playFlipSound();
      if (!revealed) onReveal();
      else event.currentTarget.querySelector<HTMLButtonElement>('[data-study-card] [data-flip-card]')?.click();
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
      if (!card?.bookmarked) playRewardSound();
      if (card) void onBookmark(card.id);
    } else if (altShortcut && event.key.toLocaleLowerCase() === 'p') {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLButtonElement>('[data-study-card] [aria-label="Play pronunciation"]')?.click();
    } else if (altShortcut && event.key.toLocaleLowerCase() === 'r') {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLButtonElement>('[data-study-card] [aria-label="Check word match"]')?.click();
    }
  }, [cards.length, card, handleRating, index, needsIntroduction, onBookmark, onIndex, onReveal, revealed]);

  if (!card) return null;
  const goodCount = externalGoodCount ?? sessionGoodCount;
  const againCount = externalAgainCount ?? sessionAgainCount;
  const weakCards = externalWeakCards ?? sessionWeakCards;
  const showRecap = externalShowRecap ?? sessionRecapOpen;
  const xpEarned = externalXpEarned ?? (sessionGoodCount * 5 + sessionAgainCount * 2);
  const completedCount = Math.min(cards.length, goodCount + againCount);

  return (
    <div data-study-session tabIndex={-1} onKeyDown={handleStudyShortcut} className="mx-auto flex h-full max-w-4xl flex-col items-center py-3 sm:py-6">
      <div className="mb-4 flex w-full items-center justify-between gap-3 px-2">
        <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-full p-2 text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2 motion-reduce:transition-none" aria-label="Close study mode">
          <X size={24} aria-hidden="true" />
        </button>
        <div data-study-progress role="progressbar" aria-label="Study progress" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={completedCount} className="min-w-0 flex-1 max-w-sm rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-2.5 text-center shadow-xs">
          <div className="flex items-center justify-between gap-3 text-xs font-bold text-[var(--sf-text-muted)]">
            <span>Study progress</span>
            <span className="tabular-nums">{completedCount} / {cards.length} saved</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--sf-surface-raised)]" aria-hidden="true">
            <div className="h-full rounded-full bg-[var(--sf-brand)] transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${(completedCount / Math.max(cards.length, 1)) * 100}%` }} />
          </div>
        </div>
        <button type="button" onClick={() => setSummaryOpen(true)} className="min-h-11 rounded-xl px-3 text-sm font-bold focus-visible:outline-2">Summary</button>
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
      <div data-study-card className="relative mb-5 w-full touch-pan-y select-none transition-transform duration-100 ease-out" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} style={{ transform: dragOffset !== 0 ? `translateX(${dragOffset}px) rotate(${dragOffset * 0.04}deg)` : undefined }}>
        {/* Swipe Feedback Badges */}
        {dragOffset > 40 && (
          <div className="absolute left-6 top-6 z-50 rounded-2xl border-2 border-emerald-400 bg-emerald-500/90 px-4 py-1.5 text-sm font-black uppercase tracking-widest text-white shadow-xl backdrop-blur-md">
            GOOD 👍
          </div>
        )}
        {dragOffset < -40 && (
          <div className="absolute right-6 top-6 z-50 rounded-2xl border-2 border-rose-400 bg-rose-500/90 px-4 py-1.5 text-sm font-black uppercase tracking-widest text-white shadow-xl backdrop-blur-md">
            AGAIN 👎
          </div>
        )}

        <GsapEntrance animationKey={index} direction={direction} variant="step">
          {needsIntroduction ? (
            <section data-study-introduction className="mx-auto w-full max-w-2xl rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3 shadow-xl sm:p-5" aria-labelledby="study-introduction-heading">
              <div className="mb-4 text-center">
                <h2 id="study-introduction-heading" className="text-lg font-black text-[var(--sf-text)]">Meet this word</h2>
                <p className="mt-1 text-sm text-[var(--sf-text-muted)]">Take a moment to review the card before recall practice.</p>
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
              >
                I’ve reviewed it — start recall
              </button>
            </section>
          ) : revealed ? (
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

      {!needsIntroduction && (
        <div ref={ratingRef} data-study-rating className="w-full max-w-md scroll-mt-4">
          {onLearnFirst && reviewedCardId !== card.id && reviewStatus === 'idle' && <button type="button" onClick={onLearnFirst} className="min-h-11 w-full rounded-xl border border-[var(--sf-border)] px-3 text-sm font-bold focus-visible:outline-2">I don't know this — learn first</button>}
          <ReviewControls
            revealed={revealed}
            reviewed={reviewedCardId === card.id}
            saving={reviewStatus === 'saving' || reviewStatus === 'sync-pending'}
            error={reviewError}
            lastRating={card.reviewHistory?.at(-1)?.rating}
            onRate={handleRating}
          />
          {(reviewStatus === 'sync-pending' || provisionalReviewPending) && <p data-study-provisional className="mt-2 text-center text-sm font-semibold text-[var(--sf-text-muted)]" role="status">Review saved on this device and waiting to sync.</p>}
        </div>
      )}

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
        open={showRecap || summaryOpen}
        onClose={() => { setSummaryOpen(false); setSessionRecapOpen(false); if (externalShowRecap) (onDismissRecap ?? onClose)(); }}
        summary={summary}
        onRetryWeak={onRetryWeak ? () => { setSummaryOpen(false); onRetryWeak(); } : undefined}
        totalCards={cards.length}
        goodCount={goodCount}
        againCount={againCount}
        xpEarned={xpEarned}
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

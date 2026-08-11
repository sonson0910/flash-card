import { ChevronLeft, ChevronRight, Keyboard, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flashcard } from '../../components/Flashcard';
import { ActiveRecallPrompt } from '../../components/flashcard/ActiveRecallPrompt';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { ReviewControls } from '../../components/study/ReviewControls';
import { isSupportedImageUrl } from '../../lib/mediaUrlPolicy';
import type { RecallMode } from '../../lib/recall';
import type { ReviewRating } from '../../lib/reviewScheduler';
import type { CardData } from '../../types/card';

interface StudyViewProps {
  cards: CardData[];
  index: number;
  recallMode: RecallMode;
  revealed: boolean;
  reviewedCardId: string | null;
  reviewStatus?: 'idle' | 'saving' | 'saved' | 'error';
  reviewError?: string | null;
  customDecks: string[];
  onClose: () => void;
  onRecallMode: (mode: RecallMode) => void;
  onReveal: () => void;
  onBookmark: (cardId: string) => void;
  onAssignDeck: (cardId: string, deckName: string | null) => void;
  onUpdateCard: (cardId: string, fields: Partial<CardData>) => void;
  onRate: (rating: ReviewRating) => void;
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
  const handleImageUnavailable = useCallback(() => {
    if (imageKey) setFailedImageKey(imageKey);
  }, [imageKey]);

  useEffect(() => {
    if (activeRecallMode !== recallMode) onRecallMode(activeRecallMode);
  }, [activeRecallMode, onRecallMode, recallMode]);

  if (!card) return null;

  return (
    <div className="max-w-4xl mx-auto flex flex-col items-center h-full pt-10">
      <div className="w-full flex items-center justify-between mb-8 px-4">
        <button onClick={onClose} className="min-w-11 min-h-11 p-2 hover:bg-[var(--sf-surface-raised)] rounded-full transition-colors text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]" aria-label="Close study mode">
          <X size={24} />
        </button>
        <div className="text-sm font-bold text-[var(--sf-text-muted)]">Card {index + 1} / {cards.length}</div>
        <div className="w-10" aria-hidden="true" />
      </div>

      <label className="mb-5 flex items-center gap-3 text-[11px] font-black uppercase tracking-widest text-[var(--sf-text-muted)]">
        Recall mode
        <select value={activeRecallMode} onChange={event => onRecallMode(resolveStudyRecallMode(card, event.target.value as RecallMode))} className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 text-sm normal-case tracking-normal text-[var(--sf-text)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-brand)]">
          <option value="en-to-vi">English → Vietnamese</option>
          <option value="adaptive">Adaptive difficulty</option>
          <option value="vi-to-en">Vietnamese → English</option>
          <option value="image-to-word" disabled={!imageRecallAvailable}>Image → Word</option>
          <option value="listen-to-word">Listen → Word</option>
          <option value="cloze">Fill the sentence</option>
        </select>
      </label>

      <div className="w-full mb-8 relative">
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

      <ReviewControls
        revealed={revealed}
        reviewed={reviewedCardId === card.id}
        saving={reviewStatus === 'saving'}
        error={reviewError}
        lastRating={card.reviewHistory?.at(-1)?.rating}
        onRate={onRate}
      />

      <div className="flex items-center gap-6">
        <button onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0} className="p-4 bg-[var(--sf-surface)] border border-[var(--sf-border)] rounded-full shadow-md text-[var(--sf-text)] hover:border-[var(--sf-brand)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-95" aria-label="Previous card">
          <ChevronLeft size={24} />
        </button>
        <div className="px-6 py-3 bg-[var(--sf-surface-raised)] border border-[var(--sf-border)] text-[var(--sf-brand-text)] rounded-2xl font-bold font-mono">{index + 1} / {cards.length}</div>
        <button data-color-role="primary" onClick={() => onIndex(Math.min(cards.length - 1, index + 1))} disabled={index === cards.length - 1} className="p-4 bg-[var(--sf-brand)] rounded-full shadow-md text-[var(--sf-on-brand)] hover:bg-[var(--sf-brand-hover)] hover:text-white disabled:opacity-50 transition-colors active:scale-95" aria-label="Next card">
          <ChevronRight size={24} />
        </button>
      </div>

      <div className="hidden md:block mt-8 bg-[var(--sf-surface-raised)] p-4 rounded-3xl border border-[var(--sf-border)] max-w-sm w-full mx-auto text-center shadow-xs">
        <div className="flex items-center justify-center gap-1.5 text-xs font-black text-[var(--sf-text-muted)] mb-3"><Keyboard size={13} className="text-[var(--sf-brand-text)]" /><span>Study shortcuts</span></div>
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

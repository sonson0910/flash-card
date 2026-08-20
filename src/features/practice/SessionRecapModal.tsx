import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, RotateCcw, Sparkles, Trophy, X } from 'lucide-react';
import type { CardData } from '../../types/card';

interface SessionRecapModalProps {
  open: boolean;
  onClose: () => void;
  onRetryWeak?: () => void;
  totalCards: number;
  goodCount: number;
  againCount: number;
  xpEarned: number;
  weakCards: CardData[];
}

export function SessionRecapModal({
  open,
  onClose,
  onRetryWeak,
  totalCards,
  goodCount,
  againCount,
  xpEarned,
  weakCards,
}: SessionRecapModalProps) {
  const accuracy = totalCards > 0 ? Math.round((goodCount / totalCards) * 100) : 100;

  return (
    <Dialog.Root open={open} onOpenChange={openState => !openState && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-2xl outline-none sm:p-7"
          aria-describedby="session-recap-description"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/20">
                <Trophy size={24} />
              </div>
              <div>
                <Dialog.Title className="text-xl font-black text-[var(--sf-text)] sm:text-2xl">
                  Session Complete!
                </Dialog.Title>
                <Dialog.Description id="session-recap-description" className="text-xs text-[var(--sf-text-muted)]">
                  Review session performance summary
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]"
              aria-label="Close recap"
            >
              <X size={18} />
            </Dialog.Close>
          </div>

          {/* Stats Grid */}
          <div className="mt-6 grid grid-cols-3 gap-2.5 text-center">
            <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--sf-text-muted)]">
                Reviewed
              </span>
              <span className="mt-1 block text-2xl font-black tabular-nums text-[var(--sf-text)]">
                {totalCards}
              </span>
            </div>
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-3">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Retained
              </span>
              <span className="mt-1 block text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-300">
                {accuracy}%
              </span>
            </div>
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                XP Earned
              </span>
              <span className="mt-1 block text-2xl font-black tabular-nums text-amber-600 dark:text-amber-300">
                +{xpEarned}
              </span>
            </div>
          </div>

          {/* Breakdown summary */}
          <div className="mt-4 space-y-2 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3.5 text-xs font-semibold">
            <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={14} />
                <span>Mastered (Good / Easy)</span>
              </span>
              <span className="font-bold tabular-nums">{goodCount} words</span>
            </div>
            <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
              <span className="flex items-center gap-1.5">
                <RotateCcw size={14} />
                <span>Needs Review (Again / Hard)</span>
              </span>
              <span className="font-bold tabular-nums">{againCount} words</span>
            </div>
          </div>

          {/* Weak cards preview if any */}
          {weakCards.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-[var(--sf-text-muted)]">
                Words to reinforce ({weakCards.length})
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1 scrollbar-none">
                {weakCards.map(card => (
                  <span
                    key={card.id}
                    className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-600 dark:text-rose-300"
                  >
                    {card.word}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
            {weakCards.length > 0 && onRetryWeak && (
              <button
                type="button"
                onClick={onRetryWeak}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 px-4 text-xs font-bold text-white shadow-md transition-all hover:opacity-90 active:scale-[0.98]"
              >
                <RotateCcw size={15} />
                <span>Retry {weakCards.length} weak words</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 text-xs font-bold text-[var(--sf-on-brand)] shadow-md transition-all hover:bg-[var(--sf-brand-hover)] active:scale-[0.98]"
            >
              <Sparkles size={15} />
              <span>Continue learning</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

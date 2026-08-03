import { lazy, Suspense, useState, type RefObject } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { BarChart3, BookOpen, Check, Clock3, Copy, Gamepad2, Languages, Share2, Trash2, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { GsapEntrance } from './motion/GsapEntrance';

const StatsCharts = lazy(() => import('./stats/StatsCharts'));

interface StatsData {
  total: number;
  learned: number;
  learning: number;
  dueToday: number;
  categoryChart: Array<{ name: string; value: number }>;
  categoryChartIsPartial: boolean;
  difficultyChart: Array<{ name: string; value: number; color: string }>;
  xpChartData: Array<{ date: string; XP: number }>;
}

interface AppOverlaysProps {
  shareLink: string | null;
  setShareLink: (value: string | null) => void;
  canRevokeShare: boolean;
  revokeShare: () => Promise<void>;
  isSharing: boolean;
  isPracticeMenuOpen: boolean;
  setIsPracticeMenuOpen: (value: boolean) => void;
  startQuiz: () => Promise<void>;
  startSpelling: () => Promise<void>;
  visibleLibraryCount: number;
  generateStory: () => Promise<void>;
  isStatsOpen: boolean;
  setIsStatsOpen: (value: boolean) => void;
  statsData: StatsData;
  isDarkMode: boolean;
  showClearConfirm: boolean;
  setShowClearConfirm: (value: boolean) => void;
  clearAll: () => Promise<void>;
  isLoading: boolean;
  shareOpenerRef: RefObject<HTMLElement | null>;
  practiceOpenerRef: RefObject<HTMLElement | null>;
  statsOpenerRef: RefObject<HTMLElement | null>;
  clearOpenerRef: RefObject<HTMLElement | null>;
}

const overlayClass = 'fixed inset-0 z-50 bg-slate-950/72';
const modalClass = 'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text)] shadow-2xl outline-none';

export function AppOverlays({
  shareLink, setShareLink, canRevokeShare, revokeShare, isSharing,
  isPracticeMenuOpen, setIsPracticeMenuOpen, startQuiz,
  startSpelling, visibleLibraryCount, generateStory, isStatsOpen, setIsStatsOpen,
  statsData, isDarkMode, showClearConfirm, setShowClearConfirm, clearAll, isLoading,
  shareOpenerRef, practiceOpenerRef, statsOpenerRef, clearOpenerRef,
}: AppOverlaysProps) {
  const [copied, setCopied] = useState(false);

  const copyShareLink = async () => {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
  };

  const restoreFocus = (event: Event, openerRef: RefObject<HTMLElement | null>) => {
    event.preventDefault();
    // WebKit can keep the page inert until the controlled portal has finished
    // unmounting. Move focus in the next task and frame so the opener is active
    // again across Chromium, Firefox and Safari.
    window.setTimeout(() => window.requestAnimationFrame(() => {
      const fallbackHeading = document.querySelector<HTMLElement>('main h1');
      const target = openerRef.current?.isConnected ? openerRef.current : fallbackHeading;
      target?.focus({ preventScroll: true });
    }), 0);
  };

  return (
    <>
      <Dialog.Root open={Boolean(shareLink)} onOpenChange={open => {
        if (!open) {
          setCopied(false);
          setShareLink(null);
        }
      }}>
        <Dialog.Portal>
          <Dialog.Overlay data-motion-overlay className={overlayClass} />
          <Dialog.Content asChild onCloseAutoFocus={event => restoreFocus(event, shareOpenerRef)}>
            <GsapEntrance animationKey={Boolean(shareLink)} variant="result" data-motion-dialog="true" className={cn(modalClass, 'max-w-sm overflow-hidden p-6 text-center')}>
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)]">
                <Share2 size={26} />
              </div>
              <Dialog.Title className="text-balance text-xl font-black text-[var(--sf-text)]">Your deck is ready to share</Dialog.Title>
              <Dialog.Description className="mt-2 text-pretty text-sm leading-relaxed text-[var(--sf-text-muted)]">Send this link so friends can add the vocabulary deck to their library.</Dialog.Description>

              <div className="mt-6 flex items-center gap-2 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-2">
                <input type="text" readOnly value={shareLink || ''} aria-label="Vocabulary deck share link" className="min-w-0 flex-1 bg-transparent px-2 text-sm font-medium text-[var(--sf-text)] outline-none" />
                <button type="button" onClick={() => void copyShareLink()} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-[var(--sf-brand)] text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white" aria-label="Copy share link">
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </button>
              </div>
              <p className="mt-2 min-h-5 text-xs font-semibold text-emerald-700 dark:text-emerald-300" aria-live="polite">{copied ? 'Link copied' : ''}</p>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {canRevokeShare ? (
                  <button
                    type="button"
                    disabled={isSharing}
                    onClick={() => void revokeShare()}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 font-bold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    {isSharing ? 'Revoking…' : 'Revoke link'}
                  </button>
                ) : null}
                <Dialog.Close className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-3 font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]">Close</Dialog.Close>
              </div>
            </GsapEntrance>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={isPracticeMenuOpen} onOpenChange={setIsPracticeMenuOpen}>
        <Dialog.Portal>
          <Dialog.Overlay data-motion-overlay className={overlayClass} />
          <Dialog.Content asChild onCloseAutoFocus={event => restoreFocus(event, practiceOpenerRef)}>
            <GsapEntrance animationKey={isPracticeMenuOpen} variant="result" data-motion-dialog="true" className={cn(modalClass, 'max-h-[calc(100dvh-4rem)] max-w-md overflow-y-auto p-6')}>
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <Dialog.Title className="text-balance text-xl font-black text-[var(--sf-text)]">Choose a practice mode</Dialog.Title>
                  <Dialog.Description className="mt-1 text-pretty text-sm text-[var(--sf-text-muted)]">Each mode strengthens a different memory skill.</Dialog.Description>
                </div>
                <Dialog.Close className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)]" aria-label="Close practice menu"><X size={18} /></Dialog.Close>
              </div>

              <div className="space-y-3">
                <PracticeChoice icon={Gamepad2} title="Multiple-choice quiz" description="Recognise the right meaning from four choices." onClick={() => void startQuiz()} />
                <PracticeChoice icon={Languages} title="Spelling practice" description="Listen, recall, and type each word precisely." onClick={() => void startSpelling()} />
                <PracticeChoice
                  icon={BookOpen}
                  title="Context story"
                  description={visibleLibraryCount < 5 ? `Add ${5 - visibleLibraryCount} more cards to unlock this mode.` : 'Read a story built from your own vocabulary.'}
                  disabled={visibleLibraryCount < 5}
                  onClick={() => {
                    void generateStory();
                    setIsPracticeMenuOpen(false);
                  }}
                />
              </div>
            </GsapEntrance>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={isStatsOpen} onOpenChange={setIsStatsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay data-motion-overlay className={overlayClass} />
          <Dialog.Content asChild onCloseAutoFocus={event => restoreFocus(event, statsOpenerRef)}>
            <GsapEntrance animationKey={isStatsOpen} variant="result" data-motion-dialog="true" className={cn(modalClass, 'max-h-[calc(100dvh-2rem)] max-w-5xl overflow-y-auto p-5 sm:p-8')}>
              <div className="mb-8 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)]"><BarChart3 size={23} /></div>
                  <div>
                    <Dialog.Title className="text-balance text-2xl font-black text-[var(--sf-text)]">Learning insights</Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm text-[var(--sf-text-muted)]">Track your learning rhythm and memory strength.</Dialog.Description>
                  </div>
                </div>
                <Dialog.Close className="flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)]" aria-label="Close learning insights"><X size={22} /></Dialog.Close>
              </div>

              <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatMetric label="Total cards" value={statsData.total} tone="cyan" />
                <StatMetric label="Mastered" value={statsData.learned} tone="emerald" />
                <StatMetric label="Learning" value={statsData.learning} tone="slate" />
                <StatMetric label="Due today" value={statsData.dueToday} tone="amber" icon={Clock3} />
              </div>

              <Suspense fallback={<div className="skeleton-sheen min-h-72 rounded-2xl border border-[var(--sf-border)]" role="status"><span className="sr-only">Loading charts</span></div>}>
                <StatsCharts darkMode={isDarkMode} data={statsData} />
              </Suspense>
            </GsapEntrance>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay data-motion-overlay className={overlayClass} />
          <AlertDialog.Content asChild onCloseAutoFocus={event => restoreFocus(event, clearOpenerRef)}>
            <GsapEntrance animationKey={showClearConfirm} variant="result" data-motion-dialog="true" className={cn(modalClass, 'max-w-md p-6')}>
              <AlertDialog.Title className="text-balance text-xl font-black text-[var(--sf-text)]">Clear the entire library?</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-pretty leading-relaxed text-[var(--sf-text-muted)]">Every card in the current library will be deleted. This action cannot be undone.</AlertDialog.Description>
              <div className="mt-7 flex justify-end gap-3">
                <AlertDialog.Cancel className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-2 font-semibold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]">Keep library</AlertDialog.Cancel>
                <AlertDialog.Action
                  onClick={() => void clearAll()}
                  disabled={isLoading}
                  className="min-h-11 rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white transition-colors hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete everything
                </AlertDialog.Action>
              </div>
            </GsapEntrance>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function PracticeChoice({ icon: Icon, title, description, disabled = false, onClick }: {
  icon: typeof Gamepad2;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="group flex min-h-20 w-full items-center gap-4 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-left transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--sf-brand)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-brand-text)] transition-transform duration-200 group-hover:scale-105"><Icon size={23} /></span>
      <span className="min-w-0"><span className="block font-bold text-[var(--sf-text)]">{title}</span><span className="mt-0.5 block text-pretty text-xs leading-relaxed text-[var(--sf-text-muted)]">{description}</span></span>
    </button>
  );
}

function StatMetric({ label, value, tone, icon: Icon }: {
  label: string;
  value: number;
  tone: 'cyan' | 'emerald' | 'slate' | 'amber';
  icon?: typeof Clock3;
}) {
  const tones = {
    cyan: 'text-[var(--sf-brand-text)]',
    emerald: 'text-emerald-700 dark:text-emerald-300',
    slate: 'text-[var(--sf-text)]',
    amber: 'text-amber-700 dark:text-amber-300',
  };
  return (
    <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 sm:p-5">
      <div className={cn('flex items-center gap-2 text-3xl font-black tabular-nums', tones[tone])}>{Icon && <Icon size={20} />} {value}</div>
      <div className="mt-1 text-xs font-bold text-[var(--sf-text-muted)]">{label}</div>
    </div>
  );
}

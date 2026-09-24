import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, BarChart3, Check, Clock3, Copy, ListPlus, Loader2, Share2, Trash2, X } from 'lucide-react';
import type { SharedDeckIncomingPreview } from '../features/sharing/sharedDeckSessionController';
import { cn } from '../lib/cn';
import {
  CLIPBOARD_COPY_FAILURE_MESSAGE,
  copyTextToClipboard,
} from '../lib/recoverableActions';
import { GsapEntrance } from './motion/GsapEntrance';
import { RecoverableActionFeedback } from './RecoverableActionFeedback';
import { scheduleOverlayFocusRestore } from '../features/overlays/useOverlayState';
import { getPracticeModes, resolvePracticeModeAction, type PracticeModeId } from '../features/practice/practiceModeRegistry';
import { getActiveUiLocale, loadCatalog } from '../i18n/loadCatalog';
import type { CardData } from '../types/card';

const StatsCharts = lazy(() => Promise.all([
  import('./stats/StatsCharts'), loadCatalog(getActiveUiLocale(), 'progress'),
]).then(([component]) => component));

interface StatsData {
  total: number;
  learned: number;
  learning: number;
  dueToday: number;
  categoryChart: Array<{ name: string; value: number }>;
  categoryChartIsPartial: boolean;
  difficultyChart: Array<{ name: string; value: number }>;
  xpChartData: Array<{ date: string; XP: number }>;
}

interface AppOverlaysProps {
  shareDialogOpen: boolean;
  shareLink: string | null;
  shareWarning: string | null;
  incomingSharePreview: SharedDeckIncomingPreview | null;
  dismissShareDialog: () => void;
  showShareDialog: () => void;
  acceptSharedDeck: () => Promise<void>;
  cancelSharedDeck: () => void;
  canRevokeShare: boolean;
  revokeShare: () => Promise<void>;
  isSharing: boolean;
  isPracticeMenuOpen: boolean;
  setIsPracticeMenuOpen: (value: boolean) => void;
  startQuiz: () => Promise<void>;
  startSpelling: () => Promise<void>;
  startMatch?: () => Promise<void>;
  startShadowing?: () => Promise<void>;
  practiceCards: readonly CardData[];
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

const overlayClass = 'crystal-starfield fixed inset-0 z-50 bg-[var(--sf-scrim)]';
const modalClass = 'crystal-chamfer fixed inset-0 z-50 m-auto h-fit w-[calc(100%-2rem)] rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-dialog-bg)] text-[var(--sf-text)] shadow-2xl outline-none';

export { isWordMatchAvailable } from '../features/practice/practiceModeRegistry';

export function AppOverlays({
  shareDialogOpen, shareLink, shareWarning, incomingSharePreview,
  dismissShareDialog, showShareDialog, acceptSharedDeck, cancelSharedDeck,
  canRevokeShare, revokeShare, isSharing,
  isPracticeMenuOpen, setIsPracticeMenuOpen, startQuiz,
  startSpelling, startMatch, startShadowing, practiceCards, visibleLibraryCount, generateStory, isStatsOpen, setIsStatsOpen,
  statsData, isDarkMode, showClearConfirm, setShowClearConfirm, clearAll, isLoading,
  shareOpenerRef, practiceOpenerRef, statsOpenerRef, clearOpenerRef,
}: AppOverlaysProps) {
  const { _ } = useLingui();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [practiceAction, setPracticeAction] = useState<PracticeModeId | null>(null);
  const practiceActionRef = useRef(false);
  const pendingFocusRestore = useRef<(() => void) | null>(null);
  const practiceActions: Partial<Record<PracticeModeId, () => Promise<void>>> = {
    quiz: startQuiz,
    spelling: startSpelling,
    match: startMatch,
    shadowing: startShadowing,
    story: generateStory,
  };

  const cancelPendingFocusRestore = () => {
    pendingFocusRestore.current?.();
    pendingFocusRestore.current = null;
  };

  useEffect(() => () => cancelPendingFocusRestore(), []);

  useEffect(() => {
    if (shareDialogOpen || isPracticeMenuOpen || isStatsOpen || showClearConfirm) {
      cancelPendingFocusRestore();
    }
  }, [shareDialogOpen, isPracticeMenuOpen, isStatsOpen, showClearConfirm]);

  const runPracticeAction = async (
    mode: PracticeModeId,
    action: () => Promise<void>,
  ) => {
    if (practiceActionRef.current) return;
    practiceActionRef.current = true;
    setPracticeAction(mode);
    try {
      await action();
    } finally {
      practiceActionRef.current = false;
      setPracticeAction(null);
    }
  };

  const copyShareLink = async () => {
    if (!shareLink) return;
    setCopied(false);
    setCopyFailed(false);
    const result = await copyTextToClipboard(navigator.clipboard, shareLink);
    if (result.status === 'copied') {
      setCopied(true);
      return;
    }
    setCopyFailed(true);
  };

  const restoreFocus = (event: Event, openerRef: RefObject<HTMLElement | null>) => {
    cancelPendingFocusRestore();
    pendingFocusRestore.current = scheduleOverlayFocusRestore({
      event,
      opener: openerRef.current,
      fallbackHeading: document.querySelector<HTMLElement>('main h1'),
    });
  };

  return (
    <>
      <Dialog.Root open={shareDialogOpen && Boolean(shareLink || incomingSharePreview)} onOpenChange={open => {
        if (!open) {
          if (isSharing) return;
          setCopied(false);
          setCopyFailed(false);
          if (incomingSharePreview) cancelSharedDeck();
          else dismissShareDialog();
        }
      }}>
        <Dialog.Portal>
          <Dialog.Overlay data-motion-overlay className={overlayClass} />
          <Dialog.Content
            asChild
            onCloseAutoFocus={event => restoreFocus(event, shareOpenerRef)}
            onEscapeKeyDown={event => { if (isSharing) event.preventDefault(); }}
            onInteractOutside={event => { if (isSharing) event.preventDefault(); }}
          >
            <GsapEntrance animationKey={`${incomingSharePreview?.shareId ?? shareLink}-${shareDialogOpen}`} variant="result" data-motion-dialog="true" className={cn(modalClass, 'max-w-sm overflow-hidden p-6 text-center')}>
              <Dialog.Title className="sr-only">
                {incomingSharePreview ? 'Review shared deck' : 'Your deck is ready to share'}
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                {incomingSharePreview
                  ? 'Review the shared vocabulary before deciding whether to add it.'
                  : 'Copy, manage, or revoke this vocabulary deck link.'}
              </Dialog.Description>
              {incomingSharePreview ? (
                <IncomingSharePreview
                  preview={incomingSharePreview}
                  isSharing={isSharing}
                  onAccept={() => void acceptSharedDeck()}
                  onCancel={cancelSharedDeck}
                />
              ) : shareLink ? (
                <>
                  <OutgoingShareDetails
                    shareLink={shareLink}
                    shareWarning={shareWarning}
                    copied={copied}
                    copyFailed={copyFailed}
                    canRevokeShare={canRevokeShare}
                    isSharing={isSharing}
                    onCopy={() => void copyShareLink()}
                    onDismissCopyError={() => setCopyFailed(false)}
                    onRevoke={() => void revokeShare()}
                  />
                  <Dialog.Close className="mt-2 min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-3 font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]">Close</Dialog.Close>
                </>
              ) : null}
            </GsapEntrance>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {canRevokeShare && shareLink && !shareDialogOpen && !incomingSharePreview ? (
        <ShareManagementButton onClick={showShareDialog} />
      ) : null}

      <Dialog.Root open={isPracticeMenuOpen} onOpenChange={setIsPracticeMenuOpen}>
        <Dialog.Portal>
          <Dialog.Overlay data-motion-overlay className={overlayClass} />
          <Dialog.Content asChild onCloseAutoFocus={event => restoreFocus(event, practiceOpenerRef)}>
            <GsapEntrance animationKey={isPracticeMenuOpen} variant="result" data-motion-dialog="true" className={cn(modalClass, 'max-h-[calc(100dvh-2rem)] max-w-[36rem] overflow-y-auto p-0 [html[data-theme-family=crystal]_&]:crystal-chamfer')}>
              <div className="border-b border-[var(--sf-border)] px-5 py-5 sm:px-7">
                <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="premium-kicker text-[11px] uppercase tracking-[0.14em]"><Trans id="shell.practice-menu.kicker" message="Practice" /></p>
                  <Dialog.Title className="mt-1 text-balance text-2xl font-black tracking-tight text-[var(--sf-text)] sm:text-[28px]"><Trans id="shell.practice-menu.title" message="Choose a practice mode" /></Dialog.Title>
                  <Dialog.Description className="mt-2 text-pretty text-sm leading-5 text-[var(--sf-text-muted)]"><Trans id="shell.practice-menu.description" message="Choose a different way to practice with words from your library." /></Dialog.Description>
                </div>
                <Dialog.Close className="liquid-control flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none" aria-label={_(msg({ id: 'shell.practice-menu.close', message: 'Close practice menu' }))}><X size={18} /></Dialog.Close>
                </div>
              </div>

              <div className="space-y-2 px-5 py-5 sm:px-7">
                <PracticeModeChoices practiceCards={practiceCards} visibleLibraryCount={visibleLibraryCount} practiceAction={practiceAction} actions={practiceActions} onRun={runPracticeAction} />
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

              <Suspense fallback={<div className="crystal-chamfer skeleton-sheen min-h-72 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)]" role="status"><span className="sr-only"><Trans id="shell.loading.charts" message="Loading charts" /></span></div>}>
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

export function IncomingSharePreview({ preview, isSharing, onAccept, onCancel }: {
  preview: SharedDeckIncomingPreview;
  isSharing: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)]">
        <ListPlus size={26} aria-hidden="true" />
      </div>
      <h3 className="text-balance text-xl font-black text-[var(--sf-text)]">Review shared deck</h3>
      <p className="mt-2 text-pretty text-sm leading-relaxed text-[var(--sf-text-muted)]">
        <span className="font-bold text-[var(--sf-text)]">{preview.category}</span>
        {' · '}{preview.cardCount} {preview.cardCount === 1 ? 'card' : 'cards'}
      </p>
      {preview.sampleWords.length > 0 ? (
        <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Sample vocabulary">
          {preview.sampleWords.map((word, index) => (
            <li key={`${word}-${index}`} className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--sf-text)]">{word}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
        Nothing will be added until you accept.
      </p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={isSharing} onClick={onCancel} className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-3 font-bold text-[var(--sf-text)] disabled:cursor-wait disabled:opacity-60">Cancel</button>
        <button type="button" disabled={isSharing} onClick={onAccept} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 py-3 font-bold text-[var(--sf-on-brand)] disabled:cursor-wait disabled:opacity-60">
          {isSharing ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}
          {isSharing ? 'Adding…' : 'Accept deck'}
        </button>
      </div>
    </div>
  );
}

export function OutgoingShareDetails({
  shareLink,
  shareWarning,
  copied,
  copyFailed,
  canRevokeShare,
  isSharing,
  onCopy,
  onDismissCopyError,
  onRevoke,
}: {
  shareLink: string;
  shareWarning: string | null;
  copied: boolean;
  copyFailed: boolean;
  canRevokeShare: boolean;
  isSharing: boolean;
  onCopy: () => void;
  onDismissCopyError: () => void;
  onRevoke: () => void;
}) {
  return (
    <div>
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)]">
        <Share2 size={26} aria-hidden="true" />
      </div>
      <h3 className="text-balance text-xl font-black text-[var(--sf-text)]">Your deck is ready to share</h3>
      <p className="mt-2 text-pretty text-sm leading-relaxed text-[var(--sf-text-muted)]">Send this link so friends can review the deck before adding it.</p>
      {shareWarning ? (
        <div className="mt-4 flex gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-left text-xs font-semibold leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" role="status">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{shareWarning}</span>
        </div>
      ) : null}
      <div className="mt-5 flex items-center gap-2 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-2">
        <input type="text" readOnly value={shareLink} aria-label="Vocabulary deck share link" className="min-w-0 flex-1 bg-transparent px-2 text-sm font-medium text-[var(--sf-text)] outline-none" />
        <button type="button" onClick={onCopy} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-[var(--sf-brand)] text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white" aria-label="Copy share link">
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
      {copyFailed ? (
        <RecoverableActionFeedback
          message={CLIPBOARD_COPY_FAILURE_MESSAGE}
          dismissLabel="Dismiss copy error"
          onDismiss={onDismissCopyError}
        />
      ) : (
        <p className="mt-2 min-h-5 text-xs font-semibold text-emerald-700 dark:text-emerald-300" aria-live="polite">{copied ? 'Link copied' : ''}</p>
      )}
      {canRevokeShare ? (
        <button
          type="button"
          disabled={isSharing}
          onClick={onRevoke}
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 font-bold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
        >
          <Trash2 size={16} aria-hidden="true" />
          {isSharing ? 'Revoking…' : 'Revoke link'}
        </button>
      ) : null}
    </div>
  );
}

export function ShareManagementButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-24 right-4 z-40 flex min-h-11 items-center gap-2 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-2.5 text-sm font-bold text-[var(--sf-text)] shadow-xl transition-transform hover:-translate-y-0.5 lg:bottom-6"
    >
      <Share2 size={17} aria-hidden="true" />
      Manage shared link
    </button>
  );
}

export function PracticeModeChoices({
  practiceCards,
  visibleLibraryCount,
  practiceAction,
  actions,
  onRun,
}: {
  practiceCards: readonly CardData[];
  visibleLibraryCount: number;
  practiceAction: PracticeModeId | null;
  actions: Partial<Record<PracticeModeId, () => Promise<void>>>;
  onRun: (mode: PracticeModeId, action: () => Promise<void>) => Promise<void>;
}) {
  const { _, i18n } = useLingui();

  return getPracticeModes().map(mode => {
    const action = resolvePracticeModeAction(mode, actions);
    if (!action) return null;
    const available = mode.isAvailable(practiceCards, { visibleLibraryCount });
    const unavailable = !available ? mode.unavailableLabel?.(practiceCards, { visibleLibraryCount }) : undefined;
    return <PracticeChoice key={mode.id} icon={mode.icon} title={_(mode.label)} duration={_(mode.duration)} description={_(mode.description)} unavailableLabel={unavailable ? i18n._(unavailable.message.id, unavailable.values) : undefined} disabled={!available || practiceAction !== null} busy={practiceAction === mode.id} onClick={() => void onRun(mode.id, action)} />;
  });
}

function PracticeChoice({ icon: Icon, title, duration, description, unavailableLabel, disabled = false, busy = false, onClick }: {
  icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  duration: string;
  description: string;
  unavailableLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-busy={busy} className="group flex min-h-[70px] w-full items-center gap-3 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3 text-left shadow-[0_8px_24px_-20px_var(--sf-shadow)] transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--sf-brand)_12%,var(--sf-surface))] text-[var(--sf-brand-text)]">{busy ? <Loader2 size={20} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Icon size={20} aria-hidden />}</span>
      <span className="min-w-0 flex-1"><span className="flex items-baseline gap-2"><span className="font-bold text-[var(--sf-text)]">{busy ? <Trans id="shell.practice-menu.preparing" message="Preparing…" /> : title}</span><span className="font-mono text-[11px] text-[var(--sf-text-muted)]">{duration}</span></span><span className="mt-0.5 block text-pretty text-xs leading-relaxed text-[var(--sf-text-muted)]">{description}</span></span>
      {unavailableLabel ? <span className="shrink-0 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-2 py-1 text-[11px] font-semibold text-[var(--sf-text-muted)]">{unavailableLabel}</span> : null}
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

import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, BarChart3, Check, Clock3, Copy, Link2, Loader2, Share2, ShieldCheck, Trash2, X } from 'lucide-react';
import type { SharedDeckIncomingPreview, SharedDeckLanguagePair, SharedDeckOutgoingPreview, SharedDeckTruncation } from '../features/sharing/sharedDeckSessionController';
import { cn } from '../lib/cn';
import { copyTextToClipboard } from '../lib/recoverableActions';
import { formatNumber } from '../lib/format';
import { GsapEntrance } from './motion/GsapEntrance';
import { RecoverableActionFeedback } from './RecoverableActionFeedback';
import { scheduleOverlayFocusRestore } from '../features/overlays/useOverlayState';
import { getPracticeModes, resolvePracticeModeAction, type PracticeModeId } from '../features/practice/practiceModeRegistry';
import { getActiveUiLocale, loadCatalog } from '../i18n/loadCatalog';
import type { CardData } from '../types/card';
import './share-dialog.css';

const StatsCharts = lazy(() => Promise.all([
  import('./stats/StatsCharts'), loadCatalog(getActiveUiLocale(), 'progress'),
]).then(([component]) => component));

// The typed confirmation guards the one action that deletes every synced card.
const LibraryClearDialog = lazy(() => Promise.all([
  import('../features/library/LibraryDialogOverlays'), loadCatalog(getActiveUiLocale(), 'library'),
]).then(([module]) => ({ default: module.LibraryClearDialog })));

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
  shareWarning: SharedDeckTruncation | null;
  shareError?: string | null;
  onDismissShareError?: () => void;
  shareExpiresAt?: string | null;
  outgoingSharePreview?: SharedDeckOutgoingPreview | null;
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
  onExportLibrary?: () => void;
}

const overlayClass = 'crystal-starfield fixed inset-0 z-50 bg-[var(--sf-scrim)]';
const modalClass = 'crystal-chamfer fixed inset-0 z-50 m-auto h-fit w-[calc(100%-2rem)] rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] [background-image:var(--sf-dialog-bg)] text-[var(--sf-text)] shadow-2xl outline-none';

function shareDialogFrameStyle(isDarkMode: boolean): CSSProperties {
  return {
    clipPath: 'var(--nk-chamfer, none)',
    borderRadius: isDarkMode ? 14 : 10,
    backgroundImage: isDarkMode
      ? 'linear-gradient(155deg, #ff5470, rgb(255 42 77 / 0.25) 28%, rgb(94 242 255 / 0.2) 72%, #5ef2ff)'
      : 'linear-gradient(155deg, #ff5470, rgb(224 23 63 / 0.3) 28%, rgb(26 167 201 / 0.35) 72%, #1aa7c9)',
    filter: isDarkMode
      ? 'drop-shadow(0 0 32px rgb(255 42 77 / 0.22)) drop-shadow(0 28px 40px rgb(0 0 0 / 0.64))'
      : 'drop-shadow(0 24px 38px rgb(20 70 130 / 0.25))',
  };
}

function shareDialogBodyStyle(isDarkMode: boolean): CSSProperties {
  return {
    clipPath: 'var(--nk-chamfer, none)',
    borderRadius: isDarkMode ? 13 : 9,
    backgroundImage: isDarkMode
      ? 'radial-gradient(ellipse 70% 50% at 90% 0%, rgb(179 15 51 / 0.24), transparent 70%), linear-gradient(170deg, #141a2b 0%, #0a0d17 100%)'
      : 'radial-gradient(ellipse 70% 50% at 90% 0%, rgb(255 84 112 / 0.16), transparent 70%), linear-gradient(170deg, #f5fbff 0%, #dbeeff 100%)',
  };
}

const categoryTitle = (category: string, allLibraryLabel: string): string =>
  category === 'All' ? allLibraryLabel : category;

function formatShareDate(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const dateLocale = locale === 'pseudo' || locale === 'en-XA' ? 'en' : locale;
  return new Intl.DateTimeFormat(dateLocale, { dateStyle: 'medium' }).format(date);
}

function IncomingShareAttribution({ createdAt, locale }: { createdAt?: string | null; locale: string }) {
  const date = formatShareDate(createdAt, locale);
  return date
    ? <Trans id="shell.share.incoming-created" message="Shared on {date}" values={{ date }} />
    : <Trans id="shell.share.incoming-description" message="Review this shared deck before deciding whether to add it." />;
}

function ShareDialogLoading() {
  return <div role="status" className="flex min-h-40 flex-col items-center justify-center gap-3 text-center text-sm font-semibold text-[var(--sf-text-muted)]"><Loader2 size={24} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /><Trans id="shell.share.loading" message="Preparing the shared deck…" /></div>;
}

function ShareDialogEmpty() {
  return <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center"><Share2 size={24} className="text-[var(--sf-text-muted)]" aria-hidden="true" /><p className="share-dialog-empty-title text-lg font-bold text-[var(--sf-text)]"><Trans id="shell.share.empty-title" message="No shared deck to show" /></p><p className="max-w-sm text-sm leading-relaxed text-[var(--sf-text-muted)]"><Trans id="shell.share.empty-description" message="Close this dialog and try opening the share link again." /></p></div>;
}

export { isWordMatchAvailable } from '../features/practice/practiceModeRegistry';

export function AppOverlays({
  shareDialogOpen, shareLink, shareWarning, shareError, onDismissShareError, shareExpiresAt, outgoingSharePreview, incomingSharePreview,
  dismissShareDialog, showShareDialog, acceptSharedDeck, cancelSharedDeck,
  canRevokeShare, revokeShare, isSharing,
  isPracticeMenuOpen, setIsPracticeMenuOpen, startQuiz,
  startSpelling, startMatch, startShadowing, practiceCards, visibleLibraryCount, generateStory, isStatsOpen, setIsStatsOpen,
  statsData, isDarkMode, showClearConfirm, setShowClearConfirm, clearAll, isLoading,
  shareOpenerRef, practiceOpenerRef, statsOpenerRef, clearOpenerRef, onExportLibrary,
}: AppOverlaysProps) {
  const { _, i18n } = useLingui();
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
      <Dialog.Root open={shareDialogOpen} onOpenChange={open => {
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
            <GsapEntrance animationKey={`${incomingSharePreview?.shareId ?? shareLink}-${shareDialogOpen}`} variant="result" data-motion-dialog="true" data-share-dialog-frame={incomingSharePreview ? 'incoming' : 'outgoing'} className={cn('share-dialog-frame fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col p-[2px] text-[var(--sf-text)] outline-none', incomingSharePreview ? 'max-w-[36.25rem]' : 'max-w-[35rem]')} style={shareDialogFrameStyle(isDarkMode)}>
              <div data-share-dialog-body className="share-dialog-body relative flex min-h-0 flex-col overflow-hidden bg-[var(--sf-dialog-bg,var(--sf-surface))] text-[var(--sf-text)]" style={shareDialogBodyStyle(isDarkMode)}>
              <span aria-hidden="true" className="share-dialog-ornament share-dialog-ornament-top pointer-events-none absolute left-6 top-0 z-10 h-[3px] w-[7.5rem] bg-gradient-to-r from-rose-400 via-rose-500 to-cyan-300 shadow-[0_0_12px_rgba(255,42,77,.6)]" />
              <span aria-hidden="true" className="share-dialog-ornament share-dialog-ornament-bottom pointer-events-none absolute bottom-0 right-7 z-10 h-[3px] w-[4.5rem] bg-cyan-300 shadow-[0_0_10px_rgba(94,242,255,.65)]" />
              <div className="share-dialog-header flex shrink-0 items-start gap-3.5 border-b border-[var(--sf-border)] px-5 pb-[18px] pt-[22px] sm:px-[26px]">
                <div className="min-w-0 flex-1">
                  <p className="share-dialog-kicker text-[11.5px] font-extrabold uppercase tracking-[0.16em] text-[var(--sf-brand-text)]">
                    <span aria-hidden="true" className="share-dialog-kicker-diamond" />
                    {incomingSharePreview ? <Trans id="shell.share.incoming-kicker" message="Shared with you" /> : <Trans id="shell.share.kicker" message="Share deck" />}
                  </p>
                  <Dialog.Title className="share-dialog-title mt-1 break-words text-[25px] leading-[1.12] tracking-[-0.02em] text-[var(--sf-text)] sm:text-[28px]">
                    {incomingSharePreview
                      ? categoryTitle(incomingSharePreview.category, _(msg({ id: 'shell.share.all-library', message: 'All library cards' })))
                      : <Trans id="shell.share.outgoing-title" message="Share “{title}”" values={{ title: categoryTitle(outgoingSharePreview?.category ?? '', _(msg({ id: 'shell.share.all-library', message: 'All library cards' }))) || _(msg({ id: 'shell.share.kicker', message: 'Share deck' })) }} />}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1.5 text-pretty text-[13.5px] leading-[1.5] text-[var(--sf-text-muted)]">
                    {incomingSharePreview
                      ? <IncomingShareAttribution createdAt={incomingSharePreview.createdAt} locale={i18n.locale} />
                      : <Trans id="shell.share.outgoing-description" message="Anyone with the link can preview this deck and copy it into their own library." />}
                  </Dialog.Description>
                </div>
                <Dialog.Close disabled={isSharing} className="share-dialog-close relative flex size-11 shrink-0 items-center justify-center bg-transparent p-0 text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none" aria-label={_(msg({ id: 'shell.share.close', message: 'Close share dialog' }))}>
                  <span aria-hidden="true" className="share-dialog-close-surface"><X size={16} /></span>
                </Dialog.Close>
              </div>
              <div tabIndex={0} role="region" aria-label={_(msg({ id: 'shell.share.kicker', message: 'Share deck' }))} className="share-dialog-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:px-[26px] sm:pb-[22px]">
              {shareError && !incomingSharePreview && onDismissShareError ? (
                <RecoverableActionFeedback
                  message={shareError}
                  dismissLabel={_(msg({ id: 'shell.share.dismiss-error', message: 'Dismiss share error' }))}
                  onDismiss={onDismissShareError}
                  className="mb-4 mt-0"
                />
              ) : null}
              {incomingSharePreview ? (
                <IncomingSharePreview
                  preview={incomingSharePreview}
                  isSharing={isSharing}
                  error={shareError}
                  onDismissError={onDismissShareError}
                />
              ) : shareLink ? (
                <OutgoingShareDetails
                  shareLink={shareLink}
                  shareWarning={shareWarning}
                  preview={outgoingSharePreview ?? null}
                  expiresAt={shareExpiresAt ?? outgoingSharePreview?.expiresAt ?? null}
                  copied={copied}
                  copyFailed={copyFailed}
                  isSharing={isSharing}
                  isDarkMode={isDarkMode}
                  onCopy={() => void copyShareLink()}
                  onDismissCopyError={() => setCopyFailed(false)}
                />
              ) : isSharing ? <ShareDialogLoading /> : <ShareDialogEmpty />}
              </div>
              {!incomingSharePreview && shareLink ? (
                <div className="share-dialog-footer flex shrink-0 items-center gap-2 border-t border-[var(--sf-border)] px-5 py-4 sm:px-[26px]">
                  {canRevokeShare ? <button type="button" disabled={isSharing} onClick={() => void revokeShare()} className="share-dialog-revoke min-h-11 border-0 bg-transparent px-1 text-sm font-semibold text-[var(--sf-danger)] underline-offset-4 hover:underline disabled:cursor-wait disabled:opacity-60"><Trash2 size={15} className="mr-2 inline" aria-hidden="true" />{isSharing ? <Trans id="shell.share.revoking" message="Revoking…" /> : <Trans id="shell.share.revoke" message="Revoke link" />}</button> : null}
                  <Dialog.Close disabled={isSharing} className="share-dialog-action share-dialog-action-primary ml-auto flex min-h-11 items-center gap-2 px-5 text-sm font-bold shadow-[0_12px_28px_-14px_var(--sf-shadow)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60"><Trans id="shell.share.done" message="Done" /><Check className="share-dialog-static-check" size={16} aria-hidden="true" /></Dialog.Close>
                </div>
              ) : incomingSharePreview ? (
                <ShareImportActions preview={incomingSharePreview} isSharing={isSharing} onAccept={() => void acceptSharedDeck()} onCancel={cancelSharedDeck} />
              ) : null}
              </div>
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
            <GsapEntrance animationKey={isStatsOpen} variant="result" data-motion-dialog="true" className={cn(modalClass, 'max-h-[calc(100dvh-2rem)] max-w-5xl overflow-y-auto p-0')}>
              <div className="mb-6 flex items-start justify-between gap-4 border-b border-[var(--sf-border)] px-5 py-5 sm:mb-8 sm:px-8">
                <div className="flex items-center gap-3">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)]"><BarChart3 size={23} /></div>
                  <div>
                    <p className="premium-kicker text-[11px] uppercase tracking-[0.14em]"><Trans id="shell.insights.kicker" message="Learning insights" /></p>
                    <Dialog.Title className="mt-1 text-balance text-2xl font-black text-[var(--sf-text)]"><Trans id="shell.insights.title" message="Your learning rhythm" /></Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans id="shell.insights.description" message="A clear view of your memory strength and review momentum." /></Dialog.Description>
                  </div>
                </div>
                <Dialog.Close className="liquid-control flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={_(msg({ id: 'shell.insights.close', message: 'Close learning insights' }))}><X size={18} /></Dialog.Close>
              </div>

              <div className="px-5 pb-5 sm:px-8 sm:pb-8">
                <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatMetric label={<Trans id="shell.insights.total-cards" message="Total cards" />} value={statsData.total} tone="cyan" />
                  <StatMetric label={<Trans id="shell.insights.mastered" message="Mastered" />} value={statsData.learned} tone="emerald" />
                  <StatMetric label={<Trans id="shell.insights.learning" message="Learning" />} value={statsData.learning} tone="slate" />
                  <StatMetric label={<Trans id="shell.insights.due-today" message="Due today" />} value={statsData.dueToday} tone="amber" icon={Clock3} />
                </div>

                <Suspense fallback={<div className="crystal-chamfer skeleton-sheen min-h-72 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)]" role="status"><span className="sr-only"><Trans id="shell.loading.charts" message="Loading charts" /></span></div>}>
                  <StatsCharts darkMode={isDarkMode} data={statsData} />
                </Suspense>
              </div>
            </GsapEntrance>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {showClearConfirm && (
        <Suspense fallback={null}>
          <LibraryClearDialog
            open
            onOpenChange={setShowClearConfirm}
            onConfirm={() => { if (!isLoading) void clearAll(); }}
            status="idle"
            restoreFocusRef={clearOpenerRef}
            cardCount={statsData.total > 0 ? statsData.total : undefined}
            masteredCount={statsData.total > 0 ? statsData.learned : undefined}
            onExport={onExportLibrary}
          />
        </Suspense>
      )}
    </>
  );
}

export function IncomingSharePreview({ preview, isSharing, error, onDismissError }: {
  preview: SharedDeckIncomingPreview;
  isSharing: boolean;
  error?: string | null;
  onDismissError?: () => void;
}) {
  const { _, i18n } = useLingui();
  const data = preview;
  const samples = data.sampleWords.slice(0, Math.min(5, Math.max(0, preview.cardCount)));
  const moreCount = Math.max(0, preview.cardCount - samples.length);
  const expiresAt = formatShareDate(data.expiresAt, i18n.locale);

  return (
    <div data-share-preview="incoming">
      {isSharing ? <div role="status" className="mb-4 flex items-center gap-2 border border-[var(--sf-info-line,var(--sf-brand))] bg-[var(--sf-info-bg,color-mix(in_srgb,var(--sf-brand)_8%,var(--sf-surface)))] px-3 py-2.5 text-sm font-semibold text-[var(--sf-text)]"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /><Trans id="shell.share.importing" message="Adding {count} cards to your new deck…" values={{ count: formatNumber(preview.cardCount) }} /></div> : null}
      {error && onDismissError ? <RecoverableActionFeedback message={error} dismissLabel={_(msg({ id: 'shell.share.dismiss-error', message: 'Dismiss share error' }))} onDismiss={onDismissError} className="mb-4 mt-0" /> : null}
      <div className="share-dialog-metrics grid grid-cols-3 overflow-hidden rounded-[var(--sf-card-radius,14px)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)]">
        <ShareMetric isCardCount label={<Trans id="shell.share.cards" message="Cards" />} value={formatNumber(preview.cardCount)} />
        <ShareMetric label={<Trans id="shell.share.category" message="Category" />} value={categoryTitle(preview.category, _(msg({ id: 'shell.share.all-library', message: 'All library cards' })))} />
        <ShareMetric label={<Trans id="shell.share.copy" message="Your copy" />} value={<Trans id="shell.share.copy-detail" message="New library deck" />} />
      </div>
      <LanguagePairs pairs={preview.languagePairs ?? []} locale={i18n.locale} />
      <div className="share-dialog-sample-heading mt-5 flex items-baseline justify-between gap-3">
        <p className="share-dialog-sample-heading-label text-xs font-semibold text-[var(--sf-text-muted)]"><Trans id="shell.share.words-inside" message="A few words inside" /></p>
        <p className="font-mono text-xs text-[var(--sf-text-muted)]">{moreCount > 0 ? <Trans id="shell.share.more-cards" message="+{count} more" values={{ count: formatNumber(moreCount) }} /> : <Trans id="shell.share.cards-count" message="{count, plural, one {# card} other {# cards}}" values={{ count: preview.cardCount }} />}</p>
      </div>
      {samples.length > 0 ? (
        <div tabIndex={0} role="region" aria-label={_(msg({ id: 'shell.share.sample-vocabulary', message: 'Sample vocabulary' }))} className="share-dialog-sample-rail mt-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {samples.map((word, index) => (
              <li key={`${word.value}-${index}`} className="share-dialog-sample-item min-w-0" lang={word.language ?? undefined}>
                <div className="share-dialog-sample-shell">
                  <span aria-hidden="true" className="share-dialog-sample-rim" />
                  <div className="share-dialog-sample-card flex h-[104px] flex-col overflow-hidden rounded-[var(--sf-card-radius,14px)] border border-[var(--sf-border)] bg-[var(--sf-card-bg,var(--sf-surface))] p-3.5 shadow-[0_12px_28px_-20px_var(--sf-shadow)]">
                    <span className="share-dialog-word-title line-clamp-2 break-words leading-tight text-[var(--sf-text)]">{word.value}</span>
                    {word.translation ? <span lang={word.translationLanguage ?? undefined} className="mt-auto line-clamp-2 break-words text-xs leading-snug text-[var(--sf-text-muted)]">{word.translation}</span> : <span className="mt-auto text-xs text-[var(--sf-text-muted)]"><Trans id="shell.share.no-translation" message="Translation not available" /></span>}
                    {word.origin === 'ai' ? <span className="sr-only"><Trans id="flashcard.ai-disclosure" message="AI-generated content may be incorrect. Please check the meaning." /></span> : null}
                  </div>
                </div>
              </li>
            ))}
            {moreCount > 0 ? <li aria-hidden="true" className="share-dialog-more-count flex h-[104px] items-center justify-center rounded-[var(--sf-card-radius,14px)] border border-dashed border-[var(--sf-border)] text-xl text-[var(--sf-text-muted)]">+{formatNumber(moreCount)}</li> : null}
          </ul>
        </div>
      ) : (
        <div className="mt-3 flex min-h-[104px] items-center justify-center rounded-[var(--sf-card-radius,14px)] border border-dashed border-[var(--sf-border)] px-4 text-center text-sm text-[var(--sf-text-muted)]" role="status">
          {preview.cardCount > 0 ? <Trans id="shell.share.no-sample-preview" message="A card preview is not available for this shared deck." /> : <Trans id="shell.share.no-cards" message="This shared deck has no cards to add." />}
        </div>
      )}
      <p className="share-dialog-safeguard mt-4 flex gap-2.5 border border-[var(--sf-info-line,var(--sf-border))] bg-[var(--sf-info-bg,color-mix(in_srgb,var(--sf-brand)_8%,var(--sf-surface)))] px-3.5 py-3 text-[13px] leading-[1.45] text-[var(--sf-text)]">
        <ShieldCheck size={17} className="share-dialog-safeguard-icon mt-0.5 shrink-0 text-[var(--sf-brand-text)]" aria-hidden="true" />
        <span><Trans id="shell.share.incoming-safeguard" message="Cards go into a new deck with the same name. Your existing cards and progress stay untouched." /></span>
      </p>
      {data.containsAiGeneratedCards ? <div role="note" className="share-dialog-warning mt-3 flex gap-2.5 border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-xs leading-relaxed text-[var(--sf-text)]"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" /><span><Trans id="flashcard.ai-disclosure" message="AI-generated content may be incorrect. Please check the meaning." /></span></div> : null}
      {expiresAt ? <p className="mt-1 text-xs text-[var(--sf-text-muted)]"><Trans id="shell.share.expires-on" message="Link expires on {date}" values={{ date: expiresAt }} /></p> : null}
    </div>
  );
}

function ShareMetric({ label, value, isCardCount = false }: { label: ReactNode; value: ReactNode; isCardCount?: boolean }) {
  return <div className="share-dialog-metric min-w-0 border-r border-[var(--sf-border)] px-2.5 py-3 last:border-r-0 sm:px-4">
    <p className="share-dialog-metric-label text-xs text-[var(--sf-text-muted)]">{label}</p>
    <p className={cn('share-dialog-metric-value mt-1 min-h-[2.3rem] break-words text-sm font-semibold leading-tight text-[var(--sf-text)] sm:text-base', isCardCount && 'share-dialog-card-count')}>{value}</p>
  </div>;
}

export function ShareImportActions({ preview, isSharing, onAccept, onCancel }: {
  preview: SharedDeckIncomingPreview;
  isSharing: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const canAddCards = preview.cardCount > 0;
  return <div className="share-dialog-footer flex shrink-0 items-center justify-end gap-2.5 border-t border-[var(--sf-border)] px-5 py-4 sm:px-[26px]">
    <button type="button" disabled={isSharing} onClick={onCancel} className="share-dialog-action share-dialog-action-secondary min-h-11 px-4 text-sm font-semibold text-[var(--sf-text)] shadow-[0_1px_2px_var(--sf-shadow)] transition-colors hover:border-[var(--sf-brand)] disabled:cursor-wait disabled:opacity-60"><Trans id="shell.share.cancel" message="Cancel" /></button>
    <button type="button" disabled={isSharing || !canAddCards} aria-busy={isSharing} onClick={onAccept} className="share-dialog-action share-dialog-action-primary flex min-h-11 items-center justify-center gap-2 px-5 text-sm font-bold text-[var(--sf-on-brand)] shadow-[0_12px_28px_-14px_var(--sf-shadow)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55">
      {isSharing ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check size={16} className="share-dialog-static-check" aria-hidden="true" />}
      {isSharing ? <Trans id="shell.share.adding" message="Adding…" /> : canAddCards ? <Trans id="shell.share.add-count" message="Add {count} cards" values={{ count: formatNumber(preview.cardCount) }} /> : <Trans id="shell.share.add-none" message="No cards to add" />}
    </button>
  </div>;
}

function LanguagePairs({ pairs, locale }: { pairs: readonly SharedDeckLanguagePair[]; locale: string }) {
  const { _ } = useLingui();
  if (pairs.length === 0) return null;
  const languageName = (language: string | null, unknownLabel: string) => {
    if (!language) return unknownLabel;
    try {
      return new Intl.DisplayNames([locale], { type: 'language' }).of(language) ?? language;
    } catch {
      return language;
    }
  };

  return (
    <div className="share-dialog-language-pairs mt-4 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3 text-left">
      <p className="text-xs font-bold text-[var(--sf-text-muted)]"><Trans id="shell.share.languages" message="Languages" /></p>
      <div className="mt-2 flex flex-wrap gap-2">
        {pairs.map(pair => <span key={`${pair.targetLanguage ?? 'unknown'}-${pair.translationLanguage ?? 'unknown'}`} className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--sf-text)]"><Trans id="shell.share.language-pair" message="{target} → {native}" values={{ target: languageName(pair.targetLanguage, _(msg({ id: 'shell.share.target-unspecified', message: 'Target language unspecified' }))), native: languageName(pair.translationLanguage, _(msg({ id: 'shell.share.translation-unspecified', message: 'Translation language unspecified' }))) }} /></span>)}
      </div>
    </div>
  );
}

export function OutgoingShareDetails({
  shareLink,
  shareWarning,
  preview,
  expiresAt,
  copied,
  copyFailed,
  isSharing,
  isDarkMode = false,
  onCopy,
  onDismissCopyError,
}: {
  shareLink: string;
  shareWarning: SharedDeckTruncation | null;
  preview: SharedDeckOutgoingPreview | null;
  expiresAt?: string | null;
  copied: boolean;
  copyFailed: boolean;
  isSharing: boolean;
  isDarkMode?: boolean;
  onCopy: () => void;
  onDismissCopyError: () => void;
}) {
  const { _, i18n } = useLingui();
  const data = preview;
  const title = categoryTitle(preview?.category ?? '', _(msg({ id: 'shell.share.all-library', message: 'All library cards' })));
  const expiry = formatShareDate(expiresAt ?? data?.expiresAt, i18n.locale);
  return (
    <div data-share-preview="outgoing" className="space-y-4">
      {isSharing ? <div role="status" className="flex items-center gap-2 border border-[var(--sf-info-line,var(--sf-brand))] bg-[var(--sf-info-bg,color-mix(in_srgb,var(--sf-brand)_8%,var(--sf-surface)))] px-3 py-2.5 text-sm font-semibold text-[var(--sf-text)]"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /><Trans id="shell.share.updating" message="Updating this share link…" /></div> : null}
      <div className="share-dialog-deck-summary flex items-center gap-4 rounded-[var(--sf-card-radius,14px)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3.5">
        <ShareDeckCover title={title} isDarkMode={isDarkMode} />
        <div className="min-w-0 flex-1">
        <p className="share-dialog-deck-title break-words leading-tight text-[var(--sf-text)]">{title}</p>
          <p className="mt-1.5 text-[13px] text-[var(--sf-text-muted)]"><span className="font-mono tabular-nums">{formatNumber(preview?.cardCount ?? 0)}</span> <Trans id="shell.share.cards" message="Cards" /></p>
        </div>
      </div>
      {preview ? <LanguagePairs pairs={preview.languagePairs ?? []} locale={i18n.locale} /> : null}
      {shareWarning ? (
        <div className="share-dialog-warning flex gap-2.5 border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-left text-[13px] font-semibold leading-[1.45] text-[var(--sf-text)]" role="status">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
          <span><Trans id="shell.share.truncation" message="This link includes {shared} of {total} cards. Create smaller decks to share the rest." values={{ shared: formatNumber(shareWarning.sharedCardCount), total: formatNumber(shareWarning.totalCardCount) }} /></span>
        </div>
      ) : null}
      <label className="block text-left">
        <span className="mb-1.5 block text-xs font-semibold text-[var(--sf-text-muted)]"><Trans id="shell.share.link-label" message="Share link" /></span>
        <span className="share-dialog-link-shell flex h-[50px] items-center gap-2 border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] pl-3.5 pr-1.5 text-[var(--sf-text)]" style={{ borderRadius: 'var(--sf-card-radius, 14px)' }}>
          <Link2 size={15} className="shrink-0 text-[var(--sf-text-muted)]" aria-hidden="true" />
          <input type="text" readOnly value={shareLink} aria-label={_(msg({ id: 'shell.share.link-input', message: 'Vocabulary deck share link' }))} className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[var(--sf-text)] outline-none" />
          <button type="button" onClick={onCopy} className="share-dialog-copy-action flex h-[44px] min-w-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--sf-success)]/30 bg-[color-mix(in_srgb,var(--sf-success)_12%,transparent)] px-3 text-xs font-semibold text-[var(--sf-success)] transition-colors hover:bg-[color-mix(in_srgb,var(--sf-success)_20%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none" aria-label={_(msg({ id: 'shell.share.copy-link', message: 'Copy share link' }))}>
            {copied ? <><Check size={13} aria-hidden="true" /><Trans id="shell.share.copied" message="Copied" /></> : <><Copy size={14} aria-hidden="true" /><Trans id="shell.share.copy-short" message="Copy" /></>}
          </button>
        </span>
      </label>
      {copyFailed ? (
        <RecoverableActionFeedback
          message={_(msg({ id: 'shell.share.copy-failed', message: 'The link could not be copied. Copy it manually or try the copy button again.' }))}
          dismissLabel={_(msg({ id: 'shell.share.dismiss-copy-error', message: 'Dismiss copy error' }))}
          onDismiss={onDismissCopyError}
        />
      ) : (
        <p className="sr-only" aria-live="polite">{copied ? <Trans id="shell.share.link-copied" message="Link copied" /> : ''}</p>
      )}
      <ul className="share-dialog-facts space-y-2.5" aria-label={_(msg({ id: 'shell.share.behavior', message: 'Sharing behavior' }))}>
        {[
          <Trans id="shell.share.fact-private" message="Recipients get their own copy; your progress and review history stay private." />,
          <Trans id="shell.share.fact-edits" message="Edits you make later are not pushed to copies already taken." />,
          <Trans id="shell.share.fact-revoke" message="You can revoke this link at any time." />,
        ].map((fact, index) => <li key={index} className="share-dialog-fact flex gap-2.5 text-[13px] leading-[1.45] text-[var(--sf-text)]"><span className="share-dialog-fact-marker mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sf-brand)_12%,transparent)] text-[var(--sf-brand-text)]"><Check size={12} strokeWidth={3} aria-hidden="true" /></span><span>{fact}</span></li>)}
      </ul>
      {expiry ? <p className="text-xs text-[var(--sf-text-muted)]"><Trans id="shell.share.expires-on" message="Link expires on {date}" values={{ date: expiry }} /></p> : null}
      <div className="share-dialog-warning share-dialog-privacy-warning flex items-start gap-2.5 border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-[13px] leading-[1.45] text-[var(--sf-text)]" role="note">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <span><Trans id="shell.share.privacy-warning" message="Shared cards may include memory hooks and personal notes. Review them for private information before sharing." /></span>
      </div>
      {data?.containsAiGeneratedCards ? <div role="note" className="share-dialog-warning flex gap-2.5 border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-xs leading-relaxed text-[var(--sf-text)]"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" /><span><Trans id="flashcard.ai-disclosure" message="AI-generated content may be incorrect. Please check the meaning." /></span></div> : null}
      <p className="text-xs text-[var(--sf-text-muted)]"><Trans id="shell.share.copy-private" message="This link opens a preview. The recipient decides whether to add a separate copy." /></p>
    </div>
  );
}

function ShareDeckCover({ title, isDarkMode }: { title: string; isDarkMode: boolean }) {
  const initial = Array.from(title.trim())[0]?.toLocaleUpperCase() ?? '•';
  return <div aria-hidden="true" className="share-dialog-cover relative h-[72px] w-16 shrink-0">
    <span className="share-dialog-cover-back absolute inset-0 rounded-[10px]" style={{ transform: 'rotate(-8deg) translate(-4px,2px)', background: isDarkMode ? 'rgb(150 108 215 / .35)' : '#d8c6a4' }} />
    <span className="share-dialog-cover-mid absolute inset-0 rounded-[10px]" style={{ transform: 'rotate(5deg) translate(4px,1px)', background: isDarkMode ? 'rgb(40 211 244 / .3)' : '#e7d9bf' }} />
    <span className="share-dialog-cover-initial absolute inset-0 flex items-end rounded-[10px] p-1.5 text-[36px] italic leading-[.8] text-white shadow-[0_10px_24px_-8px_rgba(40,211,244,.5)]" style={{ background: isDarkMode ? 'linear-gradient(150deg,#7ee6fa,#28d3f4 45%,#966cd7)' : 'linear-gradient(150deg,#578b4d,#337344)', color: isDarkMode ? '#04141c' : '#f3d58a' }}>{initial}</span>
  </div>;
}

export function ShareManagementButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-24 right-4 z-40 flex min-h-11 items-center gap-2 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-2.5 text-sm font-bold text-[var(--sf-text)] shadow-xl transition-transform hover:-translate-y-0.5 lg:bottom-6"
    >
      <Share2 size={17} aria-hidden="true" />
      <Trans id="shell.share.manage" message="Manage shared link" />
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

export function StatMetric({ label, value, tone, icon: Icon }: {
  label: ReactNode;
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
      <div className={cn('flex items-center gap-2 text-3xl font-black tabular-nums', tones[tone])}>{Icon && <Icon size={20} />} {formatNumber(value)}</div>
      <div className="mt-1 text-xs font-bold text-[var(--sf-text-muted)]">{label}</div>
    </div>
  );
}

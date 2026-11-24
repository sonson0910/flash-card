import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Check, ChevronRight, Copy, Link2, Loader2, Lock, MessagesSquare, Share2, ShieldCheck, X } from 'lucide-react';
import type { SharedDeckEarlierShare, SharedDeckIncomingPreview, SharedDeckLanguagePair, SharedDeckOutgoingPreview, SharedDeckTruncation } from '../features/sharing/sharedDeckSessionController';
import { cn } from '../lib/cn';
import { copyTextToClipboard } from '../lib/recoverableActions';
import { formatNumber } from '../lib/format';
import { GsapEntrance } from './motion/GsapEntrance';
import { RecoverableActionFeedback } from './RecoverableActionFeedback';
import { scheduleOverlayFocusRestore } from '../features/overlays/useOverlayState';
import { getPracticeModes, resolvePracticeModeAction, type PracticeModeId } from '../features/practice/practiceModeRegistry';
import { clearLibraryFigures, useOwnerCardCount } from '../features/library/clearLibraryFigures';
import type { LibraryDialogPhase } from '../features/library/LibraryDialogOverlays';
import type { LibraryInsightsPhase } from '../features/library/LibraryDialogOverlays';
import { getActiveUiLocale, loadCatalog } from '../i18n/loadCatalog';
import type { CardData } from '../types/card';
import './share-dialog.css';
import './overlay-dialog.css';
import './practice-picker.css';
import { TextConversationPanel } from '../features/library/TextConversationPanel';
import type { ListenPracticeHandoff } from '../app/AppViewStage';
import { eligibleWordMatchCards } from '../features/practice/practiceModel';

// The typed confirmation guards the one action that deletes every synced card.
const LibraryClearDialog = lazy(() => Promise.all([
  import('../features/library/LibraryDialogOverlays'), loadCatalog(getActiveUiLocale(), 'library'),
]).then(([module]) => ({ default: module.LibraryClearDialog })));
const LibraryInsightsDialog = lazy(() => Promise.all([
  import('../features/library/LibraryDialogOverlays'), loadCatalog(getActiveUiLocale(), 'library'),
]).then(([module]) => ({ default: module.LibraryInsightsDialog })));

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
  earlierShares?: readonly SharedDeckEarlierShare[];
  revokeEarlierShare?: (shareId: string) => Promise<void>;
  isSharing: boolean;
  isPracticeMenuOpen: boolean;
  setIsPracticeMenuOpen: (value: boolean) => void;
  startQuiz: () => Promise<void>;
  startSpelling: () => Promise<void>;
  startLanguageDrill?: () => Promise<void>;
  startMatch?: () => Promise<void>;
  startShadowing?: () => Promise<void>;
  practiceCards: readonly CardData[];
  visibleLibraryCount: number;
  /** The active course's target language; practice draws its cards from that language. */
  practiceLanguage?: string;
  cards?: readonly CardData[];
  ownerId?: string | null;
  isOffline?: boolean;
  generateStory: () => Promise<void>;
  isStatsOpen: boolean;
  setIsStatsOpen: (value: boolean) => void;
  statsData: StatsData;
  insightsPhase?: LibraryInsightsPhase;
  insightsError?: string | null;
  onRetryInsights?: () => void;
  isDarkMode: boolean;
  showClearConfirm: boolean;
  setShowClearConfirm: (value: boolean) => void;
  clearAll: () => Promise<void>;
  clearStatus: LibraryDialogPhase;
  clearError: string | null;
  resetClearFeedback: () => void;
  /** Number of decks the clear-library confirmation lists, counted the way the library counts them. */
  deckCount?: number;
  /** Counts every card the owner holds across courses; the clear-library confirmation shows it, as clearing deletes them all. */
  loadOwnerCardCount?: () => Promise<number>;
  isLoading: boolean;
  shareOpenerRef: RefObject<HTMLElement | null>;
  practiceOpenerRef: RefObject<HTMLElement | null>;
  statsOpenerRef: RefObject<HTMLElement | null>;
  clearOpenerRef: RefObject<HTMLElement | null>;
  onExportLibrary?: () => void;
  onOpenProgress?: () => void;
  listenPracticeHandoff?: ListenPracticeHandoff | null;
  onDismissListenPractice?: () => void;
}

const overlayClass = 'crystal-starfield fixed inset-0 z-50 dialog-veil';
const modalClass = 'crystal-chamfer fixed inset-0 z-50 m-auto h-fit w-[calc(100%-2rem)] rounded-[32px] [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-dialog-radius,18px)] border border-[var(--sf-border)] bg-[var(--sf-surface)] [background-image:var(--sf-dialog-bg)] text-[var(--sf-text)] shadow-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]';

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
    ? <Trans {...msg({ context: 'shell.share.incoming-created', message: 'Shared on {date}' })} values={{ date }} />
    : <Trans {...msg({ context: 'shell.share.incoming-description', message: 'Review this shared deck before deciding whether to add it.' })} />;
}

function ShareDialogLoading() {
  return <div role="status" className="flex min-h-40 flex-col items-center justify-center gap-3 text-center text-sm font-semibold text-[var(--sf-text-muted)]"><Loader2 size={24} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /><Trans {...msg({ context: 'shell.share.loading', message: 'Preparing the shared deck…' })} /></div>;
}

// Shown when the dialog is open but has neither a shared deck nor a link to show. The header carries
// the explanation; the body keeps the dialog's shape with the empty deck stack.
function ShareDialogEmpty() {
  return <div className="share-dialog-empty flex min-h-32 items-center justify-center"><span aria-hidden="true" className="share-dialog-empty-icon"><Share2 size={22} /></span></div>;
}



export const canStartTextPractice = (
  cards: readonly CardData[],
  ownerId: string | null,
  isOffline: boolean,
): boolean => Boolean(
  ownerId
    && ownerId === ownerId.normalize('NFKC').trim()
    && !ownerId.includes('/')
    && !/[\u0000-\u001F\u007F]/.test(ownerId)
    && !isOffline
    && cards.some(card => (
      typeof card.word === 'string'
      && typeof card.translation === 'string'
      && Boolean(card.word.trim())
      && Boolean(card.translation.trim())
    )),
);

export const isWordMatchAvailable = (cards: readonly CardData[]) => eligibleWordMatchCards(cards).length >= 4;

const displayLanguageName = (code: string, locale: string) => {
  try {
    return new Intl.DisplayNames([locale === 'pseudo' || locale === 'en-XA' ? 'en' : locale || 'en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
};

export function AppOverlays({
  shareDialogOpen, shareLink, shareWarning, shareError, onDismissShareError, shareExpiresAt, outgoingSharePreview, incomingSharePreview,
  dismissShareDialog, showShareDialog, acceptSharedDeck, cancelSharedDeck,
  canRevokeShare, revokeShare, earlierShares = [], revokeEarlierShare, isSharing,
  isPracticeMenuOpen, setIsPracticeMenuOpen, startQuiz,
  cards = [], ownerId = null, isOffline = false, listenPracticeHandoff, onDismissListenPractice = () => undefined,
  startSpelling, startLanguageDrill, startMatch, startShadowing, practiceCards, visibleLibraryCount, practiceLanguage, generateStory, isStatsOpen, setIsStatsOpen,
  statsData, insightsPhase, insightsError, onRetryInsights, showClearConfirm, setShowClearConfirm, clearAll, isLoading,
  clearStatus, clearError, resetClearFeedback, deckCount, loadOwnerCardCount,
  shareOpenerRef, practiceOpenerRef, statsOpenerRef, clearOpenerRef, onExportLibrary, onOpenProgress,
}: AppOverlaysProps) {
  const { _, i18n } = useLingui();
  const ownerCardCount = useOwnerCardCount(showClearConfirm, loadOwnerCardCount);
  const clearFigures = clearLibraryFigures(
    { total: statsData.total, learned: statsData.learned, ...(deckCount === undefined ? {} : { deckCount }) },
    { tracked: !!loadOwnerCardCount, cardCount: ownerCardCount },
  );
  const shareUnavailable = !incomingSharePreview && !shareLink && !isSharing;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [practiceAction, setPracticeAction] = useState<PracticeModeId | null>(null);
  const practiceActionRef = useRef(false);
  const pendingFocusRestore = useRef<(() => void) | null>(null);
  const practiceActions: Partial<Record<PracticeModeId, () => Promise<void>>> = {
    quiz: startQuiz,
    spelling: startSpelling,
    'language-drill': startLanguageDrill,
    match: startMatch,
    shadowing: startShadowing,
    story: generateStory,
  };
  const [isTextPracticeOpen, setIsTextPracticeOpen] = useState(false);
  const textPracticeAvailable = canStartTextPractice(cards, ownerId, isOffline);
  const practiceLanguageName = practiceLanguage ? displayLanguageName(practiceLanguage, i18n.locale) : null;
  const listedPracticeModes = getPracticeModes().filter(mode => resolvePracticeModeAction(mode, practiceActions));
  const textPracticeShortcut = listedPracticeModes.length + 1;
  const practiceHasLockedMode = !textPracticeAvailable
    || listedPracticeModes.some(mode => !mode.isAvailable(practiceCards, { visibleLibraryCount }));
  const textPracticeDescription = !ownerId
    ? _(msg({ context: 'app-overlays.text-practice.signed-out', message: 'Sign in to practise with your vocabulary.' }))
    : isOffline
      ? _(msg({ context: 'app-overlays.text-practice.offline', message: 'Reconnect to start text practice.' }))
      : textPracticeAvailable
        ? _(msg({ context: 'app-overlays.text-practice.description', message: 'Use your vocabulary in a bounded six-turn text mission.' }))
        : _(msg({ context: 'app-overlays.text-practice.needs-card', message: 'Add a vocabulary card with a word and meaning first.' }));
  const activeListenPracticeHandoff = listenPracticeHandoff
    && listenPracticeHandoff.ownerId === ownerId
    && canStartTextPractice(listenPracticeHandoff.cards, ownerId, isOffline)
    ? listenPracticeHandoff
    : null;

  useEffect(() => {
    setIsTextPracticeOpen(Boolean(activeListenPracticeHandoff));
    if (activeListenPracticeHandoff) setIsPracticeMenuOpen(false);
  }, [activeListenPracticeHandoff, setIsPracticeMenuOpen]);


  const cancelPendingFocusRestore = () => {
    pendingFocusRestore.current?.();
    pendingFocusRestore.current = null;
  };

  useEffect(() => () => cancelPendingFocusRestore(), []);

  useEffect(() => {
    if (shareDialogOpen || isPracticeMenuOpen || isTextPracticeOpen || isStatsOpen || showClearConfirm) {
      cancelPendingFocusRestore();
    }
  }, [shareDialogOpen, isPracticeMenuOpen, isTextPracticeOpen, isStatsOpen, showClearConfirm]);

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

  // Number keys pick the mode with that key badge, the same as clicking its row.
  const runPracticeShortcut = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !/^[1-9]$/.test(event.key)) return;
    const row = event.currentTarget.querySelector<HTMLButtonElement>(`[data-practice-key="${event.key}"]`);
    if (!row || row.disabled) return;
    event.preventDefault();
    row.click();
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
            <GsapEntrance animationKey={`${incomingSharePreview?.shareId ?? shareLink}-${shareDialogOpen}`} variant="result" data-motion-dialog="true" data-share-dialog-frame={incomingSharePreview ? 'incoming' : 'outgoing'} className={cn('share-dialog-frame fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col text-[var(--sf-text)]', incomingSharePreview ? 'max-w-[36.25rem]' : 'max-w-[35rem]')}>
              <div data-share-dialog-body className="share-dialog-body relative flex min-h-0 flex-col overflow-hidden text-[var(--sf-text)]">
              <span aria-hidden="true" className="share-dialog-ornament share-dialog-ornament-top" />
              <span aria-hidden="true" className="share-dialog-ornament share-dialog-ornament-bottom" />
              <div className="share-dialog-header flex shrink-0 items-start gap-3.5 border-b border-[var(--sf-border)] px-5 pb-[18px] pt-[22px] sm:px-[26px]">
                <div className="min-w-0 flex-1">
                  <p className="share-dialog-kicker text-[11.5px] font-extrabold uppercase tracking-[0.16em] text-[var(--sf-brand-text)]">
                    <span aria-hidden="true" className="share-dialog-kicker-diamond" />
                    {incomingSharePreview ? <Trans {...msg({ context: 'shell.share.incoming-kicker', message: 'Shared with you' })} /> : <Trans {...msg({ id: 'shell.share.kicker', message: 'Share deck' })} />}
                  </p>
                  <Dialog.Title className="share-dialog-title mt-1 break-words text-[25px] leading-[1.12] tracking-[-0.02em] text-[var(--sf-text)] sm:text-[28px]">
                    {incomingSharePreview
                      ? categoryTitle(incomingSharePreview.category, _(msg({ id: 'shell.share.all-library', message: 'All library cards' })))
                      : shareUnavailable
                        ? <Trans {...msg({ context: 'shell.share.empty-title', message: 'No shared deck to show' })} />
                        : <Trans {...msg({ context: 'shell.share.outgoing-title', message: 'Share “{title}”' })} values={{ title: categoryTitle(outgoingSharePreview?.category ?? '', _(msg({ id: 'shell.share.all-library', message: 'All library cards' }))) || _(msg({ id: 'shell.share.kicker', message: 'Share deck' })) }} />}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1.5 text-pretty text-[13.5px] leading-[1.5] text-[var(--sf-text-muted)]">
                    {incomingSharePreview
                      ? <IncomingShareAttribution createdAt={incomingSharePreview.createdAt} locale={i18n.locale} />
                      : shareUnavailable
                        ? <Trans {...msg({ context: 'shell.share.empty-description', message: 'Close this dialog and try opening the share link again.' })} />
                        : <Trans {...msg({ context: 'shell.share.outgoing-description', message: 'Anyone with the link can preview this deck and copy it into their own library.' })} />}
                  </Dialog.Description>
                </div>
                <Dialog.Close disabled={isSharing} className="share-dialog-close relative flex size-11 shrink-0 items-center justify-center bg-transparent p-0 text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)] disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none" aria-label={_(msg({ id: 'shell.share.close', message: 'Close share dialog' }))}>
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
                  onCopy={() => void copyShareLink()}
                  onDismissCopyError={() => setCopyFailed(false)}
                  earlierShares={earlierShares}
                  onRevokeEarlier={revokeEarlierShare}
                />
              ) : isSharing ? <ShareDialogLoading /> : shareError ? null : <ShareDialogEmpty />}
              </div>
              {!incomingSharePreview && (shareLink || !isSharing) ? (
                <div className="share-dialog-footer flex shrink-0 items-center gap-2 border-t border-[var(--sf-border)] px-5 py-4 sm:px-[26px]">
                  {canRevokeShare && shareLink ? <button type="button" disabled={isSharing} onClick={() => void revokeShare()} className="share-dialog-revoke min-h-11 border-0 bg-transparent px-1 text-sm font-semibold text-[var(--sf-danger)] underline-offset-4 hover:underline disabled:cursor-wait disabled:opacity-60">{isSharing ? <Trans {...msg({ context: 'shell.share.revoking', message: 'Revoking…' })} /> : <Trans {...msg({ context: 'shell.share.revoke', message: 'Revoke link' })} />}</button> : null}
                  <Dialog.Close disabled={isSharing} className="share-dialog-action share-dialog-action-primary ml-auto flex min-h-11 items-center gap-2 px-5 text-sm font-bold shadow-[0_12px_28px_-14px_var(--sf-shadow)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60"><Trans {...msg({ context: 'shell.share.done', message: 'Done' })} /></Dialog.Close>
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
          <Dialog.Content asChild onCloseAutoFocus={event => restoreFocus(event, practiceOpenerRef)} onKeyDown={runPracticeShortcut}>
            <GsapEntrance animationKey={isPracticeMenuOpen} variant="result" data-motion-dialog="true" data-practice-picker className="overlay-dialog-frame practice-picker">
              <div className="overlay-dialog-body">
                <span aria-hidden="true" className="overlay-dialog-ornament overlay-dialog-ornament-top" />
                <span aria-hidden="true" className="overlay-dialog-ornament overlay-dialog-ornament-bottom" />
                <span aria-hidden="true" className="practice-picker-grab" />
                <div className="overlay-dialog-header">
                  <div className="min-w-0 flex-1">
                    <p className="overlay-dialog-kicker"><span aria-hidden="true" className="overlay-dialog-kicker-diamond" /><Trans {...msg({ context: 'shell.practice-menu.kicker-count', message: 'Practice · {count, plural, one {# card} other {# cards}}' })} values={{ count: visibleLibraryCount }} /></p>
                    <Dialog.Title className="overlay-dialog-title">
                      <span className="practice-picker-title-long"><Trans {...msg({ context: 'shell.practice-menu.title', message: 'Choose a practice mode' })} /></span>
                      <span className="practice-picker-title-short"><Trans {...msg({ context: 'shell.practice-menu.kicker', message: 'Practice' })} /></span>
                    </Dialog.Title>
                    <p className="practice-picker-count"><Trans {...msg({ context: 'shell.practice-menu.library-count', message: 'From your library · {count, plural, one {# card} other {# cards}}' })} values={{ count: visibleLibraryCount }} /></p>
                    <Dialog.Description className="overlay-dialog-sub"><Trans {...msg({ context: 'shell.practice-menu.description', message: 'Choose a different way to practice with words from your library.' })} /></Dialog.Description>
                  </div>
                  {practiceLanguageName && <p className="practice-picker-scope crystal-chamfer-sm"><span className="sr-only"><Trans {...msg({ context: 'shell.practice-menu.scope', message: 'Course language:' })} /> </span>{practiceLanguageName}</p>}
                  <Dialog.Close className="overlay-dialog-close" aria-label={_(msg({ id: 'shell.practice-menu.close', message: 'Close practice menu' }))}><span aria-hidden="true" className="overlay-dialog-close-surface"><X /></span></Dialog.Close>
                </div>

                <div className="practice-picker-list">
                  <PracticeModeChoices practiceCards={practiceCards} visibleLibraryCount={visibleLibraryCount} practiceAction={practiceAction} actions={practiceActions} onRun={runPracticeAction} />
                  <PracticeChoice modeId="text" icon={MessagesSquare} title={_(msg({ context: 'app-overlays.text-practice.title', message: 'Text practice' }))} duration={_(msg({ context: 'app-overlays.text-practice.duration', message: '6 turns' }))} description={textPracticeDescription} locked={!textPracticeAvailable} disabled={practiceAction !== null} shortcut={textPracticeShortcut} onClick={() => { setIsPracticeMenuOpen(false); setIsTextPracticeOpen(true); }} />
                </div>

                <div className="overlay-dialog-footer">
                  <p className="overlay-dialog-note">
                    {practiceHasLockedMode
                      ? <Trans {...msg({ context: 'shell.practice-menu.keys-unlock', message: '<0>Press</0> <1/> to pick · add cards to unlock more' })} components={{ 0: <span className="practice-picker-note-press" />, 1: <PracticeKeyRange last={textPracticeShortcut} /> }} />
                      : <Trans {...msg({ context: 'shell.practice-menu.keys', message: '<0>Press</0> <1/> to pick' })} components={{ 0: <span className="practice-picker-note-press" />, 1: <PracticeKeyRange last={textPracticeShortcut} /> }} />}
                  </p>
                  <Dialog.Close className="overlay-dialog-secondary"><Trans {...msg({ context: 'shell.practice-menu.cancel', message: 'Cancel' })} /></Dialog.Close>
                </div>
              </div>
            </GsapEntrance>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {isStatsOpen && (
        <Suspense fallback={null}>
          <LibraryInsightsDialog
            open
            onOpenChange={setIsStatsOpen}
            stats={statsData.total > 0 ? statsData : null}
            phase={insightsPhase}
            errorMessage={insightsError}
            onRetry={onRetryInsights}
            restoreFocusRef={statsOpenerRef}
            onOpenProgress={onOpenProgress ? () => { setIsStatsOpen(false); onOpenProgress(); } : undefined}
          />
        </Suspense>
      )}
      <Dialog.Root open={isTextPracticeOpen} onOpenChange={open => {
        setIsTextPracticeOpen(open);
        if (!open && activeListenPracticeHandoff) onDismissListenPractice();
      }}>
        <Dialog.Portal>
          <Dialog.Overlay data-motion-overlay className={overlayClass} />
          <Dialog.Content asChild onCloseAutoFocus={event => restoreFocus(event, practiceOpenerRef)}>
            <GsapEntrance animationKey={isTextPracticeOpen} variant="result" data-motion-dialog="true" className={cn(modalClass, 'app-text-practice max-w-lg p-3 sm:p-4')}>
              <Dialog.Title className="sr-only"><Trans {...msg({ context: 'app-overlays.text-practice-mission', message: 'Text practice mission' })} /></Dialog.Title>
              <Dialog.Description className="sr-only"><Trans {...msg({ context: 'app-overlays.practise-your-vocabulary-in-a-bounded-text-conversation', message: 'Practise your vocabulary in a bounded text conversation.' })} /></Dialog.Description>
              <TextConversationPanel
                key={activeListenPracticeHandoff ? `${activeListenPracticeHandoff.ownerId}:${activeListenPracticeHandoff.clipId}:${activeListenPracticeHandoff.generation}` : 'library-practice'}
                cards={activeListenPracticeHandoff?.cards ?? cards}
                ownerId={ownerId}
                onBack={() => {
                  setIsTextPracticeOpen(false);
                  if (activeListenPracticeHandoff) onDismissListenPractice();
                  else setIsPracticeMenuOpen(true);
                }}
                onClose={() => {
                  setIsTextPracticeOpen(false);
                  if (activeListenPracticeHandoff) onDismissListenPractice();
                }}
              />
              <span aria-hidden="true" className="app-text-practice-ribbon" />
              <span aria-hidden="true" className="app-text-practice-tail" />
            </GsapEntrance>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>


      {showClearConfirm && (
        <Suspense fallback={null}>
          <LibraryClearDialog
            open
            onOpenChange={open => {
              setShowClearConfirm(open);
              if (!open) resetClearFeedback();
            }}
            onConfirm={() => { if (!isLoading) void clearAll(); }}
            status={clearStatus}
            errorMessage={clearError}
            restoreFocusRef={clearOpenerRef}
            cardCount={clearFigures.cardCount}
            masteredCount={clearFigures.masteredCount}
            deckCount={clearFigures.deckCount}
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
  const languagePairs = useLanguagePairLabels(preview.languagePairs ?? [], i18n.locale);

  return (
    <div data-share-preview="incoming">
      {isSharing ? <div role="status" className="mb-4 flex items-center gap-2 [html:not([data-theme-family=crystal])_&]:rounded-xl border border-[var(--sf-info-line,var(--sf-brand))] bg-[var(--sf-info-bg,color-mix(in_srgb,var(--sf-brand)_8%,var(--sf-surface)))] px-3 py-2.5 text-sm font-semibold text-[var(--sf-text)]"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /><Trans {...msg({ context: 'shell.share.importing', message: 'Adding {count} cards to your new deck…' })} values={{ count: formatNumber(preview.cardCount) }} /></div> : null}
      {error && onDismissError ? <RecoverableActionFeedback message={error} dismissLabel={_(msg({ id: 'shell.share.dismiss-error', message: 'Dismiss share error' }))} onDismiss={onDismissError} className="mb-4 mt-0" /> : null}
      <div className="share-dialog-metrics grid grid-cols-3 overflow-hidden rounded-[var(--sf-card-radius,14px)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)]">
        <ShareMetric isCardCount label={<Trans {...msg({ context: 'shell.share.cards', message: 'Cards' })} />} value={formatNumber(preview.cardCount)} />
        <ShareMetric label={<Trans {...msg({ context: 'shell.share.category', message: 'Category' })} />} value={categoryTitle(preview.category, _(msg({ id: 'shell.share.all-library', message: 'All library cards' })))} />
        {languagePairs.length > 0
          ? <ShareMetric label={<Trans {...msg({ context: 'shell.share.languages', message: 'Languages' })} />} value={<span className="share-dialog-language-pairs">{languagePairs.map((pair, index) => <span key={`${index}-${pair}`} className="block">{pair}{index < languagePairs.length - 1 ? <span className="sr-only">, </span> : null}</span>)}</span>} />
          : <ShareMetric label={<Trans {...msg({ context: 'shell.share.copy', message: 'Your copy' })} />} value={<Trans {...msg({ context: 'shell.share.copy-detail', message: 'New library deck' })} />} />}
      </div>
      <div className="share-dialog-sample-heading mt-5 flex items-baseline justify-between gap-3">
        <p className="share-dialog-sample-heading-label text-xs font-semibold text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'shell.share.words-inside', message: 'A few words inside' })} /></p>
        <p className="font-mono text-xs text-[var(--sf-text-muted)]">{moreCount > 0 ? <Trans {...msg({ context: 'shell.share.more-cards', message: '+{count} more' })} values={{ count: formatNumber(moreCount) }} /> : <Trans {...msg({ context: 'shell.share.cards-count', message: '{count, plural, one {# card} other {# cards}}' })} values={{ count: preview.cardCount }} />}</p>
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
                    {word.translation ? <span lang={word.translationLanguage ?? undefined} className="mt-auto line-clamp-2 break-words text-xs leading-snug text-[var(--sf-text-muted)]">{word.translation}</span> : <span className="mt-auto text-xs text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'shell.share.no-translation', message: 'Translation not available' })} /></span>}
                    {word.origin === 'ai' ? <span className="sr-only"><Trans {...msg({ context: 'flashcard.ai-disclosure', message: 'AI-generated content may be incorrect. Please check the meaning.' })} /></span> : null}
                  </div>
                </div>
              </li>
            ))}
            {moreCount > 0 ? <li aria-hidden="true" className="share-dialog-more-count flex h-[104px] items-center justify-center rounded-[var(--sf-card-radius,14px)] border border-dashed border-[var(--sf-border)] text-xl text-[var(--sf-text-muted)]">+{formatNumber(moreCount)}</li> : null}
          </ul>
        </div>
      ) : (
        <div className="share-dialog-empty-samples mt-3 flex min-h-[104px] items-center justify-center rounded-[var(--sf-card-radius,14px)] border border-dashed border-[var(--sf-border)] px-4 text-center text-sm text-[var(--sf-text-muted)]" role="status">
          {preview.cardCount > 0 ? <Trans {...msg({ context: 'shell.share.no-sample-preview', message: 'A card preview is not available for this shared deck.' })} /> : <Trans {...msg({ context: 'shell.share.no-cards', message: 'This shared deck has no cards to add.' })} />}
        </div>
      )}
      <p className="share-dialog-safeguard mt-4 flex gap-2.5 border border-[var(--sf-info-line,var(--sf-border))] bg-[var(--sf-info-bg,color-mix(in_srgb,var(--sf-brand)_8%,var(--sf-surface)))] px-3.5 py-3 text-[13px] leading-[1.45] text-[var(--sf-text)]">
        <ShieldCheck size={17} className="share-dialog-safeguard-icon mt-0.5 shrink-0 text-[var(--sf-brand-text)]" aria-hidden="true" />
        <span><Trans {...msg({ context: 'shell.share.incoming-safeguard', message: 'Cards go into a new deck with the same name. Your existing cards and progress stay untouched.' })} /></span>
      </p>
      {data.containsAiGeneratedCards ? <div role="note" className="share-dialog-warning mt-3 flex gap-2.5 px-3.5 py-3 text-xs leading-relaxed text-[var(--sf-text)]"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span><Trans {...msg({ context: 'flashcard.ai-disclosure', message: 'AI-generated content may be incorrect. Please check the meaning.' })} /></span></div> : null}
      {expiresAt ? <p className="mt-1 text-xs text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'shell.share.expires-on', message: 'Link expires on {date}' })} values={{ date: expiresAt }} /></p> : null}
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
    <button type="button" disabled={isSharing} onClick={onCancel} className="share-dialog-action share-dialog-action-secondary min-h-11 px-4 text-sm font-semibold text-[var(--sf-text)] shadow-[0_1px_2px_var(--sf-shadow)] transition-colors hover:border-[var(--sf-brand)] disabled:cursor-wait disabled:opacity-60"><Trans {...msg({ context: 'shell.share.cancel', message: 'Cancel' })} /></button>
    <button type="button" disabled={isSharing || !canAddCards} aria-busy={isSharing} onClick={onAccept} className="share-dialog-action share-dialog-action-primary flex min-h-11 items-center justify-center gap-2 px-5 text-sm font-bold text-[var(--sf-on-brand)] shadow-[0_12px_28px_-14px_var(--sf-shadow)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55">
      {isSharing ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      {isSharing ? <Trans {...msg({ context: 'shell.share.adding', message: 'Adding…' })} /> : canAddCards ? <Trans {...msg({ context: 'shell.share.add-count', message: 'Add {count} cards' })} values={{ count: formatNumber(preview.cardCount) }} /> : <Trans {...msg({ context: 'shell.share.add-none', message: 'No cards to add' })} />}
    </button>
  </div>;
}

function useLanguagePairLabels(pairs: readonly SharedDeckLanguagePair[], locale: string) {
  const { _ } = useLingui();
  const languageName = (language: string | null, unknownLabel: string) => {
    if (!language) return unknownLabel;
    try {
      return new Intl.DisplayNames([locale], { type: 'language' }).of(language) ?? language;
    } catch {
      return language;
    }
  };
  return pairs
    .filter(pair => pair.targetLanguage || pair.translationLanguage)
    .map(pair => _({
      ...msg({ context: 'shell.share.language-pair', message: '{target} → {native}' }),
      values: {
        target: languageName(pair.targetLanguage, _(msg({ id: 'shell.share.target-unspecified', message: 'Target language unspecified' }))),
        native: languageName(pair.translationLanguage, _(msg({ id: 'shell.share.translation-unspecified', message: 'Translation language unspecified' }))),
      },
    }));
}

export function OutgoingShareDetails({
  shareLink,
  shareWarning,
  preview,
  expiresAt,
  copied,
  copyFailed,
  isSharing,
  onCopy,
  onDismissCopyError,
  earlierShares = [],
  onRevokeEarlier,
}: {
  shareLink: string;
  shareWarning: SharedDeckTruncation | null;
  preview: SharedDeckOutgoingPreview | null;
  expiresAt?: string | null;
  copied: boolean;
  copyFailed: boolean;
  isSharing: boolean;
  onCopy: () => void;
  onDismissCopyError: () => void;
  earlierShares?: readonly SharedDeckEarlierShare[];
  onRevokeEarlier?: (shareId: string) => Promise<void>;
}) {
  const { _, i18n } = useLingui();
  const data = preview;
  const title = categoryTitle(preview?.category ?? '', _(msg({ id: 'shell.share.all-library', message: 'All library cards' })));
  const expiry = formatShareDate(expiresAt ?? data?.expiresAt, i18n.locale);
  const languagePairs = useLanguagePairLabels(preview?.languagePairs ?? [], i18n.locale);
  return (
    <div data-share-preview="outgoing" className="space-y-4">
      {isSharing ? <div role="status" className="flex items-center gap-2 [html:not([data-theme-family=crystal])_&]:rounded-xl border border-[var(--sf-info-line,var(--sf-brand))] bg-[var(--sf-info-bg,color-mix(in_srgb,var(--sf-brand)_8%,var(--sf-surface)))] px-3 py-2.5 text-sm font-semibold text-[var(--sf-text)]"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /><Trans {...msg({ context: 'shell.share.updating', message: 'Updating this share link…' })} /></div> : null}
      <div className="share-dialog-deck-summary flex items-center gap-4 rounded-[var(--sf-card-radius,14px)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3.5">
        <ShareDeckCover title={title} />
        <div className="min-w-0 flex-1">
        <p className="share-dialog-deck-title break-words leading-tight text-[var(--sf-text)]">{title}</p>
          <p className="share-dialog-deck-meta mt-1.5 text-[13px] text-[var(--sf-text-muted)] tabular-nums"><Trans {...msg({ context: 'shell.share.cards-count', message: '{count, plural, one {# card} other {# cards}}' })} values={{ count: preview?.cardCount ?? 0 }} />{languagePairs.map((pair, index) => <span key={`${index}-${pair}`}> · {pair}</span>)}</p>
        </div>
      </div>
      {shareWarning ? (
        <div className="share-dialog-warning flex gap-2.5 px-3.5 py-3 text-left text-[13px] font-semibold leading-[1.45] text-[var(--sf-text)]" role="status">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span><Trans {...msg({ context: 'shell.share.truncation', message: 'This link includes {shared} of {total} cards. Create smaller decks to share the rest.' })} values={{ shared: formatNumber(shareWarning.sharedCardCount), total: formatNumber(shareWarning.totalCardCount) }} /></span>
        </div>
      ) : null}
      <label className="block text-left">
        <span className="share-dialog-link-label mb-1.5 block text-xs font-semibold text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'shell.share.link-label', message: 'Share link' })} /></span>
        <span className="share-dialog-link-shell flex h-[50px] items-center gap-2 rounded-[var(--sf-card-radius,14px)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] pl-3.5 pr-1.5 text-[var(--sf-text)]">
          <Link2 size={15} className="shrink-0 text-[var(--sf-text-muted)]" aria-hidden="true" />
          <input type="text" readOnly value={shareLink} aria-label={_(msg({ id: 'shell.share.link-input', message: 'Vocabulary deck share link' }))} className="share-dialog-link-input min-h-11 min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--sf-brand)]" />
          <button type="button" onClick={onCopy} className="share-dialog-copy-action flex h-[44px] min-w-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--sf-success)]/30 bg-[color-mix(in_srgb,var(--sf-success)_12%,transparent)] px-3 text-xs font-semibold text-[var(--sf-success)] transition-colors hover:bg-[color-mix(in_srgb,var(--sf-success)_20%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none" aria-label={_(msg({ id: 'shell.share.copy-link', message: 'Copy share link' }))}>
            {copied ? <><Check size={13} aria-hidden="true" /><Trans {...msg({ context: 'shell.share.copied', message: 'Copied' })} /></> : <><Copy size={14} aria-hidden="true" /><Trans {...msg({ context: 'shell.share.copy-short', message: 'Copy' })} /></>}
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
        <p className="sr-only" aria-live="polite">{copied ? <Trans {...msg({ context: 'shell.share.link-copied', message: 'Link copied' })} /> : ''}</p>
      )}
      <ul className="share-dialog-facts space-y-2.5" aria-label={_(msg({ id: 'shell.share.behavior', message: 'Sharing behavior' }))}>
        {[
          <Trans {...msg({ context: 'shell.share.fact-private', message: 'Recipients get their own copy; your progress and review history stay private.' })} />,
          <Trans {...msg({ context: 'shell.share.fact-edits', message: 'Edits you make later are not pushed to copies already taken.' })} />,
          <Trans {...msg({ context: 'shell.share.fact-revoke', message: 'You can revoke this link at any time.' })} />,
        ].map((fact, index) => <li key={index} className="share-dialog-fact flex gap-2.5 text-[13px] leading-[1.45] text-[var(--sf-text)]"><span className="share-dialog-fact-marker mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sf-brand)_12%,transparent)] text-[var(--sf-brand-text)]"><Check size={12} strokeWidth={3} aria-hidden="true" /></span><span>{fact}</span></li>)}
      </ul>
      {expiry ? <p className="text-xs text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'shell.share.expires-on', message: 'Link expires on {date}' })} values={{ date: expiry }} /></p> : null}
      <div className="share-dialog-warning share-dialog-privacy-warning flex items-start gap-2.5 px-3.5 py-3 text-[13px] leading-[1.45] text-[var(--sf-text)]" role="note">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span><Trans {...msg({ context: 'shell.share.privacy-warning', message: 'Shared cards may include memory hooks and personal notes. Review them for private information before sharing.' })} /></span>
      </div>
      {data?.containsAiGeneratedCards ? <div role="note" className="share-dialog-warning flex gap-2.5 px-3.5 py-3 text-xs leading-relaxed text-[var(--sf-text)]"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span><Trans {...msg({ context: 'flashcard.ai-disclosure', message: 'AI-generated content may be incorrect. Please check the meaning.' })} /></span></div> : null}
      <p className="text-xs text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'shell.share.copy-private', message: 'This link opens a preview. The recipient decides whether to add a separate copy.' })} /></p>
      {earlierShares.length > 0 && onRevokeEarlier ? (
        <EarlierShareLinks shares={earlierShares} isSharing={isSharing} onRevoke={onRevokeEarlier} />
      ) : null}
    </div>
  );
}

function EarlierShareLinks({ shares, isSharing, onRevoke }: {
  shares: readonly SharedDeckEarlierShare[];
  isSharing: boolean;
  onRevoke: (shareId: string) => Promise<void>;
}) {
  const { _, i18n } = useLingui();
  const allLibrary = _(msg({ id: 'shell.share.all-library', message: 'All library cards' }));
  return (
    <section data-share-earlier className="share-dialog-earlier space-y-2 border-t border-[var(--sf-border)] pt-4">
      <h3 className="m-0 text-xs font-semibold text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'shell.share.earlier-heading', message: 'Earlier links you can still revoke' })} /></h3>
      <ul className="m-0 list-none space-y-1 p-0">
        {shares.map(share => {
          const title = categoryTitle(share.category, allLibrary);
          const expiry = formatShareDate(share.expiresAt, i18n.locale);
          return (
            <li key={share.shareId} data-share-earlier-item={share.shareId} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 text-[13px] text-[var(--sf-text)]">
                <span className="block break-words font-semibold">{title}</span>
                {expiry ? <span className="block text-xs text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'shell.share.expires-on', message: 'Link expires on {date}' })} values={{ date: expiry }} /></span> : null}
              </span>
              <button
                type="button"
                disabled={isSharing}
                onClick={() => void onRevoke(share.shareId)}
                aria-label={_({ ...msg({ context: 'shell.share.earlier-revoke-label', message: 'Revoke the link for {title}' }), values: { title } })}
                className="share-dialog-revoke min-h-11 shrink-0 border-0 bg-transparent px-1 text-sm font-semibold text-[var(--sf-danger)] underline-offset-4 hover:underline disabled:cursor-wait disabled:opacity-60"
              ><Trans {...msg({ context: 'shell.share.earlier-revoke', message: 'Revoke' })} /></button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ShareDeckCover({ title }: { title: string }) {
  const initial = Array.from(title.trim())[0]?.toLocaleUpperCase() ?? '•';
  return <div aria-hidden="true" className="share-dialog-cover relative h-[72px] w-16 shrink-0">
    <span className="share-dialog-cover-back absolute inset-0 rounded-[10px]" />
    <span className="share-dialog-cover-mid absolute inset-0 rounded-[10px]" />
    <span className="share-dialog-cover-initial absolute inset-0 flex items-end rounded-[10px] p-1.5 text-[36px] italic leading-[.8]">{initial}</span>
  </div>;
}

export function ShareManagementButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-24 right-4 z-40 flex min-h-11 items-center gap-2 rounded-full [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-button-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-2.5 text-sm font-bold text-[var(--sf-text)] shadow-xl transition-transform hover:-translate-y-0.5 lg:bottom-6"
    >
      <Share2 size={17} aria-hidden="true" />
      <Trans {...msg({ context: 'shell.share.manage', message: 'Manage shared link' })} />
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

  return getPracticeModes().filter(mode => resolvePracticeModeAction(mode, actions)).map((mode, index) => {
    const action = resolvePracticeModeAction(mode, actions)!;
    const available = mode.isAvailable(practiceCards, { visibleLibraryCount });
    const unavailable = !available ? mode.unavailableLabel?.(practiceCards, { visibleLibraryCount }) : undefined;
    return <PracticeChoice key={mode.id} modeId={mode.id} icon={mode.icon} title={_(mode.label)} duration={_(mode.duration)} description={_(mode.description)} shortDescription={mode.shortDescription ? _(mode.shortDescription) : undefined} unavailableLabel={unavailable ? i18n._(unavailable.message.id, unavailable.values) : undefined} locked={!available} disabled={practiceAction !== null} busy={practiceAction === mode.id} shortcut={index + 1} onClick={() => void onRun(mode.id, action)} />;
  });
}

// Board glyphs for the built-in modes: the first path is drawn in the dialog, the second in the
// narrow bottom sheet. A mode registered later keeps its own registry icon.
const PRACTICE_GLYPHS: Record<string, readonly [string, string]> = {
  quiz: ['M4 5h16v14H4zM8 9h8M8 13h5', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
  spelling: ['M4 17 9 5l5 12M6 13h6M15 17h5M15 12h5', 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4'],
  match: ['M4 7h6M4 17h6M14 7h6M14 17h6M10 7l4 10M10 17l4-10', 'M13 2 4 14h7l-1 8 9-12h-7z'],
  shadowing: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3', 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3'],
  story: ['M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM8 7h6M8 11h6', 'M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z'],
};

function PracticeGlyph({ modeId, icon: Icon }: { modeId: string; icon: PracticeChoiceIcon }) {
  const paths = PRACTICE_GLYPHS[modeId];
  if (!paths) return <Icon size={20} aria-hidden />;
  return <>
    <svg className="practice-picker-glyph-wide" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[0]} /></svg>
    <svg className="practice-picker-glyph-sheet" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[1]} /></svg>
  </>;
}

function PracticeKeyRange({ last }: { last: number }) {
  return <span className="practice-picker-keys"><kbd>1</kbd><span aria-hidden="true">–</span><kbd>{Math.min(9, last)}</kbd></span>;
}

type PracticeChoiceIcon = React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;

function PracticeChoice({ modeId, icon, title, duration, description, shortDescription, unavailableLabel, locked = false, disabled = false, busy = false, shortcut, onClick }: {
  modeId: string;
  icon: PracticeChoiceIcon;
  title: string;
  duration: string;
  description: string;
  shortDescription?: string;
  unavailableLabel?: string;
  locked?: boolean;
  disabled?: boolean;
  busy?: boolean;
  shortcut?: number;
  onClick: () => void;
}) {
  const key = !locked && shortcut && shortcut <= 9 ? String(shortcut) : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked || disabled}
      aria-busy={busy}
      aria-keyshortcuts={key}
      data-practice-choice={modeId}
      data-practice-key={key}
      data-state={busy ? 'loading' : locked ? 'locked' : 'ready'}
      className="practice-picker-row crystal-chamfer-sm"
    >
      <span aria-hidden="true" className="practice-picker-row-strip" />
      <span aria-hidden="true" className="practice-picker-row-icon"><PracticeGlyph modeId={modeId} icon={icon} /></span>
      <span className="practice-picker-row-text">
        <span className="practice-picker-row-head"><span className="practice-picker-row-name">{title}</span>{' '}<span className="practice-picker-row-time">{duration}</span></span>
        <span className="practice-picker-row-desc">{description}</span>
        <span className="practice-picker-row-desc-short">{locked && unavailableLabel ? unavailableLabel : shortDescription ?? description}</span>
      </span>
      {busy
        ? <span role="status" className="practice-picker-row-status"><span aria-hidden="true" className="practice-picker-spinner" /><Trans {...msg({ context: 'shell.practice-menu.preparing', message: 'Preparing…' })} /></span>
        : locked && unavailableLabel
          ? <span className="practice-picker-row-lock"><Lock aria-hidden="true" />{unavailableLabel}</span>
          : key ? <span aria-hidden="true" className="practice-picker-row-key">{key}</span> : null}
      <ChevronRight aria-hidden="true" className="practice-picker-row-chevron" />
      <Lock aria-hidden="true" className="practice-picker-row-lock-icon" />
    </button>
  );
}

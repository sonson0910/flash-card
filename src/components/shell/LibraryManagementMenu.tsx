import {
  AlertCircle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Cloud,
  Download,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Settings2,
  Shield,
  Sparkles,
  Trash2,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { useZenGlassMode } from '../../lib/useZenGlassMode';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import type { SyncIdentityViewModel } from './shellTypes';
import type { ShellSyncStatus } from './shellSyncStatus';
import './account-menu.css';

interface LibraryManagementMenuProps {
  readonly isExporting?: boolean;
  readonly isLibraryMutationPending?: boolean;
  readonly onExportLibrary?: () => void | Promise<void>;
  readonly onClearLibrary?: (focusReturnTarget: HTMLButtonElement) => void;
  readonly onOpenInsights?: (focusReturnTarget: HTMLButtonElement) => void;
  readonly onOpenSettings?: () => void;
  readonly onSignIn?: () => void | Promise<void>;
  readonly onSignOut?: () => void | Promise<void>;
  readonly onRetrySync?: () => void | Promise<void>;
  readonly isRetryingSync?: boolean;
  readonly canSyncNow?: boolean;
  readonly sessionLost?: boolean;
  readonly syncIdentity: SyncIdentityViewModel;
  readonly syncStatus: ShellSyncStatus;
  readonly libraryCountLabel: string;
  /** Server-hydrated frame; this shell only renders the already-owned selection. */
  readonly equippedFrameId?: string | null;
  readonly ownedTitleIds?: readonly string[];
}

const menuItemClass = 'account-menu-item flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left text-xs font-bold text-[var(--sf-text)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none cursor-pointer';
const PlanUsageMeter = lazy(() => Promise.all([
  import('../../features/plan/PlanUsageMeter'), loadCatalog(getActiveUiLocale(), 'billing'),
]).then(([module]) => ({ default: module.PlanUsageMeter })));
const UpgradeDialog = lazy(() => Promise.all([
  import('../../features/billing/UpgradeDialog'), loadCatalog(getActiveUiLocale(), 'billing'),
]).then(([module]) => ({ default: module.UpgradeDialog })));
const AccountDataSection = lazy(() => Promise.all([
  import('../../features/account/AccountDataSection'), loadCatalog(getActiveUiLocale(), 'account'),
]).then(([module]) => ({ default: module.AccountDataSection })));

function getIdentityLabel(identity: SyncIdentityViewModel, accountLabel: string, connectingLabel: string): string {
  if (identity.status === 'authenticated') {
    return identity.displayName?.trim() || identity.email?.trim() || accountLabel;
  }
  if (identity.status === 'loading' || (identity.status === 'signed-out' && identity.isSigningIn)) {
    return connectingLabel;
  }
  return accountLabel;
}

function getIdentityInitials(identity: SyncIdentityViewModel): string | null {
  if (identity.status !== 'authenticated') return null;
  const name = identity.displayName?.trim();
  if (name) return name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
  return identity.email?.trim().slice(0, 1).toUpperCase() || null;
}

export const hasOwnedWordCollectorTitle = (ownedTitleIds: readonly string[] | undefined): boolean =>
  ownedTitleIds?.includes('word-collector') ?? false;

function AccountAvatar({ identity, compact = false }: { identity: SyncIdentityViewModel; compact?: boolean }) {
  if (identity.status === 'authenticated' && identity.photoUrl) {
    return <img src={identity.photoUrl} alt="" referrerPolicy="no-referrer" className="account-menu-avatar-image" />;
  }
  if (identity.status === 'loading' || (identity.status === 'signed-out' && identity.isSigningIn)) {
    return <Loader2 size={compact ? 18 : 19} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />;
  }
  const initials = getIdentityInitials(identity);
  if (initials) return <span aria-hidden="true">{initials}</span>;
  return <UserRound size={compact ? 18 : 19} aria-hidden="true" />;
}

function getStatusIcon(kind: string, busy: boolean) {
  if (busy) return Loader2;
  if (kind === 'synced') return CheckCircle2;
  if (kind === 'offline') return WifiOff;
  if (kind === 'needs-attention') return AlertCircle;
  return Cloud;
}

function shouldShowSyncNow(identity: SyncIdentityViewModel, sessionLost: boolean, canSyncNow: boolean, hasRetryCallback: boolean) {
  return canSyncNow && hasRetryCallback && !sessionLost && identity.status === 'authenticated';
}

export function LibraryManagementMenu({
  isExporting = false,
  isLibraryMutationPending = false,
  onExportLibrary,
  onClearLibrary,
  onOpenInsights,
  onOpenSettings,
  onSignIn,
  onSignOut,
  onRetrySync,
  isRetryingSync = false,
  canSyncNow = false,
  sessionLost = false,
  syncIdentity,
  syncStatus,
  libraryCountLabel,
  equippedFrameId = null,
  ownedTitleIds,
}: LibraryManagementMenuProps) {
  const { _ } = useLingui();
  const [isZenMode, setZenMode] = useZenGlassMode();
  const [isOpen, setIsOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [accountDataOpen, setAccountDataOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const availableItems = () => Array.from(
    menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [],
  );
  const focusItem = (position: 'first' | 'last') => {
    const items = availableItems();
    items[position === 'first' ? 0 : items.length - 1]?.focus();
  };
  const openAndFocus = (position: 'first' | 'last') => {
    setIsOpen(true);
    globalThis.requestAnimationFrame(() => focusItem(position));
  };
  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openAndFocus(event.key === 'ArrowDown' ? 'first' : 'last');
  };
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = availableItems();
    const currentIndex = items.findIndex(item => item === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusItem(event.key === 'Home' ? 'first' : 'last');
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length > 0) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? (direction > 0 ? 0 : items.length - 1)
        : (currentIndex + direction + items.length) % items.length;
      items[nextIndex]?.focus();
    }
  };

  const accountLabel = _(msg({ id: 'shell.feedback.account', message: 'Account' }));
  const connectingLabel = _(msg({ id: 'shell.feedback.connecting', message: 'Connecting…' }));
  const identityLabel = getIdentityLabel(syncIdentity, accountLabel, connectingLabel);
  const statusKind = sessionLost
    ? 'session-lost'
    : syncIdentity.status === 'loading'
      ? 'checking'
      : syncIdentity.status === 'signed-out'
        ? syncIdentity.isSigningIn ? 'syncing' : 'device'
        : syncStatus.kind;
  const statusLabel = sessionLost
    ? _(msg({ id: 'shell.feedback.session-ended', message: 'Session ended' }))
    : syncIdentity.status === 'loading'
      ? _(msg({ id: 'shell.sync.checking', message: 'Checking cloud…' }))
      : syncIdentity.status === 'signed-out'
        ? syncIdentity.isSigningIn
          ? _(msg({ id: 'shell.feedback.connecting', message: 'Connecting…' }))
          : _(msg({ id: 'shell.sync.device', message: 'On this device' }))
        : syncStatus.headerLabel;
  const statusDetail = sessionLost
    ? _(msg({ id: 'shell.feedback.session-ended-detail', message: 'Sign in again to restore cloud sync.' }))
    : syncIdentity.status === 'authenticated'
      ? syncStatus.detail
      : '';
  const statusBusy = !sessionLost && (syncStatus.busy || isRetryingSync || (syncIdentity.status === 'signed-out' && syncIdentity.isSigningIn));
  const StatusIcon = sessionLost ? AlertCircle : getStatusIcon(statusKind, statusBusy);
  const showSyncNow = shouldShowSyncNow(syncIdentity, sessionLost, canSyncNow, Boolean(onRetrySync));
  const canSignIn = Boolean(onSignIn && (sessionLost || (syncIdentity.status === 'signed-out' && syncIdentity.isConfigured)));
  const canSignOut = Boolean(onSignOut && syncIdentity.status === 'authenticated' && !sessionLost);
  const hasWordCollectorTitle = syncIdentity.status === 'authenticated' && hasOwnedWordCollectorTitle(ownedTitleIds);

  return (
    <div ref={rootRef} className="account-menu-root relative z-20 w-fit">
      <button
        ref={triggerRef}
        type="button"
        aria-label={_(msg({ id: 'shell.library-menu.trigger', message: 'Manage library' }))}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="library-management-menu"
        title={_(msg({ id: 'shell.library-menu.trigger', message: 'Manage library' }))}
        onClick={() => setIsOpen(open => !open)}
        onKeyDown={handleTriggerKeyDown}
        data-equipped-frame={equippedFrameId ?? undefined}
        className="account-menu-trigger claude-account-trigger flex size-11 shrink-0 items-center justify-center border border-[var(--sf-border)] bg-[var(--sf-surface-control)] text-[var(--sf-text)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
      >
        <AccountAvatar identity={syncIdentity} compact />
      </button>
      {isOpen && (
        <div className="account-menu-panel absolute right-0 top-full z-50 mt-2 text-[var(--sf-text)]">
          <div className="account-menu-surface">
            <div className="account-menu-identity">
              <span className="account-menu-avatar" data-equipped-frame={equippedFrameId ?? undefined}><AccountAvatar identity={syncIdentity} /></span>
              <div className="account-menu-identity-copy">
                <div className="account-menu-name">{identityLabel}</div>
                {syncIdentity.status === 'authenticated' && syncIdentity.email && syncIdentity.email !== identityLabel && (
                  <div className="account-menu-email" title={syncIdentity.email}>{syncIdentity.email}</div>
                )}
                {hasWordCollectorTitle && <div className="account-menu-title"><Sparkles size={12} aria-hidden="true" /><Trans id="rewards.title.word-collector" message="Word Collector" /></div>}
              </div>
            </div>

            <div
              className="account-menu-status"
              data-status-kind={statusKind}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-busy={statusBusy}
              aria-label={`${statusLabel}${statusDetail ? `. ${statusDetail}` : ''} ${libraryCountLabel}`}
            >
              <span className="account-menu-status-icon" aria-hidden="true">
                {statusBusy ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" /> : <StatusIcon size={15} />}
              </span>
              <span className="account-menu-status-copy">
                <span className="account-menu-status-label">{statusLabel}</span>
                {statusDetail && <span className="account-menu-status-detail">{statusDetail}</span>}
              </span>
              <span className="account-menu-count"><BookOpen size={13} aria-hidden="true" />{libraryCountLabel}</span>
            </div>

            <Suspense fallback={null}><PlanUsageMeter source="menu" onOpenUpgrade={() => { setIsOpen(false); setUpgradeOpen(true); }} /></Suspense>

            <div
              ref={menuRef}
              id="library-management-menu"
              role="menu"
              aria-label={_(msg({ id: 'shell.library-menu.label', message: 'Library management' }))}
              onKeyDown={handleMenuKeyDown}
            >
              {(showSyncNow || canSignIn || canSignOut) && <div className="account-menu-divider" aria-hidden="true" />}
              {showSyncNow && (
                <button
                  type="button"
                  role="menuitem"
                  className={`${menuItemClass} account-menu-sync-action`}
                  disabled={statusBusy || isRetryingSync}
                  onClick={() => { setIsOpen(false); void onRetrySync?.(); }}
                >
                  {isRetryingSync || syncStatus.busy ? <Loader2 size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw size={17} aria-hidden="true" />}
                  <Trans id="shell.sync.now" message="Sync now" />
                </button>
              )}
              {canSignIn && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={syncIdentity.status === 'signed-out' && syncIdentity.isSigningIn}
                  className={`${menuItemClass} account-menu-primary-action`}
                  onClick={() => { setIsOpen(false); void onSignIn?.(); }}
                >
                  {syncIdentity.status === 'signed-out' && syncIdentity.isSigningIn
                    ? <Loader2 size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    : <LogIn size={17} aria-hidden="true" />}
                  {sessionLost
                    ? <Trans id="shell.feedback.sign-in-again" message="Sign in again" />
                    : <Trans id="shell.sync.sign-in" message="Sign in & sync" />}
                </button>
              )}
              {canSignOut && (
                <button type="button" role="menuitem" className={menuItemClass} onClick={() => { setIsOpen(false); void onSignOut?.(); }}>
                  <LogOut size={17} aria-hidden="true" />
                  <Trans id="shell.account.sign-out" message="Sign out of cloud sync" />
                </button>
              )}
              {(canSignIn || canSignOut) && <div className="account-menu-divider" aria-hidden="true" />}
              <a role="menuitem" href="/privacy.html" className={menuItemClass}><Shield size={17} aria-hidden="true" /><Trans id="shell.menu.privacy" message="Privacy" /></a>
              <a role="menuitem" href="/terms.html" className={menuItemClass}><Shield size={17} aria-hidden="true" /><Trans id="shell.menu.terms" message="Terms" /></a>
              <a role="menuitem" href="/browser-extension-privacy.html" className={menuItemClass}><Shield size={17} aria-hidden="true" /><Trans id="shell.menu.extension-privacy" message="Extension privacy" /></a>
              <div className="account-menu-divider" aria-hidden="true" />
              <button type="button" role="menuitem" className={menuItemClass} onClick={() => { setIsOpen(false); setAccountDataOpen(true); }}><Settings2 size={17} aria-hidden="true" /><Trans id="shell.menu.account-data" message="Account data" /></button>
              {onOpenSettings && <button type="button" role="menuitem" className={menuItemClass} onClick={() => { setIsOpen(false); onOpenSettings(); }}><Settings2 size={17} aria-hidden="true" /><Trans id="shell.menu.appearance-settings" message="Appearance settings" /></button>}
              <button
                type="button"
                role="menuitem"
                onClick={() => setZenMode(prev => !prev)}
                className={menuItemClass}
                title={_(msg({ id: 'shell.library-menu.zen-toggle-description', message: 'Toggle between Standard Learning mode and Zen Minimalist Glass mode' }))}
              >
                <Sparkles size={17} aria-hidden="true" className={isZenMode ? 'text-cyan-600 dark:text-cyan-400 shrink-0 animate-pulse' : 'text-slate-400 shrink-0'} />
                <span className="truncate">{isZenMode ? <Trans id="shell.menu.card-style-zen" message="Card style: Zen Glass" /> : <Trans id="shell.menu.card-style-standard" message="Card style: Standard" />}</span>
              </button>
              {onOpenInsights && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const focusReturnTarget = triggerRef.current;
                    if (!focusReturnTarget) return;
                    setIsOpen(false);
                    onOpenInsights(focusReturnTarget);
                  }}
                  className={menuItemClass}
                >
                  <BarChart3 size={17} aria-hidden="true" className="shrink-0" />
                  <span className="truncate"><Trans id="shell.menu.insights" message="Learning insights" /></span>
                </button>
              )}
              {onExportLibrary && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={isExporting}
                  onClick={() => { setIsOpen(false); void onExportLibrary(); }}
                  className={menuItemClass}
                >
                  {isExporting ? <Loader2 size={17} className="animate-spin text-cyan-600 shrink-0 motion-reduce:animate-none" aria-hidden="true" /> : <Download size={17} aria-hidden="true" className="shrink-0" />}
                  <span className="truncate">{isExporting ? <Trans id="shell.menu.exporting" message="Exporting library…" /> : <Trans id="shell.menu.export" message="Export library to Excel" />}</span>
                </button>
              )}
              {onClearLibrary && (
                <>
                  <div className="account-menu-divider" aria-hidden="true" />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isLibraryMutationPending}
                    onClick={() => {
                      const focusReturnTarget = triggerRef.current;
                      if (!focusReturnTarget) return;
                      setIsOpen(false);
                      onClearLibrary(focusReturnTarget);
                    }}
                    className={`${menuItemClass} account-menu-danger-action`}
                  >
                    <Trash2 size={17} aria-hidden="true" className="shrink-0" />
                    <span className="truncate"><Trans id="shell.menu.clear-library" message="Clear the entire library" /></span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {upgradeOpen && <Suspense fallback={null}><UpgradeDialog open={upgradeOpen} onOpenChange={open => {
        setUpgradeOpen(open);
        if (!open) globalThis.requestAnimationFrame(() => triggerRef.current?.focus());
      }} trigger="menu" /></Suspense>}
      {accountDataOpen && <Suspense fallback={null}><AccountDataSection open={accountDataOpen} onOpenChange={open => {
        setAccountDataOpen(open);
        if (!open) globalThis.requestAnimationFrame(() => triggerRef.current?.focus());
      }} onExportLibrary={onExportLibrary} /></Suspense>}
    </div>
  );
}

export { getIdentityInitials, getIdentityLabel, shouldShowSyncNow };
export type { LibraryManagementMenuProps };

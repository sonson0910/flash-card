import { useId, useRef, useState } from 'react';
import { Trans } from '@lingui/react';
import { formatNumber } from '../lib/format';
import type { CardData } from '../types/card';
import type { ShellSyncStatus } from './shell/shellSyncStatus';
import { Lumi } from './lumi/Lumi';
import './workspace-sync-panel.css';

type PanelAction = 'retry' | 'review' | 'home';

export interface WorkspaceSyncPanelProps {
  /** Safe, localized status details prepared by the shell. */
  status: Pick<ShellSyncStatus, 'kind' | 'detail' | 'canRetry'>;
  /** False for signed-out/local-only sessions. */
  cloudSyncEnabled: boolean;
  pendingCount: number;
  /** Real due cards selected by the runtime; the panel displays at most two. */
  dueCards: readonly CardData[];
  canReview: boolean;
  isRetrying: boolean;
  onReview: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onReturnHome: () => void | Promise<void>;
}

export function WorkspaceSyncPanel({
  status,
  cloudSyncEnabled,
  pendingCount,
  dueCards,
  canReview,
  isRetrying,
  onReview,
  onRetry,
  onReturnHome,
}: WorkspaceSyncPanelProps) {
  const [busyAction, setBusyAction] = useState<PanelAction | null>(null);
  const actionLocked = useRef(false);
  const captionId = useId();

  if (status.kind !== 'needs-attention' && status.kind !== 'offline' && status.kind !== 'saving-offline') return null;

  const safePendingCount = Number.isFinite(pendingCount) ? Math.max(0, Math.floor(pendingCount)) : 0;
  const pendingCloudChanges = cloudSyncEnabled && safePendingCount > 0;
  const shownDueCards = dueCards.slice(0, 2);
  const isOffline = status.kind !== 'needs-attention';
  const retryBusy = isRetrying || busyAction === 'retry';
  const anyActionBusy = busyAction !== null || isRetrying;

  const runAction = async (kind: PanelAction, action: () => void | Promise<void>) => {
    if (actionLocked.current) return;
    actionLocked.current = true;
    setBusyAction(kind);
    try {
      await action();
    } catch {
      // The runtime reports action failures through its sync status or notice surface.
    } finally {
      actionLocked.current = false;
      setBusyAction(null);
    }
  };

  return (
    <section
      className={`workspace-sync-region ${isOffline ? 'workspace-sync-region--offline' : 'workspace-sync-region--failure'}`}
      aria-labelledby={captionId}
    >
      <p className="workspace-sync-caption" id={captionId}>
        {isOffline
          ? <Trans id="shell.sync.panel.offline-caption" message="Offline · still usable" />
          : <Trans id="shell.sync.panel.failure-caption" message="Sync issue · needs attention" />}
      </p>

      {isOffline ? (
        <OfflinePanel
          cloudSyncEnabled={cloudSyncEnabled}
          detail={status.detail}
          dueCards={shownDueCards}
          canReview={canReview}
          pendingCloudChanges={pendingCloudChanges}
          pendingCount={safePendingCount}
          busy={anyActionBusy}
          onReview={() => { void runAction('review', onReview); }}
        />
      ) : (
        <FailurePanel
          detail={status.detail}
          canRetry={status.canRetry}
          pendingCloudChanges={pendingCloudChanges}
          pendingCount={safePendingCount}
          retryBusy={retryBusy}
          busy={anyActionBusy}
          onRetry={() => { void runAction('retry', onRetry); }}
          onReturnHome={() => { void runAction('home', onReturnHome); }}
        />
      )}
    </section>
  );
}

function FailurePanel({
  detail,
  canRetry,
  pendingCloudChanges,
  pendingCount,
  retryBusy,
  busy,
  onRetry,
  onReturnHome,
}: {
  detail: string;
  canRetry: boolean;
  pendingCloudChanges: boolean;
  pendingCount: number;
  retryBusy: boolean;
  busy: boolean;
  onRetry: () => void;
  onReturnHome: () => void;
}) {
  const titleId = useId();

  return (
    <div className="workspace-sync-panel workspace-sync-panel--failure">
      <div className="workspace-sync-panel-inner">
        <div className="workspace-sync-failure-label">
          <span className="workspace-sync-status-dot" aria-hidden="true" />
          <Trans id="shell.sync.panel.failure-label" message="Sync needs attention" />
        </div>
        <h2 className="workspace-sync-title" id={titleId}>
          <Trans id="shell.sync.panel.failure-title" message="Sync needs attention." />
        </h2>
        <p className="workspace-sync-description">
          <Trans id="shell.sync.panel.failure-description" message="Review the status details below and retry if available." />
        </p>
        <div className="workspace-sync-detail" role="status" aria-labelledby={titleId} tabIndex={0}>
          {detail.trim() ? <p>{detail}</p> : null}
        </div>
        {pendingCloudChanges ? (
          <p className="workspace-sync-pending-count" role="status">
            <PendingCount count={pendingCount} />
          </p>
        ) : null}
        <div className="workspace-sync-actions">
          <button type="button" className="workspace-sync-button workspace-sync-button--primary" onClick={onRetry} disabled={!canRetry || busy}>
            {retryBusy
              ? <Trans id="shell.sync.panel.retrying" message="Retrying sync…" />
              : <Trans id="shell.sync.panel.retry" message="Retry sync" />}
          </button>
          <button type="button" className="workspace-sync-button workspace-sync-button--secondary" onClick={onReturnHome} disabled={busy}>
            <Trans id="shell.sync.panel.return-home" message="Return home" />
          </button>
        </div>
      </div>
    </div>
  );
}

function OfflinePanel({
  cloudSyncEnabled,
  detail,
  dueCards,
  canReview,
  pendingCloudChanges,
  pendingCount,
  busy,
  onReview,
}: {
  cloudSyncEnabled: boolean;
  detail: string;
  dueCards: readonly CardData[];
  canReview: boolean;
  pendingCloudChanges: boolean;
  pendingCount: number;
  busy: boolean;
  onReview: () => void;
}) {
  const offlineMessage = cloudSyncEnabled
    ? detail.trim()
      ? detail
      : undefined
    : undefined;

  return (
    <div className="workspace-sync-panel workspace-sync-panel--offline">
      <div className="workspace-sync-panel-inner">
        <div className="workspace-sync-offline-banner" role="status">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.3-2.5M19 13a10 10 0 0 0-2-1.5M12 20h.01" />
          </svg>
          <span>
            {cloudSyncEnabled
              ? offlineMessage ?? <Trans id="shell.sync.panel.offline-cloud-fallback" message="Cloud changes will wait until this device reconnects." />
              : <Trans id="shell.sync.panel.offline-local-only" message="Offline. Your local library is available on this device." />}
          </span>
        </div>

        {dueCards.length > 0 ? (
          <ul className="workspace-sync-due-cards">
            {dueCards.map(card => (
              <li className="workspace-sync-due-card" key={card.id}>
                <div className="workspace-sync-due-card-inner">
                  <span className="workspace-sync-due-label"><Trans id="shell.sync.panel.due-now" message="Due now" /></span>
                  <span className="workspace-sync-due-word" lang={card.language || undefined}>{card.word}</span>
                  {card.phonetic ? <span className="workspace-sync-due-phonetic">{card.phonetic}</span> : null}
                  <span className="workspace-sync-due-meaning" lang={card.translationLanguage || undefined}>{card.translation}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <Lumi pose="oops" size="96px" className="workspace-sync-lumi" />

        <div className="workspace-sync-offline-actions">
          <button type="button" className="workspace-sync-button workspace-sync-button--primary" onClick={onReview} disabled={!canReview || busy}>
            <Trans id="shell.sync.panel.keep-reviewing" message="Keep reviewing" />
          </button>
          {pendingCloudChanges ? (
            <span className="workspace-sync-queued-count"><PendingCount count={pendingCount} /></span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PendingCount({ count }: { count: number }) {
  return (
    <Trans
      id="shell.sync.panel.pending-count"
      message="{count, plural, one {<0>{formattedCount}</0> change queued} other {<0>{formattedCount}</0> changes queued}}"
      values={{ count, formattedCount: formatNumber(count) }}
      components={{ 0: <strong className="workspace-sync-count-number" /> }}
    />
  );
}

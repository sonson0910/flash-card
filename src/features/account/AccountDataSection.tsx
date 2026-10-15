import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Download, FileSpreadsheet, ShieldAlert, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { deleteAccount, downloadAccountData, isAccountSignedIn, LocalAccountCleanupError } from './accountDataService';
import { markAccountDeletionCacheNotice, markAccountDeletionStartedNotice } from './account-deletion-notice';

// The server validates this exact Vietnamese phrase regardless of UI locale (functions/src/index.ts); the
// confirmation instruction below tells the user to type it verbatim in every language.
const DELETE_CONFIRMATION_PHRASE = 'XÓA TÀI KHOẢN';
const normalizeConfirmation = (value: string): string => value.normalize('NFC').trim();

export function AccountDataSection({ open, onOpenChange, onExportLibrary }: {
  open: boolean; onOpenChange(open: boolean): void; onExportLibrary?: () => void | Promise<void>;
}) {
  const { _ } = useLingui();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deletionPendingRef = useRef(false);
  const confirmationMatches = normalizeConfirmation(confirmation) === DELETE_CONFIRMATION_PHRASE;
  const exportJson = async () => {
    setBusy('export'); setError(null);
    try { await downloadAccountData(); }
    catch { setError(_(msg({ id: 'account.data.error.export', message: "Couldn't download account data. Please try again later." }))); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (!confirmationMatches || deletionPendingRef.current) return;
    deletionPendingRef.current = true;
    setBusy('delete'); setError(null); setNotice(null);
    try {
      const result = await deleteAccount(confirmation);
      if (result.restartRequired) {
        if (result.status === 'started' && !markAccountDeletionStartedNotice()) {
          globalThis.alert?.(_(msg({ id: 'account.data.delete.started', message: 'We could not confirm whether account deletion finished. If you can still sign in later, contact support.' })));
        }
        if (!result.cacheCleared && !markAccountDeletionCacheNotice()) {
          globalThis.alert?.(_(msg({ id: 'account.data.delete.cache-warning', message: "SonFlash couldn't clear saved account data from this device. Clear SonFlash site data in your browser." })));
        }
        globalThis.location?.reload();
      } else {
        if (result.status === 'started') setNotice(_(msg({ id: 'account.data.delete.started', message: 'We could not confirm whether account deletion finished. If you can still sign in later, contact support.' })));
        if (!result.cacheCleared) setError(_(msg({ id: 'account.data.delete.cache-warning', message: "SonFlash couldn't clear saved account data from this device. Clear SonFlash site data in your browser." })));
        if (result.status === 'completed' && result.cacheCleared) onOpenChange(false);
      }
    } catch (error) {
      setError(error instanceof LocalAccountCleanupError
        ? _(msg({ id: 'account.data.error.local-cleanup', message: "The account was deleted on the server, but device data wasn't fully cleared. Clear SonFlash site data in your browser." }))
        : _(msg({ id: 'account.data.error.delete', message: "The account wasn't fully deleted. Contact support if the error continues." })));
    } finally {
      deletionPendingRef.current = false;
      setBusy(null);
    }
  };
  return <Dialog.Root open={open} onOpenChange={nextOpen => {
    if (!nextOpen && deletionPendingRef.current) return;
    onOpenChange(nextOpen);
  }}>
    <Dialog.Portal>
      <Dialog.Overlay className="crystal-starfield fixed inset-0 z-[100] bg-[var(--sf-scrim)] backdrop-blur-sm" />
      <Dialog.Content className="crystal-chamfer fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] [background-image:var(--sf-dialog-bg)] text-[var(--sf-text)] shadow-2xl outline-none">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--sf-border)] px-5 py-5 sm:px-7">
          <div>
            <p className="premium-kicker text-[11px] uppercase tracking-[.14em]"><Trans id="account.data.kicker" message="Privacy" /></p>
            <Dialog.Title className="mt-1 font-serif text-3xl font-bold tracking-tight [html[data-theme-family=crystal]_&]:font-display [html[data-theme-family=crystal]_&]:font-black [html[data-theme-family=crystal]_&]:italic"><Trans id="account.data.title" message="Account data" /></Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-[var(--sf-text-muted)]"><Trans id="account.data.description" message="Download a copy of your data or delete your account." /></Dialog.Description>
          </div>
          <Dialog.Close aria-label={_(msg({ id: 'account.dialog.close', message: 'Close' }))} disabled={busy === 'delete'} className="liquid-control flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--sf-text-muted)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"><X size={18} /></Dialog.Close>
        </header>
        <div className="space-y-3 px-5 py-5 sm:px-7">
          {onExportLibrary && <button type="button" className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 text-left font-semibold hover:border-[var(--sf-brand)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm" onClick={() => void onExportLibrary()}><FileSpreadsheet size={18} className="text-[var(--sf-brand-text)]" /><Trans id="account.data.export.excel" message="Download cards as Excel" /></button>}
          <button type="button" className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 text-left font-semibold hover:border-[var(--sf-brand)] disabled:opacity-50 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm" disabled={!isAccountSignedIn() || busy !== null} onClick={() => void exportJson()}><Download size={18} className="text-[var(--sf-brand-text)]" />{busy === 'export' ? <Trans id="account.data.export.json.busy" message="Exporting…" /> : <Trans id="account.data.export.json" message="Download account data (JSON, excluding cards)" />}</button>
          <button type="button" className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_6%,var(--sf-surface))] px-4 text-left font-semibold text-[var(--sf-danger)] disabled:opacity-50 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm" disabled={!isAccountSignedIn() || busy !== null} onClick={() => setConfirmOpen(true)}><Trash2 size={18} /><Trans id="account.data.delete.open" message="Delete my account" /></button>
        {confirmOpen && <div className="space-y-3 rounded-xl border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_6%,var(--sf-surface))] p-4 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
          <p className="flex gap-2 text-sm leading-6"><ShieldAlert size={18} className="mt-0.5 shrink-0 text-[var(--sf-danger)]" /><Trans id="account.data.delete.warning" message="Cards, review schedule, and Pro access will be permanently deleted. The pilot does not charge money. You need to sign in with Google again to confirm." /></p>
          <label className="block text-sm" htmlFor="account-delete-confirmation">
            <Trans id="account.data.delete.confirm-label" message="Type <phrase>XÓA TÀI KHOẢN</phrase>" components={{ phrase: <strong /> }} />
          </label>
          <input id="account-delete-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} className="min-h-11 w-full rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 text-[var(--sf-text)] outline-none focus-visible:border-[var(--sf-danger)]" />
          <button type="button" disabled={!confirmationMatches || busy !== null} onClick={() => void remove()} className="min-h-11 rounded-xl bg-[var(--sf-danger)] px-4 font-bold text-white disabled:opacity-50 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">{busy === 'delete' ? <Trans id="account.data.delete.busy" message="Deleting…" /> : <Trans id="account.data.delete.confirm" message="Confirm permanent deletion" />}</button>
        </div>}
        {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
        {error && <p role="alert" className="text-sm text-[var(--sf-danger)]">{error}</p>}
        <Dialog.Close disabled={busy === 'delete'} className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 font-semibold [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"><Trans id="account.dialog.close" message="Close" /></Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { deleteAccount, downloadAccountData, isAccountSignedIn, LocalAccountCleanupError } from './accountDataService';

const DELETE_CONFIRMATION_PHRASE = 'XÓA TÀI KHOẢN';
const normalizeConfirmation = (value: string): string => value.normalize('NFC').trim();

export function AccountDataSection({ open, onOpenChange, onExportLibrary }: {
  open: boolean; onOpenChange(open: boolean): void; onExportLibrary?: () => void | Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmationMatches = normalizeConfirmation(confirmation) === DELETE_CONFIRMATION_PHRASE;
  const exportJson = async () => {
    setBusy('export'); setError(null);
    try { await downloadAccountData(); }
    catch { setError('Không tải được dữ liệu tài khoản. Hãy thử lại sau.'); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (!confirmationMatches) return;
    setBusy('delete'); setError(null); setNotice(null);
    try {
      const result = await deleteAccount(confirmation);
      if (result === 'started') {
        setNotice('Yêu cầu xóa tài khoản đã được ghi nhận và sẽ tự hoàn tất trên máy chủ. Bạn đã được đăng xuất khỏi thiết bị này.');
      } else {
        onOpenChange(false);
      }
    } catch (error) {
      setError(error instanceof LocalAccountCleanupError
        ? 'Tài khoản đã xóa trên máy chủ, nhưng chưa xóa hết dữ liệu trên thiết bị. Hãy xóa dữ liệu trang SonFlash trong trình duyệt.'
        : 'Chưa xóa xong tài khoản. Hãy liên hệ hỗ trợ nếu lỗi tiếp diễn.');
    } finally { setBusy(null); }
  };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl bg-white p-6 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-white">
        <Dialog.Title className="text-xl font-black">Dữ liệu tài khoản</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-slate-600 dark:text-slate-300">Tải bản sao dữ liệu hoặc xóa tài khoản của bạn.</Dialog.Description>
        <div className="mt-5 flex flex-col gap-3">
          {onExportLibrary && <button type="button" className="min-h-11 rounded-xl border border-slate-300 px-4 text-left dark:border-white/30" onClick={() => void onExportLibrary()}>Tải thẻ dưới dạng Excel</button>}
          <button type="button" className="min-h-11 rounded-xl border border-slate-300 px-4 text-left disabled:opacity-50 dark:border-white/30" disabled={!isAccountSignedIn() || busy !== null} onClick={() => void exportJson()}>{busy === 'export' ? 'Đang xuất…' : 'Tải dữ liệu tài khoản (JSON)'}</button>
          <button type="button" className="min-h-11 rounded-xl border border-rose-400 px-4 text-left text-rose-700 disabled:opacity-50 dark:text-rose-300" disabled={!isAccountSignedIn() || busy !== null} onClick={() => setConfirmOpen(true)}>Xóa tài khoản của tôi</button>
        </div>
        {confirmOpen && <div className="mt-4 space-y-3 rounded-xl border border-rose-300 p-4">
          <p className="text-sm">Thẻ, lịch ôn và quyền Pro sẽ bị xóa vĩnh viễn. Pilot chưa thu tiền. Bạn cần đăng nhập Google lại để xác nhận.</p>
          <label className="block text-sm" htmlFor="account-delete-confirmation">Nhập <strong>XÓA TÀI KHOẢN</strong></label>
          <input id="account-delete-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-900" />
          <button type="button" disabled={!confirmationMatches || busy !== null} onClick={() => void remove()} className="min-h-11 rounded-xl bg-rose-700 px-4 font-bold text-white disabled:opacity-50">{busy === 'delete' ? 'Đang xóa…' : 'Xác nhận xóa vĩnh viễn'}</button>
        </div>}
        {notice && <p role="status" className="mt-4 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        <Dialog.Close className="mt-5 min-h-11 rounded-xl border border-slate-300 px-4 dark:border-white/30">Đóng</Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

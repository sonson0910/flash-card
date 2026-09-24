import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { getPilotOffer, recordPurchaseIntent, type PilotOffer } from './billingService';
import { recordPilotClientEvent } from '../../lib/analytics';

export function UpgradeDialog({ open, onOpenChange, trigger }: {
  open: boolean; onOpenChange(open: boolean): void; trigger: 'quota' | 'menu';
}) {
  const [offer, setOffer] = useState<PilotOffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    recordPilotClientEvent({ name: 'paywall_viewed', props: { trigger, offerId: 'pro-vn-30d-v1' } });
    let active = true;
    setLoading(true); setError(null); setRecorded(false);
    void getPilotOffer().then(value => { if (active) setOffer(value); }, () => {
      if (active) setError('Không tải được gói Pro. Hãy thử lại sau.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, trigger]);
  const submit = async () => {
    if (submitting || recorded) return;
    setSubmitting(true); setError(null);
    try {
      await recordPurchaseIntent(trigger);
      setRecorded(true);
    } catch {
      setError('Chưa ghi nhận được yêu cầu. Hãy thử lại sau.');
    } finally { setSubmitting(false); }
  };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-white">
        <Dialog.Title className="text-xl font-black">Gói Pro SonFlash</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-slate-600 dark:text-slate-300">Thẻ AI cùng chất lượng với gói Free, với nhiều lượt tạo hơn.</Dialog.Description>
        {loading && <p role="status" className="mt-4">Đang tải thông tin gói…</p>}
        {offer && <div className="mt-4 space-y-2 text-sm">
          <p><strong>{offer.proMonthlyAiCards.toLocaleString('vi-VN')} thẻ AI</strong> trong {offer.proDurationDays} ngày.</p>
          <p>{offer.displayPriceVnd === null ? 'Giá cuối cùng chưa được công bố.' : `Giá cuối cùng: ${offer.displayPriceVnd.toLocaleString('vi-VN')} ₫ (đã gồm VAT).`}</p>
          <p>Không tự động gia hạn. Hiện chưa thu tiền hoặc mở thanh toán.</p>
          <a href="/terms.html" className="text-cyan-700 underline dark:text-cyan-300">Xem điều khoản</a>
        </div>}
        {recorded && <p role="status" className="mt-4 text-sm font-semibold text-emerald-700 dark:text-emerald-300">Đã ghi nhận mong muốn mua. Người sáng lập sẽ liên hệ với bạn khi mở bán.</p>}
        {error && <p role="alert" className="mt-4 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          {offer && !recorded && <button type="button" disabled={submitting} onClick={() => void submit()} className="min-h-11 rounded-full bg-cyan-500 px-5 font-bold text-slate-950 disabled:opacity-60">{submitting ? 'Đang ghi nhận…' : 'Đăng ký mua khi mở bán'}</button>}
          <Dialog.Close className="min-h-11 rounded-full border border-slate-300 px-5 font-semibold dark:border-white/30">Đóng</Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

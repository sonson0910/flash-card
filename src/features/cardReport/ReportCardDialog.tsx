import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { submitCardReport, CARD_REPORT_REASONS, type CardReportReason } from './cardReportService';

const reasonLabels: Record<CardReportReason, string> = {
  'wrong-meaning': 'Nghĩa tiếng Việt chưa đúng',
  'wrong-example': 'Ví dụ chưa phù hợp',
  'wrong-pronunciation': 'Phiên âm hoặc phát âm chưa đúng',
  'wrong-image': 'Hình minh họa chưa phù hợp',
  offensive: 'Nội dung phản cảm',
  other: 'Lý do khác',
};

type ReportCardDialogProps = {
  cardId: string;
  cardWord: string;
  open: boolean;
  onOpenChange(open: boolean): void;
};

export function ReportCardDialog({ cardId, cardWord, open, onOpenChange }: ReportCardDialogProps) {
  const [reason, setReason] = useState<CardReportReason>('wrong-meaning');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || submitted) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitCardReport({ cardId, reason, ...(note.trim() ? { note: note.trim() } : {}) });
      setSubmitted(true);
    } catch {
      setError('Không gửi được báo cáo. Hãy kiểm tra kết nối rồi thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/55 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl outline-none dark:border-white/15 dark:bg-slate-900 dark:text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-black">Báo thẻ sai</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Báo cáo “{cardWord}”. Nội dung thẻ và ghi chú của bạn sẽ được gửi cho người phụ trách để xem xét.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Đóng" className="flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-white/10">
              <X size={18} />
            </Dialog.Close>
          </div>

          {submitted ? (
            <div className="mt-6 rounded-2xl border border-emerald-300/70 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900 dark:border-emerald-300/20 dark:bg-emerald-400/10 dark:text-emerald-100" role="status">
              Cảm ơn bạn. Báo cáo đã được gửi để xem xét.
            </div>
          ) : (
            <form className="mt-5 space-y-4" onSubmit={submit}>
              <label className="block text-sm font-bold" htmlFor={`card-report-reason-${cardId}`}>
                Lý do
                <select
                  id={`card-report-reason-${cardId}`}
                  value={reason}
                  onChange={event => setReason(event.target.value as CardReportReason)}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-white/20 dark:bg-slate-950"
                >
                  {CARD_REPORT_REASONS.map(value => <option key={value} value={value}>{reasonLabels[value]}</option>)}
                </select>
              </label>
              <label className="block text-sm font-bold" htmlFor={`card-report-note-${cardId}`}>
                Ghi chú <span className="font-normal text-slate-500">(không bắt buộc)</span>
                <textarea
                  id={`card-report-note-${cardId}`}
                  value={note}
                  onChange={event => setNote(event.target.value.slice(0, 280))}
                  maxLength={280}
                  rows={3}
                  className="mt-1.5 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-white/20 dark:bg-slate-950"
                  placeholder="Mô tả ngắn vấn đề…"
                />
                <span className="mt-1 block text-right text-xs font-normal text-slate-500">{note.length}/280</span>
              </label>
              {error && <p className="text-sm font-semibold text-rose-700 dark:text-rose-300" role="alert">{error}</p>}
              <p className="flex gap-2 text-xs text-slate-500 dark:text-slate-400">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                Không đưa thông tin cá nhân hoặc nội dung riêng tư vào ghi chú.
              </p>
              <button type="submit" disabled={submitting} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-cyan-500 px-4 font-black text-slate-950 disabled:opacity-60">
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {submitting ? 'Đang gửi…' : 'Gửi báo cáo'}
              </button>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

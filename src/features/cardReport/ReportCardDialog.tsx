import * as Dialog from '@radix-ui/react-dialog';
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { reportCardFailureMessage, submitCardReport, CARD_REPORT_REASONS, type CardReportReason } from './cardReportService';

const reasonLabels: Record<CardReportReason, MessageDescriptor> = {
  'wrong-meaning': msg({ id: 'cardReport.reason.wrong-meaning', message: 'The Vietnamese meaning is wrong' }),
  'wrong-example': msg({ id: 'cardReport.reason.wrong-example', message: 'The example is not a good fit' }),
  'wrong-pronunciation': msg({ id: 'cardReport.reason.wrong-pronunciation', message: 'The phonetics or pronunciation is wrong' }),
  'wrong-image': msg({ id: 'cardReport.reason.wrong-image', message: 'The illustration is not a good fit' }),
  offensive: msg({ id: 'cardReport.reason.offensive', message: 'Offensive content' }),
  other: msg({ id: 'cardReport.reason.other', message: 'Other reason' }),
};

type ReportCardDialogProps = {
  cardId: string;
  cardWord: string;
  open: boolean;
  onOpenChange(open: boolean): void;
};

export function ReportCardDialog({ cardId, cardWord, open, onOpenChange }: ReportCardDialogProps) {
  const { _ } = useLingui();
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
    } catch (cause) {
      setError(reportCardFailureMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="crystal-starfield fixed inset-0 z-[100] bg-[var(--sf-scrim)] backdrop-blur-sm" />
        <Dialog.Content className="crystal-chamfer fixed left-1/2 top-1/2 z-[101] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] [background-image:var(--sf-dialog-bg)] text-[var(--sf-text)] shadow-2xl outline-none">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--sf-border)] px-5 py-5 sm:px-7">
            <div>
              <p className="premium-kicker text-[11px] uppercase tracking-[.14em]"><Trans id="cardReport.kicker" message="Card quality" /></p>
              <Dialog.Title className="mt-1 font-serif text-3xl font-bold tracking-tight [html[data-theme-family=crystal]_&]:font-display [html[data-theme-family=crystal]_&]:font-black [html[data-theme-family=crystal]_&]:italic"><Trans id="cardReport.title" message="Report a wrong card" /></Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-[var(--sf-text-muted)]">
                <Trans id="cardReport.description" message="Reporting “{cardWord}”. The card content and your note will be sent to the operator for review." values={{ cardWord }} />
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label={_(msg({ id: 'cardReport.dialog.close', message: 'Close' }))} className="liquid-control flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
              <X size={18} />
            </Dialog.Close>
          </div>

          {submitted ? (
            <div className="m-5 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-700 dark:text-emerald-200 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm" role="status">
              <Trans id="cardReport.submitted" message="Thank you. Your report has been sent for review." />
            </div>
          ) : (
            <form className="space-y-4 px-5 py-5 sm:px-7" onSubmit={submit}>
              <label className="block text-sm font-bold" htmlFor={`card-report-reason-${cardId}`}>
                <Trans id="cardReport.reason.label" message="Reason" />
                <select
                  id={`card-report-reason-${cardId}`}
                  value={reason}
                  onChange={event => setReason(event.target.value as CardReportReason)}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 text-sm text-[var(--sf-text)] outline-none focus-visible:border-[var(--sf-brand)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--sf-brand)_24%,transparent)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                >
                  {CARD_REPORT_REASONS.map(value => <option key={value} value={value}>{_(reasonLabels[value])}</option>)}
                </select>
              </label>
              <label className="block text-sm font-bold" htmlFor={`card-report-note-${cardId}`}>
                <Trans id="cardReport.note.label" message="Note" /> <span className="font-normal text-slate-500">(<Trans id="cardReport.note.optional" message="optional" />)</span>
                <textarea
                  id={`card-report-note-${cardId}`}
                  value={note}
                  onChange={event => setNote(event.target.value.slice(0, 280))}
                  maxLength={280}
                  rows={3}
                  className="mt-1.5 w-full resize-y rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 py-2 text-sm font-normal text-[var(--sf-text)] outline-none focus-visible:border-[var(--sf-brand)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                  placeholder={_(msg({ id: 'cardReport.note.placeholder', message: 'Briefly describe the issue…' }))}
                />
                <span className="mt-1 block text-right text-xs font-normal text-[var(--sf-text-muted)]">{note.length}/280</span>
              </label>
              {error && <p className="rounded-xl border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_10%,var(--sf-surface))] p-3 text-sm font-semibold text-[var(--sf-danger)]" role="alert">{error}</p>}
              <p className="flex gap-2 text-xs text-[var(--sf-text-muted)]">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <Trans id="cardReport.privacy-hint" message="Don't include personal information or private content in the note." />
              </p>
              <button type="submit" disabled={submitting} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 font-bold text-[var(--sf-on-brand)] shadow-md hover:bg-[var(--sf-brand-hover)] disabled:opacity-60 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {submitting ? <Trans id="cardReport.submit.busy" message="Sending…" /> : <Trans id="cardReport.submit" message="Send report" />}
              </button>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import * as Dialog from '@radix-ui/react-dialog';
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import '../../components/form-dialog.css';
import { reportCardFailureMessage, submitCardReport, CARD_REPORT_REASONS, type CardReportReason } from './cardReportService';

const reasonLabels: Record<CardReportReason, MessageDescriptor> = {
  'wrong-meaning': msg({ id: 'cardReport.reason.wrong-meaning', message: 'The meaning or translation is wrong' }),
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
        <Dialog.Overlay className="crystal-starfield fixed inset-0 z-[100] dialog-veil backdrop-blur-sm" />
        <Dialog.Content className="form-dialog crystal-chamfer fixed left-1/2 top-1/2 z-[101] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] [background-image:var(--sf-dialog-bg)] text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]">
          <div className="form-dialog-header flex items-start justify-between gap-4 border-b border-[var(--sf-border)] px-5 py-5 sm:px-7">
            <div>
              <p className="premium-kicker text-[11px] uppercase tracking-[.14em]"><Trans {...msg({ context: 'cardReport.kicker', message: 'Card quality' })} /></p>
              <Dialog.Title className="form-dialog-title mt-1 font-serif text-3xl font-bold tracking-tight [html[data-theme-family=crystal]_&]:font-display [html[data-theme-family=crystal]_&]:font-black [html[data-theme-family=crystal]_&]:italic"><Trans {...msg({ context: 'cardReport.title', message: 'Report a wrong card' })} /></Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-[var(--sf-text-muted)]">
                <Trans {...msg({ context: 'cardReport.description', message: 'Reporting “{cardWord}”. The card content and your note will be sent to the operator for review.' })} values={{ cardWord }} />
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label={_(msg({ id: 'cardReport.dialog.close', message: 'Close' }))} className="form-dialog-close liquid-control flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </div>

          {submitted ? (
            <div className="form-dialog-note m-5 rounded-2xl border border-[color-mix(in_srgb,var(--sf-success)_45%,transparent)] bg-[color-mix(in_srgb,var(--sf-success)_10%,var(--sf-surface))] p-4 text-sm font-semibold text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm" role="status">
              <Trans {...msg({ context: 'cardReport.submitted', message: 'Thank you. Your report has been sent for review.' })} />
            </div>
          ) : (
            <form className="form-dialog-body space-y-4 px-5 py-5 sm:px-7" onSubmit={submit}>
              <label className="block text-sm font-bold" htmlFor={`card-report-reason-${cardId}`}>
                <Trans {...msg({ context: 'cardReport.reason.label', message: 'Reason' })} />
                <select
                  id={`card-report-reason-${cardId}`}
                  value={reason}
                  onChange={event => setReason(event.target.value as CardReportReason)}
                  className="form-dialog-field mt-1.5 min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 text-sm text-[var(--sf-text)] focus-visible:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                >
                  {CARD_REPORT_REASONS.map(value => <option key={value} value={value}>{_(reasonLabels[value])}</option>)}
                </select>
              </label>
              <label className="block text-sm font-bold" htmlFor={`card-report-note-${cardId}`}>
                <Trans {...msg({ context: 'cardReport.note.label', message: 'Note' })} /> <span className="font-normal text-[var(--sf-text-muted)]">(<Trans {...msg({ context: 'cardReport.note.optional', message: 'optional' })} />)</span>
                <textarea
                  id={`card-report-note-${cardId}`}
                  value={note}
                  onChange={event => setNote(event.target.value.slice(0, 280))}
                  maxLength={280}
                  rows={3}
                  className="form-dialog-field mt-1.5 w-full resize-y rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 py-2 text-sm font-normal text-[var(--sf-text)] focus-visible:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                  placeholder={_(msg({ id: 'cardReport.note.placeholder', message: 'Briefly describe the issue…' }))}
                />
                <span className="mt-1 block text-right text-xs font-normal text-[var(--sf-text-muted)]">{note.length}/280</span>
              </label>
              {error && <p className="form-dialog-error rounded-xl border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_10%,var(--sf-surface))] p-3 text-sm font-semibold text-[var(--sf-danger)]" role="alert">{error}</p>}
              <p className="flex gap-2 text-xs text-[var(--sf-text-muted)]">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <Trans {...msg({ context: 'cardReport.privacy-hint', message: 'Don\'t include personal information or private content in the note.' })} />
              </p>
              <button type="submit" disabled={submitting} className="form-dialog-primary flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 font-bold text-[var(--sf-on-brand)] shadow-md transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] disabled:opacity-60 motion-reduce:transition-none [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
                {submitting && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {submitting ? <Trans {...msg({ context: 'cardReport.submit.busy', message: 'Sending…' })} /> : <Trans {...msg({ context: 'cardReport.submit', message: 'Send report' })} />}
              </button>
            </form>
          )}
          <span aria-hidden="true" className="form-dialog-ribbon" />
          <span aria-hidden="true" className="form-dialog-tail" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Check, Download, Loader2, RotateCcw, X } from 'lucide-react';
import type { RefObject } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import type { SpreadsheetImportIssue, SpreadsheetImportProgress, SpreadsheetImportResult, SpreadsheetImportSummary } from './spreadsheetImportService';
import '../library/library-dialog-overlays.css';
import './spreadsheet-import-dialog.css';

export interface SpreadsheetColumnMapping {
  source: string;
  destination: string;
  required?: boolean;
}

export interface SpreadsheetImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName?: string | null;
  isImporting: boolean;
  progress: SpreadsheetImportProgress | null;
  result: SpreadsheetImportResult | null;
  mapping?: readonly SpreadsheetColumnMapping[];
  onDownloadErrorReport?: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function restoreSpreadsheetImportFocus(
  event: { preventDefault: () => void },
  restoreFocusRef?: RefObject<HTMLElement | null>,
) {
  event.preventDefault();
  restoreFocusRef?.current?.focus();
}

export function createSpreadsheetImportErrorReport(
  fileName: string | null | undefined,
  result: SpreadsheetImportResult,
): string {
  return JSON.stringify({
    fileName: fileName ?? null,
    status: result.status,
    ...(result.status === 'failed' ? { reason: result.reason } : {}),
    summary: result.summary,
    message: result.message,
    issues: result.issues ?? [],
    omittedIssues: result.omittedIssues ?? 0,
  }, null, 2);
}

export function downloadSpreadsheetImportErrorReport(
  fileName: string | null | undefined,
  result: SpreadsheetImportResult | null,
): boolean {
  if (!result || typeof document === 'undefined' || typeof URL === 'undefined') return false;
  const blob = new Blob([createSpreadsheetImportErrorReport(fileName, result)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `${(fileName || 'spreadsheet-import').replace(/\.[^.]+$/, '')}-errors.json`;
  anchor.click();
  URL.revokeObjectURL(href);
  return true;
}

export function SpreadsheetImportDialog({
  open,
  onOpenChange,
  fileName,
  isImporting,
  progress,
  result,
  mapping = [],
  onDownloadErrorReport,
  restoreFocusRef,
}: SpreadsheetImportDialogProps) {
  const { i18n } = useLingui();
  const { family } = useTheme();
  const isCrystal = family === 'crystal';
  const isTerminal = !isImporting && result !== null;
  const isSuccess = result?.status === 'completed';
  const hasErrorReport = result?.status === 'partial' || result?.status === 'failed';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="library-dialog-overlay" />
        <Dialog.Content
          className="library-dialog-frame library-dialog-frame--import"
          onCloseAutoFocus={event => restoreSpreadsheetImportFocus(event, restoreFocusRef)}
        >
          <header className="library-dialog-header">
            <div>
              <p className="library-dialog-kicker"><Trans {...msg({ context: 'library.import.kicker', message: 'Import' })} /></p>
              <Dialog.Title className="library-dialog-title"><Trans {...msg({ context: 'library.import.dialog-title', message: 'Import from spreadsheet' })} /></Dialog.Title>
              <Dialog.Description className="library-dialog-description">
                {fileName ? <code>{fileName}</code> : <Trans {...msg({ context: 'library.import.waiting-file', message: 'Preparing the selected file' })} />}
                {result || progress?.summary ? <span> · <Trans {...msg({ context: 'library.import.rows-count', message: '{count, plural, one {# row} other {# rows}}' })} values={{ count: result?.summary.total ?? progress?.summary?.total ?? 0 }} /></span> : null}
              </Dialog.Description>
            </div>
            <Dialog.Close className="library-dialog-icon-button fx-press" aria-label={i18n._(msg({ id: 'library.close', message: 'Close' }))}>
              <X size={17} aria-hidden="true" />
            </Dialog.Close>
          </header>

          <div className="library-dialog-body library-dialog-body--import fx-stagger" tabIndex={0}>
            {isImporting ? (
              <div className="spreadsheet-import-progress" role="status" aria-live="polite">
                <div className="spreadsheet-import-progress-heading">
                  <span className="spreadsheet-import-spinner sf-spin"><Loader2 size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /></span>
                  {progress && progress.total > 0 ? (
                    <strong><Trans {...msg({ context: 'library.import.progress', message: 'Importing {current, number} of {total, number}' })} values={{ current: progress.current, total: progress.total }} /></strong>
                  ) : (
                    <strong><Trans {...msg({ context: 'library.import.preparing', message: 'Reading your spreadsheet…' })} /></strong>
                  )}
                  {progress?.word ? <span className="spreadsheet-import-current"><Trans {...msg({ context: 'library.import.current-label', message: 'current:' })} /> <b>{progress.word}</b></span> : null}
                </div>
                {progress && progress.total > 0 ? (
                  isCrystal
                    ? <progress value={progress.current} max={progress.total}><Trans {...msg({ context: 'library.import.progress-fallback', message: '{current} of {total}' })} values={{ current: progress.current, total: progress.total }} /></progress>
                    : <div role="progressbar" aria-valuenow={progress.current} aria-valuemin={0} aria-valuemax={progress.total} aria-valuetext={i18n._(msg({ context: 'library.import.progress-fallback', message: '{current} of {total}' }).id, { current: progress.current, total: progress.total })} className="spreadsheet-import-bar"><div className="spreadsheet-import-bar-fill sf-grow" style={{ width: `${Math.min(100, Math.round((progress.current / progress.total) * 100))}%` }} /></div>
                ) : <div className="spreadsheet-import-indeterminate" />}
                <p><Trans {...msg({ context: 'library.import.background', message: 'You can close this — the import keeps running in the background.' })} /></p>
              </div>
            ) : null}
            {isImporting && progress?.summary ? (
              <ImportSummaryPanel summary={progress.summary} issues={progress.issues ?? []} omittedIssues={progress.omittedIssues ?? 0} inProgress />
            ) : isTerminal && result ? (
              <ImportResultPanel result={result} mapping={mapping} />
            ) : !isImporting ? (
              <div className="spreadsheet-import-empty" role="status"><Trans {...msg({ context: 'library.import.waiting', message: 'Select a spreadsheet to begin importing.' })} /></div>
            ) : null}

            {!isImporting && mapping.length > 0 ? <ImportMapping mapping={mapping} /> : null}
          </div>

          <footer className="library-dialog-footer spreadsheet-import-footer">
            {hasErrorReport && onDownloadErrorReport ? (
              <button type="button" onClick={onDownloadErrorReport} className="library-dialog-button library-dialog-button--secondary fx-press">
                <Download size={15} aria-hidden="true" />
                <Trans {...msg({ context: 'library.import.download-errors', message: 'Download error report' })} />
              </button>
            ) : <span />}
            <Dialog.Close asChild>
              <button type="button" className="library-dialog-button library-dialog-button--primary fx-press">
                {isSuccess ? <Check size={15} aria-hidden="true" /> : null}
                {isImporting ? <Trans {...msg({ id: 'common.close', message: 'Close' })} /> : <Trans {...msg({ context: 'common.done', message: 'Done' })} />}
              </button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ImportResultPanel({ result, mapping }: { result: SpreadsheetImportResult; mapping: readonly SpreadsheetColumnMapping[] }) {
  const isCompleted = result.status === 'completed';
  return (
    <div className="spreadsheet-import-result" aria-live={isCompleted ? 'polite' : 'assertive'} role={isCompleted ? 'status' : 'alert'}>
      <div className={`spreadsheet-import-result-heading is-${result.status}`}>
        {isCompleted ? <Check size={18} aria-hidden="true" /> : <RotateCcw size={18} aria-hidden="true" />}
        <strong>{isCompleted ? <Trans {...msg({ context: 'library.import.complete', message: 'Import complete' })} /> : result.status === 'partial' ? <Trans {...msg({ context: 'library.import.partial', message: 'Import partly complete' })} /> : <Trans {...msg({ context: 'library.import.status-failed', message: 'Import failed' })} />}</strong>
      </div>
      <p className="spreadsheet-import-result-message"><ImportResultDescription result={result} /></p>
      <ImportSummaryPanel summary={result.summary} issues={result.issues ?? []} omittedIssues={result.omittedIssues ?? 0} />
      {!isCompleted ? <p className="spreadsheet-import-result-guidance"><Trans {...msg({ context: 'library.import.retry-guidance', message: 'Retry failed or skipped words after checking the source rows.' })} /></p> : null}
      {mapping.length === 0 ? <p className="spreadsheet-import-result-guidance"><Trans {...msg({ context: 'library.import.mapping-service', message: 'The import service validated the supported Word and Translation fields before saving.' })} /></p> : null}
    </div>
  );
}

function ImportSummaryPanel({ summary, issues, omittedIssues, inProgress = false }: {
  summary: SpreadsheetImportSummary;
  issues: readonly SpreadsheetImportIssue[];
  omittedIssues: number;
  inProgress?: boolean;
}) {
  const rows = [
    { id: 'created', value: summary.created, label: <Trans {...msg({ context: 'library.import.created', message: 'Created' })} />, hint: <Trans {...msg({ context: 'library.import.created-hint', message: 'new cards' })} /> },
    { id: 'reused', value: summary.reused, label: <Trans {...msg({ context: 'library.import.reused', message: 'Reused' })} />, hint: <Trans {...msg({ context: 'library.import.reused-hint', message: 'already in library' })} /> },
    { id: 'skipped', value: summary.skipped, label: <Trans {...msg({ context: 'library.import.skipped', message: 'Skipped' })} />, hint: <Trans {...msg({ context: 'library.import.skipped-hint', message: 'duplicate or safety limit' })} /> },
    { id: 'failed', value: summary.failed, label: <Trans {...msg({ context: 'library.import.summary-failed', message: 'Failed' })} />, hint: <Trans {...msg({ context: 'library.import.failed-hint', message: 'needs attention' })} /> },
    { id: 'pending', value: summary.pending ?? 0, label: <Trans {...msg({ context: 'library.import.pending', message: 'Pending' })} />, hint: <Trans {...msg({ context: 'library.import.pending-hint', message: 'save not confirmed' })} /> },
  ];

  // Counts only grow while a file imports, so once a row has been skipped or failed and another has
  // been saved, the import can only end as partly complete.
  const endsPartial = inProgress && summary.skipped + summary.failed > 0 && summary.created + summary.reused > 0;

  return (
    <div className="spreadsheet-import-result">
      {inProgress ? <div className="spreadsheet-import-summary-heading">
        {endsPartial ? <span className="spreadsheet-import-partial-chip">
          <Trans {...msg({ context: 'library.import.partial-chip', message: 'Partial' })} />
          <span className="sr-only"> <Trans {...msg({ context: 'library.import.partial-chip-detail', message: 'Some rows will not be imported.' })} /></span>
        </span> : null}
        <strong><Trans {...msg({ context: 'library.import.results-so-far', message: 'Results so far' })} /></strong>
        <span className="spreadsheet-import-summary-caption"><Trans {...msg({ context: 'library.import.result-preview', message: 'Result preview' })} /></span>
      </div> : null}
      <div className="spreadsheet-import-summary">
        <dl>
          {rows.map(row => <div key={row.id} className={`spreadsheet-import-row is-${row.id}${row.id === 'failed' && row.value > 0 ? ' has-issues' : ''}`}><dt>{row.label}<small>{row.hint}</small></dt><dd>{row.value.toLocaleString()}</dd></div>)}
        </dl>
        {issues.length > 0 ? <ImportIssues issues={issues} omittedIssues={omittedIssues} /> : null}
      </div>
      {summary.deckUnassigned ? (
        <p className="spreadsheet-import-deck-note">
          <Trans {...msg({ context: 'library.import.deck-unassigned', message: '{count, plural, one {# new card named a deck you do not have, so it was saved to Unassigned.} other {# new cards named decks you do not have, so they were saved to Unassigned.}}' })} values={{ count: summary.deckUnassigned }} />
        </p>
      ) : null}
    </div>
  );
}

function ImportIssues({ issues, omittedIssues }: { issues: readonly SpreadsheetImportIssue[]; omittedIssues: number }) {
  const visible = issues.slice(0, 10);
  return <section className="spreadsheet-import-issues" aria-labelledby="spreadsheet-import-issues-title">
    <h3 id="spreadsheet-import-issues-title" className="sr-only"><Trans {...msg({ context: 'library.import.issues-title', message: 'Rows needing attention' })} /></h3>
    <ul>
      {visible.map((issue, index) => <li key={`${issue.sourceRow}-${issue.sourceColumn ?? 0}-${index}`}>
        <strong><Trans {...msg({ context: 'library.import.issue-row', message: 'Row {row, number}' })} values={{ row: issue.sourceRow }} /></strong>
        {issue.sourceColumn ? <span className="spreadsheet-import-issue-column"><Trans {...msg({ context: 'library.import.issue-column', message: 'Column {column, number}' })} values={{ column: issue.sourceColumn }} /></span> : null}
        <span aria-hidden="true">·</span>
        {issue.word ? <span className="spreadsheet-import-issue-word">“{issue.word}”</span> : null}
        <span>{issue.kind === 'pending' ? <Trans {...msg({ context: 'library.import.issue-pending', message: 'Save not confirmed' })} /> : issue.kind === 'duplicate' ? <Trans {...msg({ context: 'library.import.issue-duplicate', message: 'Duplicate' })} /> : issue.kind === 'invalid' ? <Trans {...msg({ context: 'library.import.issue-invalid', message: 'Invalid row' })} /> : issue.kind === 'generation' ? <Trans {...msg({ context: 'library.import.issue-generation', message: 'Not generated' })} /> : <Trans {...msg({ context: 'library.import.issue-failed', message: 'Could not save' })} />}</span>
      </li>)}
    </ul>
    {issues.length > visible.length || omittedIssues > 0 ? <p><Trans {...msg({ context: 'library.import.more-issues', message: '{count, plural, one {# more issue in the error report} other {# more issues in the error report}}' })} values={{ count: issues.length - visible.length + omittedIssues }} /></p> : null}
  </section>;
}

function ImportResultDescription({ result }: { result: SpreadsheetImportResult }) {
  if (result.status === 'completed') {
    return <Trans {...msg({ context: 'library.import.completed-description', message: 'The imported cards are ready in your library.' })} />;
  }
  if (result.status === 'partial') {
    return <Trans {...msg({ context: 'library.import.partial-description', message: 'Some rows were saved. Review the summary and retry the rows that need attention.' })} />;
  }
  switch (result.reason) {
    case 'size':
      return <Trans {...msg({ context: 'library.import.failed-size', message: 'This file is too large to import. Choose a smaller spreadsheet and try again.' })} />;
    case 'read':
      return <Trans {...msg({ context: 'library.import.failed-read', message: 'The spreadsheet could not be opened. Check the file and try again.' })} />;
    case 'parse':
      return <Trans {...msg({ context: 'library.import.failed-parse', message: 'The spreadsheet rows could not be read. Check the Word and Translation columns.' })} />;
    case 'empty':
      return <Trans {...msg({ context: 'library.import.failed-empty', message: 'No supported card rows were found in this spreadsheet.' })} />;
    case 'save':
      return <Trans {...msg({ context: 'library.import.failed-save', message: 'The cards could not be saved. Check your connection and try again.' })} />;
    case 'items':
      return <Trans {...msg({ context: 'library.import.failed-items', message: 'No cards were imported. Check the failed rows and your connection, then try again.' })} />;
  }
}

function ImportMapping({ mapping }: { mapping: readonly SpreadsheetColumnMapping[] }) {
  return (
    <section className="spreadsheet-import-mapping" aria-labelledby="spreadsheet-import-mapping-title">
      <h3 id="spreadsheet-import-mapping-title"><Trans {...msg({ context: 'library.import.mapping-title', message: 'Column mapping' })} /></h3>
      <ul>
        {mapping.map(item => <li key={`${item.source}-${item.destination}`}><code>{item.source}</code><span>→</span><strong>{item.destination}</strong>{item.required ? <small><Trans {...msg({ context: 'library.import.mapping-required', message: 'Required' })} /></small> : null}</li>)}
      </ul>
    </section>
  );
}

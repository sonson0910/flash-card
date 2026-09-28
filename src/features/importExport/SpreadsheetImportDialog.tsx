import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Check, Download, Loader2, RotateCcw, X } from 'lucide-react';
import type { RefObject } from 'react';
import type { SpreadsheetImportIssue, SpreadsheetImportProgress, SpreadsheetImportResult, SpreadsheetImportSummary } from './spreadsheetImportService';
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
  const isTerminal = !isImporting && result !== null;
  const isSuccess = result?.status === 'completed';
  const hasErrorReport = result?.status === 'partial' || result?.status === 'failed';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="spreadsheet-import-overlay" />
        <Dialog.Content
          className="spreadsheet-import-dialog"
          onCloseAutoFocus={event => restoreSpreadsheetImportFocus(event, restoreFocusRef)}
        >
          <header className="spreadsheet-import-header">
            <div>
              <p className="spreadsheet-import-kicker"><Trans id="library.import.kicker" message="Import" /></p>
              <Dialog.Title className="spreadsheet-import-title"><Trans id="library.import.dialog-title" message="Import from spreadsheet" /></Dialog.Title>
              <Dialog.Description className="spreadsheet-import-description">
                {fileName ? <code>{fileName}</code> : <Trans id="library.import.waiting-file" message="Preparing the selected file" />}
                {result || progress?.summary ? <span> · <Trans id="library.import.rows-count" message="{count, plural, one {# row} other {# rows}}" values={{ count: result?.summary.total ?? progress?.summary?.total ?? 0 }} /></span> : null}
              </Dialog.Description>
            </div>
            <Dialog.Close className="spreadsheet-import-close" aria-label={i18n._(msg({ id: 'library.close', message: 'Close' }))}>
              <X size={17} aria-hidden="true" />
            </Dialog.Close>
          </header>

          <div className="spreadsheet-import-body" tabIndex={0}>
            {isImporting ? (
              <div className="spreadsheet-import-progress" role="status" aria-live="polite">
                <div className="spreadsheet-import-progress-heading">
                  <span className="spreadsheet-import-spinner"><Loader2 size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /></span>
                  {progress && progress.total > 0 ? (
                    <strong><Trans id="library.import.progress" message="Importing {current, number} of {total, number}" values={{ current: progress.current, total: progress.total }} /></strong>
                  ) : (
                    <strong><Trans id="library.import.preparing" message="Reading your spreadsheet…" /></strong>
                  )}
                  {progress ? <span>{progress.word}</span> : null}
                </div>
                {progress && progress.total > 0 ? <progress value={progress.current} max={progress.total}><Trans id="library.import.progress-fallback" message="{current} of {total}" values={{ current: progress.current, total: progress.total }} /></progress> : <div className="spreadsheet-import-indeterminate" />}
                <p><Trans id="library.import.background" message="You can close this — the import keeps running in the background." /></p>
              </div>
            ) : null}
            {isImporting && progress?.summary ? (
              <ImportSummaryPanel summary={progress.summary} issues={progress.issues ?? []} omittedIssues={progress.omittedIssues ?? 0} inProgress />
            ) : isTerminal && result ? (
              <ImportResultPanel result={result} mapping={mapping} />
            ) : !isImporting ? (
              <div className="spreadsheet-import-empty" role="status"><Trans id="library.import.waiting" message="Select a spreadsheet to begin importing." /></div>
            ) : null}

            {!isImporting && mapping.length > 0 ? <ImportMapping mapping={mapping} /> : null}
          </div>

          <footer className="spreadsheet-import-footer">
            {hasErrorReport && onDownloadErrorReport ? (
              <button type="button" onClick={onDownloadErrorReport} className="spreadsheet-import-button spreadsheet-import-button--secondary">
                <Download size={15} aria-hidden="true" />
                <Trans id="library.import.download-errors" message="Download error report" />
              </button>
            ) : <span />}
            <Dialog.Close asChild>
              <button type="button" className="spreadsheet-import-button spreadsheet-import-button--primary">
                {isSuccess ? <Check size={15} aria-hidden="true" /> : null}
                {isImporting ? <Trans id="common.close" message="Close" /> : <Trans id="common.done" message="Done" />}
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
      <div className={`spreadsheet-import-result-heading${isCompleted ? ' is-complete' : ''}`}>
        {isCompleted ? <Check size={19} aria-hidden="true" /> : <RotateCcw size={19} aria-hidden="true" />}
        <strong>{isCompleted ? <Trans id="library.import.complete" message="Import complete" /> : result.status === 'partial' ? <Trans id="library.import.partial" message="Import partly complete" /> : <Trans id="library.import.status-failed" message="Import failed" />}</strong>
      </div>
      <p className="spreadsheet-import-result-message"><ImportResultDescription result={result} /></p>
      <ImportSummaryPanel summary={result.summary} issues={result.issues ?? []} omittedIssues={result.omittedIssues ?? 0} />
      {!isCompleted ? <p className="spreadsheet-import-result-guidance"><Trans id="library.import.retry-guidance" message="Retry failed or skipped words after checking the source rows." /></p> : null}
      {mapping.length === 0 ? <p className="spreadsheet-import-result-guidance"><Trans id="library.import.mapping-service" message="The import service validated the supported Word and Translation fields before saving." /></p> : null}
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
    { id: 'created', value: summary.created, label: <Trans id="library.import.created" message="Created" />, hint: <Trans id="library.import.created-hint" message="new cards" /> },
    { id: 'reused', value: summary.reused, label: <Trans id="library.import.reused" message="Reused" />, hint: <Trans id="library.import.reused-hint" message="already in library" /> },
    { id: 'skipped', value: summary.skipped, label: <Trans id="library.import.skipped" message="Skipped" />, hint: <Trans id="library.import.skipped-hint" message="duplicate or safety limit" /> },
    { id: 'failed', value: summary.failed, label: <Trans id="library.import.summary-failed" message="Failed" />, hint: <Trans id="library.import.failed-hint" message="needs attention" /> },
    { id: 'pending', value: summary.pending ?? 0, label: <Trans id="library.import.pending" message="Pending" />, hint: <Trans id="library.import.pending-hint" message="save not confirmed" /> },
  ];

  return (
    <div className="spreadsheet-import-result">
      {inProgress ? <strong><Trans id="library.import.results-so-far" message="Results so far" /></strong> : null}
      <dl className="spreadsheet-import-summary">
        {rows.map(row => <div key={row.id}><dt>{row.label}<small>{row.hint}</small></dt><dd>{row.value.toLocaleString()}</dd></div>)}
      </dl>
      {issues.length > 0 ? <ImportIssues issues={issues} omittedIssues={omittedIssues} /> : null}
    </div>
  );
}

function ImportIssues({ issues, omittedIssues }: { issues: readonly SpreadsheetImportIssue[]; omittedIssues: number }) {
  const visible = issues.slice(0, 10);
  return <section className="spreadsheet-import-mapping">
    <h3><Trans id="library.import.issues-title" message="Rows needing attention" /></h3>
    <ul>
      {visible.map((issue, index) => <li key={`${issue.sourceRow}-${issue.sourceColumn ?? 0}-${index}`}>
        <strong><Trans id="library.import.issue-row" message="Row {row, number}" values={{ row: issue.sourceRow }} /></strong>
        {issue.sourceColumn ? <span><Trans id="library.import.issue-column" message="Column {column, number}" values={{ column: issue.sourceColumn }} /></span> : null}
        {issue.word ? <code>{issue.word}</code> : null}
        <span>{issue.kind === 'pending' ? <Trans id="library.import.issue-pending" message="Save not confirmed" /> : issue.kind === 'duplicate' ? <Trans id="library.import.issue-duplicate" message="Duplicate" /> : issue.kind === 'invalid' ? <Trans id="library.import.issue-invalid" message="Invalid row" /> : issue.kind === 'generation' ? <Trans id="library.import.issue-generation" message="Not generated" /> : <Trans id="library.import.issue-failed" message="Could not save" />}</span>
      </li>)}
    </ul>
    {issues.length > visible.length || omittedIssues > 0 ? <p><Trans id="library.import.more-issues" message="{count, plural, one {# more issue in the error report} other {# more issues in the error report}}" values={{ count: issues.length - visible.length + omittedIssues }} /></p> : null}
  </section>;
}

function ImportResultDescription({ result }: { result: SpreadsheetImportResult }) {
  if (result.status === 'completed') {
    return <Trans id="library.import.completed-description" message="The imported cards are ready in your library." />;
  }
  if (result.status === 'partial') {
    return <Trans id="library.import.partial-description" message="Some rows were saved. Review the summary and retry the rows that need attention." />;
  }
  switch (result.reason) {
    case 'size':
      return <Trans id="library.import.failed-size" message="This file is too large to import. Choose a smaller spreadsheet and try again." />;
    case 'read':
      return <Trans id="library.import.failed-read" message="The spreadsheet could not be opened. Check the file and try again." />;
    case 'parse':
      return <Trans id="library.import.failed-parse" message="The spreadsheet rows could not be read. Check the Word and Translation columns." />;
    case 'empty':
      return <Trans id="library.import.failed-empty" message="No supported card rows were found in this spreadsheet." />;
    case 'save':
      return <Trans id="library.import.failed-save" message="The cards could not be saved. Check your connection and try again." />;
    case 'items':
      return <Trans id="library.import.failed-items" message="No cards were imported. Check the failed rows and your connection, then try again." />;
  }
}

function ImportMapping({ mapping }: { mapping: readonly SpreadsheetColumnMapping[] }) {
  return (
    <section className="spreadsheet-import-mapping" aria-labelledby="spreadsheet-import-mapping-title">
      <h3 id="spreadsheet-import-mapping-title"><Trans id="library.import.mapping-title" message="Column mapping" /></h3>
      <ul>
        {mapping.map(item => <li key={`${item.source}-${item.destination}`}><code>{item.source}</code><span>→</span><strong>{item.destination}</strong>{item.required ? <small><Trans id="library.import.mapping-required" message="Required" /></small> : null}</li>)}
      </ul>
    </section>
  );
}

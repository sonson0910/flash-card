import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createRadixDialogPassthroughMock } from '../../testing/radix-dialog-passthrough';
import {
  createSpreadsheetImportErrorReport,
  SpreadsheetImportDialog,
} from './SpreadsheetImportDialog';

i18n.load('en', {});
i18n.activate('en');

vi.mock('@radix-ui/react-dialog', () => createRadixDialogPassthroughMock());

const renderMarkup = (node: React.ReactNode) => renderToStaticMarkup(
  <I18nProvider i18n={i18n}>{node}</I18nProvider>,
);

const partialResult = {
  status: 'partial' as const,
  summary: { total: 5, created: 2, reused: 1, failed: 1, skipped: 0, pending: 1 },
  message: 'service detail should stay in the report',
  issues: [{ sourceRow: 5, sourceColumn: 2, word: 'banana', kind: 'pending' as const, message: 'Save not confirmed' }],
  omittedIssues: 3,
};

describe('SpreadsheetImportDialog', () => {
  it('keeps the machine-readable error report tied to the actual result', () => {
    const report = JSON.parse(createSpreadsheetImportErrorReport('lesson.xlsx', partialResult)) as Record<string, unknown>;
    expect(report).toMatchObject({
      fileName: 'lesson.xlsx',
      status: 'partial',
      summary: partialResult.summary,
      message: partialResult.message,
      issues: partialResult.issues,
      omittedIssues: 3,
    });
    expect(report.reason).toBeUndefined();
  });

  it('renders real progress, mapping, and localized terminal guidance', () => {
    const progress = renderMarkup(
      <SpreadsheetImportDialog
        open
        onOpenChange={vi.fn()}
        fileName="lesson.xlsx"
        isImporting
        progress={{
          current: 2, total: 5, word: 'banana', phase: 'saving',
          summary: { total: 5, created: 1, reused: 0, failed: 0, skipped: 0, pending: 4 },
          issues: partialResult.issues,
        }}
        result={null}
      />,
    );
    expect(progress).toContain('Importing 2 of 5');
    expect(progress).toContain('banana');
    expect(progress).toContain('Results so far');
    expect(progress).toContain('Result preview');
    expect(progress).not.toContain('spreadsheet-import-partial-chip');
    expect(progress).toContain('Row 5');
    expect(progress).toContain('Pending');

    const terminal = renderMarkup(
      <SpreadsheetImportDialog
        open
        onOpenChange={vi.fn()}
        fileName="lesson.xlsx"
        isImporting={false}
        progress={null}
        result={partialResult}
        mapping={[{ source: 'Word', destination: 'Word', required: true }]}
        onDownloadErrorReport={vi.fn()}
      />,
    );
    expect(terminal).toContain('Import partly complete');
    expect(terminal).toContain('Column mapping');
    expect(terminal).toContain('Download error report');
    expect(terminal).toContain('Pending');
    expect(terminal).toContain('3 more issues in the error report');
    expect(terminal).not.toContain(partialResult.message);
    expect(terminal).not.toContain('spreadsheet-import-deck-note');
  });

  it('marks an import as partial while it runs only once a saved row and a skipped or failed row are both counted', () => {
    const renderProgress = (summary: { created: number; reused: number; failed: number; skipped: number }) => renderMarkup(
      <SpreadsheetImportDialog
        open
        onOpenChange={vi.fn()}
        fileName="lesson.xlsx"
        isImporting
        progress={{ current: 3, total: 8, word: 'banana', phase: 'saving', summary: { total: 8, pending: 4, ...summary } }}
        result={null}
      />,
    );

    const partial = renderProgress({ created: 2, reused: 0, failed: 1, skipped: 1 });
    expect(partial).toContain('spreadsheet-import-partial-chip');
    expect(partial).toContain('Some rows will not be imported.');
    expect(renderProgress({ created: 0, reused: 0, failed: 2, skipped: 2 })).not.toContain('spreadsheet-import-partial-chip');
    expect(renderProgress({ created: 3, reused: 1, failed: 0, skipped: 0 })).not.toContain('spreadsheet-import-partial-chip');
  });

  it('says how many new cards went to Unassigned because their deck is unknown', () => {
    const render = (deckUnassigned: number) => renderMarkup(
      <SpreadsheetImportDialog
        open
        onOpenChange={vi.fn()}
        fileName="lesson.csv"
        isImporting={false}
        progress={null}
        result={{
          status: 'completed',
          summary: { total: 4, created: 4, reused: 0, failed: 0, skipped: 0, pending: 0, deckUnassigned },
          message: 'done',
        }}
      />,
    );

    expect(render(1)).toContain('1 new card named a deck you do not have, so it was saved to Unassigned.');
    expect(render(3)).toContain('3 new cards named decks you do not have, so they were saved to Unassigned.');
    expect(render(0)).not.toContain('spreadsheet-import-deck-note');
  });
});

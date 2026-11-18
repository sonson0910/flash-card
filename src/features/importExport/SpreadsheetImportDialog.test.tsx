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
  });
});

import { i18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import { spreadsheetRequestFromFile } from './spreadsheetFileRequest';

i18n.load('en', {});
i18n.activate('en');

const csvFile = (content: string, name = 'cards.csv'): File => (
  new File([new TextEncoder().encode(content)], name, { type: 'text/csv' })
);

describe('spreadsheetRequestFromFile', () => {
  it('carries the file byte size through unchanged', () => {
    const file = csvFile('Word,Translation\napple,táo\n');
    const request = spreadsheetRequestFromFile(file);
    expect(request.sizeBytes).toBe(file.size);
  });

  it('loads a real workbook through the shared loader', async () => {
    const file = csvFile('Word,Translation\napple,táo\n');
    const workbook = await spreadsheetRequestFromFile(file).loadWorkbook();
    expect(workbook).toMatchObject({
      structuredRows: [{ Word: 'apple', Translation: 'táo' }],
      flatRows: [['Word', 'Translation'], ['apple', 'táo']],
    });
  });

  it('surfaces the shared loader rejection for legacy .xls files', async () => {
    const file = new File([new TextEncoder().encode('irrelevant')], 'cards.xls', { type: 'application/octet-stream' });
    await expect(spreadsheetRequestFromFile(file).loadWorkbook()).rejects.toThrow(/xls/i);
  });
});

import { describe, expect, it } from 'vitest';
import { SpreadsheetReadError } from '../importExport/spreadsheetImportService';
import { assertSafeSpreadsheetArchive } from './spreadsheetFileRequest';

const zipWithEntry = (compressedSize: number, uncompressedSize: number): ArrayBuffer => {
  const bytes = new ArrayBuffer(68);
  const view = new DataView(bytes);
  view.setUint32(0, 0x02014b50, true);
  view.setUint32(20, compressedSize, true);
  view.setUint32(24, uncompressedSize, true);
  view.setUint32(46, 0x06054b50, true);
  view.setUint16(54, 1, true);
  view.setUint16(56, 1, true);
  view.setUint32(58, 46, true);
  return bytes;
};

describe('spreadsheet file request', () => {
  it('rejects an XLSX archive whose declared expansion exceeds the browser safety limit', () => {
    expect(() => assertSafeSpreadsheetArchive(zipWithEntry(1, 100 * 1024 * 1024)))
      .toThrow(SpreadsheetReadError);
  });
});

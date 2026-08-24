import type { SpreadsheetImportRequest } from '../importExport/spreadsheetImportService';
import { loadSpreadsheetWorkbook } from '../importExport/spreadsheetWorkbook';

export const spreadsheetRequestFromFile = (file: File): SpreadsheetImportRequest => ({
  sizeBytes: file.size,
  loadWorkbook: () => loadSpreadsheetWorkbook(file),
});

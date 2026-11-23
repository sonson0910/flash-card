import type { SpreadsheetImportRequest } from '../importExport/spreadsheetImportService';
import { loadSpreadsheetWorkbook, type SpreadsheetImportSettings } from '../importExport/spreadsheetWorkbook';

export const spreadsheetRequestFromFile = (file: File, settings: SpreadsheetImportSettings = {}): SpreadsheetImportRequest => {
  // Copied now: the import reads the learner's decks as they were when the file was chosen.
  const captured: SpreadsheetImportSettings = settings.deckNames ? { deckNames: [...settings.deckNames] } : {};
  return {
    sizeBytes: file.size,
    loadWorkbook: () => loadSpreadsheetWorkbook(file, captured),
  };
};

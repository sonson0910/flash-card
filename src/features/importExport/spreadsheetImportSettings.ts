/**
 * What the library knows about the learner when it hands a spreadsheet file to
 * the import: the deck names a Deck cell may use. The file itself travels
 * through the card intake unchanged, so the settings are kept beside it, keyed
 * by the file object, and the workbook loader picks them up.
 */
export interface SpreadsheetImportSettings {
  readonly deckNames: readonly string[];
}

const settingsByFile = new WeakMap<Blob, SpreadsheetImportSettings>();

export const attachSpreadsheetImportSettings = <T extends Blob>(file: T, settings: SpreadsheetImportSettings): T => {
  settingsByFile.set(file, { deckNames: [...settings.deckNames] });
  return file;
};

export const spreadsheetImportSettingsFor = (file: Blob): SpreadsheetImportSettings | null =>
  settingsByFile.get(file) ?? null;

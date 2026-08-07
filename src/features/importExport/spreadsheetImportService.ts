import { cardWordKey, normalizeCardWord } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';
import { extractFlatWords, parseStructuredCardRows } from './spreadsheetModel';
import { planStructuredImportMutation, type SortableCardData } from './spreadsheetMutation';

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_AI_CARDS = 30;

export interface SpreadsheetWorkbook {
  structuredRows: unknown[];
  flatRows: unknown[][];
}

export interface SpreadsheetImportRequest {
  sizeBytes: number;
  loadWorkbook: () => Promise<SpreadsheetWorkbook | null>;
}

export interface SpreadsheetImportProgress {
  current: number;
  total: number;
  word: string;
}

export interface StructuredIntakePlan {
  creates: SortableCardData[];
  patches: Array<{
    card: SortableCardData;
    fields: Partial<CardData>;
  }>;
}

export interface FlatIntakeSummary {
  successCount: number;
  generatedCount: number;
  skippedForAiLimit: number;
  categoryDeltas: Record<string, number>;
}

export interface CardIntakePort {
  findExisting(words: readonly string[]): Promise<Map<string, CardData>>;
  persistStructured(plan: StructuredIntakePlan): Promise<{ createdCount: number }>;
  touchExisting(card: CardData, touchedAt: string): Promise<void>;
  generate(word: string, generatedBefore: number): Promise<{ created: boolean; category?: string }>;
  completeFlat(summary: FlatIntakeSummary): Promise<void>;
}

export interface SpreadsheetImportFeedbackPort {
  start(): void;
  clearError(): void;
  progress(value: SpreadsheetImportProgress | null): void;
  error(message: string): void;
  finish(): void;
  resetSource(): void;
}

export interface SpreadsheetImportDiagnosticsPort {
  itemFailed?(word: string, error: unknown): void;
  workbookFailed?(error: unknown): void;
}

export class SpreadsheetReadError extends Error {
  constructor(message = 'Failed to read the spreadsheet.') {
    super(message);
    this.name = 'SpreadsheetReadError';
  }
}

interface SpreadsheetImportServiceOptions {
  cards: CardIntakePort;
  feedback: SpreadsheetImportFeedbackPort;
  diagnostics?: SpreadsheetImportDiagnosticsPort;
  maxFileBytes?: number;
  maxAiCards?: number;
  now?: () => string;
  delay?: (milliseconds: number) => Promise<void>;
}

export function createSpreadsheetImportService({
  cards,
  feedback,
  diagnostics = {},
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  maxAiCards = DEFAULT_MAX_AI_CARDS,
  now = () => new Date().toISOString(),
  delay = milliseconds => new Promise<void>(resolve => globalThis.setTimeout(resolve, milliseconds)),
}: SpreadsheetImportServiceOptions) {
  const importSpreadsheet = async ({ sizeBytes, loadWorkbook }: SpreadsheetImportRequest) => {
    if (sizeBytes > maxFileBytes) {
      feedback.error(`The spreadsheet is too large. Maximum file size is ${Math.floor(maxFileBytes / 1024 / 1024)} MB.`);
      feedback.resetSource();
      return;
    }

    feedback.start();
    feedback.clearError();

    try {
      const workbook = await loadWorkbook();
      if (!workbook) return;

      const structuredRows = parseStructuredCardRows(workbook.structuredRows);
      if (structuredRows.length > 0) {
        const existingCards = await cards.findExisting(structuredRows.map(row => row.word));
        const plan: StructuredIntakePlan = { creates: [], patches: [] };

        for (const row of structuredRows) {
          const mutation = planStructuredImportMutation(row, existingCards.get(row.word) ?? null, now());
          if (mutation.kind === 'create') {
            plan.creates.push(mutation.card);
          } else {
            plan.patches.push({ card: mutation.card, fields: mutation.fields });
          }
        }

        await cards.persistStructured(plan);
        return;
      }

      const words = extractFlatWords(workbook.flatRows);
      if (words.length === 0) {
        feedback.error('No words found in the Excel file.');
        return;
      }

      const existingCards = await cards.findExisting(words);
      let successCount = 0;
      let generatedCount = 0;
      let skippedForAiLimit = 0;
      const categoryDeltas: Record<string, number> = {};

      for (let index = 0; index < words.length; index += 1) {
        const word = words[index];
        feedback.progress({ current: index + 1, total: words.length, word });
        const existing = existingCards.get(normalizeCardWord(word));
        if (existing) {
          await cards.touchExisting(existing, now());
          successCount += 1;
          continue;
        }

        if (generatedCount >= maxAiCards) {
          skippedForAiLimit += 1;
          continue;
        }

        try {
          const result = await cards.generate(word, generatedCount);
          if (result.created) {
            generatedCount += 1;
            const category = result.category || 'Other';
            categoryDeltas[category] = (categoryDeltas[category] || 0) + 1;
          }
          successCount += 1;
          if (index < words.length - 1) await delay(2500);
        } catch (error) {
          diagnostics.itemFailed?.(word, error);
        }
      }

      const summary = { successCount, generatedCount, skippedForAiLimit, categoryDeltas };
      await cards.completeFlat(summary);

      if (skippedForAiLimit > 0) {
        feedback.error(`Created the safe limit of ${maxAiCards} AI cards in one import; ${skippedForAiLimit} words were left for a later batch.`);
      } else if (successCount === 0) {
        feedback.error('Failed to import some or all words. Rate limits or connectivity issues might have occurred.');
      }
    } catch (error) {
      diagnostics.workbookFailed?.(error);
      feedback.error(error instanceof SpreadsheetReadError ? 'Failed to read the Excel file.' : 'Failed to parse Excel file.');
    } finally {
      feedback.progress(null);
      feedback.finish();
      feedback.resetSource();
    }
  };

  return { import: importSpreadsheet };
}

export const indexCardsByNormalizedWord = (cards: readonly CardData[]) =>
  new Map(cards.map(card => [cardWordKey(card), card]));

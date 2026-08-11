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

export interface SpreadsheetImportSummary {
  total: number;
  created: number;
  reused: number;
  failed: number;
  skipped: number;
}

export type SpreadsheetImportFailureReason = 'size' | 'read' | 'parse' | 'empty' | 'save' | 'items';

export type SpreadsheetImportResult =
  | { status: 'completed'; summary: SpreadsheetImportSummary; message: string }
  | { status: 'partial'; summary: SpreadsheetImportSummary; message: string }
  | {
    status: 'failed';
    reason: SpreadsheetImportFailureReason;
    summary: SpreadsheetImportSummary;
    message: string;
  };

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

const emptyImportSummary = (): SpreadsheetImportSummary => ({
  total: 0,
  created: 0,
  reused: 0,
  failed: 0,
  skipped: 0,
});

const formatCount = (value: number) => value.toLocaleString('en-US');

const completedImportResult = (
  summary: SpreadsheetImportSummary,
): SpreadsheetImportResult => ({
  status: 'completed',
  summary,
  message: `Import complete: ${formatCount(summary.created)} created, ${formatCount(summary.reused)} already in your library.`,
});

const itemImportResult = (summary: SpreadsheetImportSummary): SpreadsheetImportResult => {
  const successful = summary.created + summary.reused;
  if (summary.failed === 0 && summary.skipped === 0) return completedImportResult(summary);
  if (successful === 0) {
    const details = [
      summary.failed > 0 ? `${formatCount(summary.failed)} items failed` : null,
      summary.skipped > 0 ? `${formatCount(summary.skipped)} items were skipped by the AI safety limit` : null,
    ].filter(Boolean).join(' and ');
    return {
      status: 'failed',
      reason: 'items',
      summary,
      message: `No cards were imported: ${details}. Check your sign-in and connection, then try again.`,
    };
  }
  return {
    status: 'partial',
    summary,
    message: `Import partly finished: ${formatCount(summary.created)} created, ${formatCount(summary.reused)} already present, ${formatCount(summary.failed)} failed, and ${formatCount(summary.skipped)} skipped by the AI safety limit. Retry the failed or skipped words later.`,
  };
};

export function createSpreadsheetImportService({
  cards,
  feedback,
  diagnostics = {},
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  maxAiCards = DEFAULT_MAX_AI_CARDS,
  now = () => new Date().toISOString(),
  delay = milliseconds => new Promise<void>(resolve => globalThis.setTimeout(resolve, milliseconds)),
}: SpreadsheetImportServiceOptions) {
  const importSpreadsheet = async ({
    sizeBytes,
    loadWorkbook,
  }: SpreadsheetImportRequest): Promise<SpreadsheetImportResult> => {
    let summary = emptyImportSummary();
    let phase: 'load' | 'parse' | 'save' = 'load';
    if (sizeBytes > maxFileBytes) {
      const message = `The spreadsheet is too large. Maximum file size is ${Math.floor(maxFileBytes / 1024 / 1024)} MB.`;
      feedback.error(message);
      feedback.resetSource();
      return { status: 'failed', reason: 'size', summary, message };
    }

    feedback.start();
    feedback.clearError();

    try {
      const workbook = await loadWorkbook();
      if (!workbook) {
        const message = 'Could not read this spreadsheet. Make sure it is a valid Excel or CSV file, then try again.';
        feedback.error(message);
        return { status: 'failed', reason: 'read', summary, message };
      }

      phase = 'parse';
      const structuredRows = parseStructuredCardRows(workbook.structuredRows);
      if (structuredRows.length > 0) {
        summary = { ...summary, total: structuredRows.length };
        phase = 'save';
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

        const persisted = await cards.persistStructured(plan);
        const created = Math.max(0, Math.min(plan.creates.length, persisted.createdCount));
        summary = {
          ...summary,
          created,
          reused: plan.patches.length + (plan.creates.length - created),
        };
        return completedImportResult(summary);
      }

      const words = extractFlatWords(workbook.flatRows);
      summary = { ...summary, total: words.length };
      if (words.length === 0) {
        const message = 'No importable words were found. Add a Word column or a simple list of words, then try again.';
        feedback.error(message);
        return { status: 'failed', reason: 'empty', summary, message };
      }

      phase = 'save';
      const existingCards = await cards.findExisting(words);
      const categoryDeltas: Record<string, number> = {};

      for (let index = 0; index < words.length; index += 1) {
        const word = words[index];
        feedback.progress({ current: index + 1, total: words.length, word });
        const existing = existingCards.get(normalizeCardWord(word));
        if (existing) {
          try {
            await cards.touchExisting(existing, now());
            summary.reused += 1;
          } catch (error) {
            summary.failed += 1;
            diagnostics.itemFailed?.(word, error);
          }
          continue;
        }

        if (summary.created >= maxAiCards) {
          summary.skipped += 1;
          continue;
        }

        try {
          const result = await cards.generate(word, summary.created);
          if (result.created) {
            summary.created += 1;
            const category = result.category || 'Other';
            categoryDeltas[category] = (categoryDeltas[category] || 0) + 1;
          } else {
            summary.reused += 1;
          }
        } catch (error) {
          summary.failed += 1;
          diagnostics.itemFailed?.(word, error);
        }
        if (index < words.length - 1 && summary.created < maxAiCards) await delay(2500);
      }

      await cards.completeFlat({
        successCount: summary.created + summary.reused,
        generatedCount: summary.created,
        skippedForAiLimit: summary.skipped,
        categoryDeltas,
      });

      const result = itemImportResult(summary);
      if (result.status !== 'completed') feedback.error(result.message);
      return result;
    } catch (error) {
      diagnostics.workbookFailed?.(error);
      if (error instanceof SpreadsheetReadError) {
        const message = 'Could not read this spreadsheet. Make sure it is a valid Excel or CSV file, then try again.';
        feedback.error(message);
        return { status: 'failed', reason: 'read', summary, message };
      }
      if (phase !== 'save') {
        const message = 'Could not understand this spreadsheet. Check its columns and file format, then try again.';
        feedback.error(message);
        return { status: 'failed', reason: 'parse', summary, message };
      }

      if (summary.total > 0 && summary.created + summary.reused + summary.failed + summary.skipped === 0) {
        summary = { ...summary, failed: summary.total };
      }
      const message = 'Could not save the imported cards. Check your sign-in and connection, then try the same file again.';
      feedback.error(message);
      if (summary.created + summary.reused > 0) {
        return { status: 'partial', summary, message };
      }
      return { status: 'failed', reason: 'save', summary, message };
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

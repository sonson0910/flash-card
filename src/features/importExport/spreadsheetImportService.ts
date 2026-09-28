import { cardLogicalKey, cardWordKey, normalizeCardWord } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';
import {
  classifyFlatWords,
  classifyStructuredCardRows,
  type FlatWordClassification,
} from './spreadsheetModel';
import { planStructuredImportMutation, type SortableCardData } from './spreadsheetMutation';
import {
  MAX_SPREADSHEET_FILE_BYTES,
  SpreadsheetReadError,
  SpreadsheetUnsupportedFormatError,
} from './spreadsheetWorkbook';
import type { SpreadsheetWorkbook } from './spreadsheetWorkbook';

const DEFAULT_MAX_AI_CARDS = 30;

export {
  MAX_SPREADSHEET_FILE_BYTES,
  SpreadsheetReadError,
  SpreadsheetUnsupportedFormatError,
} from './spreadsheetWorkbook';
export type { SpreadsheetWorkbook } from './spreadsheetWorkbook';

export interface SpreadsheetImportRequest {
  sizeBytes: number;
  loadWorkbook: () => Promise<SpreadsheetWorkbook | null>;
}

export interface SpreadsheetImportProgress {
  current: number;
  total: number;
  word: string;
  phase?: 'reading' | 'checking' | 'saving';
  summary?: SpreadsheetImportSummary;
  issues?: SpreadsheetImportIssue[];
  omittedIssues?: number;
}

export interface SpreadsheetImportSummary {
  total: number;
  created: number;
  reused: number;
  failed: number;
  skipped: number;
  pending?: number;
}

export interface SpreadsheetImportIssue {
  sourceRow: number;
  sourceColumn?: number;
  word?: string;
  kind: 'invalid' | 'duplicate' | 'generation' | 'save' | 'pending';
  message: string;
}

export type SpreadsheetImportFailureReason = 'size' | 'read' | 'parse' | 'empty' | 'save' | 'items';

type ImportResultEvidence = { issues?: SpreadsheetImportIssue[]; omittedIssues?: number };

export type SpreadsheetImportResult = ImportResultEvidence & (
  | { status: 'completed'; summary: SpreadsheetImportSummary; message: string }
  | { status: 'partial'; summary: SpreadsheetImportSummary; message: string }
  | {
    status: 'failed';
    reason: SpreadsheetImportFailureReason;
    summary: SpreadsheetImportSummary;
    message: string;
  });

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

export type SpreadsheetSaveOutcome = 'created' | 'reused' | 'failed' | 'pending';

export interface CardIntakePort {
  findExisting(words: readonly (string | Pick<CardData, 'word' | 'normalizedWord' | 'lexemeId' | 'language' | 'senseKey' | 'partOfSpeech' | 'normalizedLemma'>)[]): Promise<Map<string, CardData>>;
  persistStructured(plan: StructuredIntakePlan, onSettlement?: (index: number, outcome: SpreadsheetSaveOutcome) => void): Promise<{ createdCount: number; outcomes?: SpreadsheetSaveOutcome[] }>;
  touchExisting(card: CardData, touchedAt: string): Promise<void>;
  generate(word: string, generatedBefore: number): Promise<{ created: boolean; category?: string; settlement?: Promise<SpreadsheetSaveOutcome> }>;
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

export class SpreadsheetImportStaleError extends Error {
  constructor() { super('The spreadsheet import owner changed before this operation completed.'); }
}

interface SpreadsheetImportServiceOptions {
  cards: CardIntakePort;
  feedback: SpreadsheetImportFeedbackPort;
  diagnostics?: SpreadsheetImportDiagnosticsPort;
  maxFileBytes?: number;
  maxAiCards?: number;
  now?: () => string;
  delay?: (milliseconds: number) => Promise<void>;
  isActive?: () => boolean;
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
  if (summary.failed === 0 && summary.skipped === 0 && !summary.pending) return completedImportResult(summary);
  if (summary.pending) {
    return {
      status: 'partial', summary,
      message: `Import partly finished: ${formatCount(summary.created)} created, ${formatCount(summary.reused)} already present, ${formatCount(summary.failed)} failed, ${formatCount(summary.skipped)} skipped, and ${formatCount(summary.pending)} not confirmed. Review the pending rows before retrying.`,
    };
  }
  if (successful === 0) {
    const details = [
      summary.failed > 0 ? `${formatCount(summary.failed)} items failed` : null,
      summary.skipped > 0 ? `${formatCount(summary.skipped)} items were skipped` : null,
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
    message: `Import partly finished: ${formatCount(summary.created)} created, ${formatCount(summary.reused)} already present, ${formatCount(summary.failed)} failed, and ${formatCount(summary.skipped)} skipped. Retry the failed or skipped words later.`,
  };
};

export function createSpreadsheetImportService({
  cards,
  feedback,
  diagnostics = {},
  maxFileBytes = MAX_SPREADSHEET_FILE_BYTES,
  maxAiCards = DEFAULT_MAX_AI_CARDS,
  now = () => new Date().toISOString(),
  delay = milliseconds => new Promise<void>(resolve => globalThis.setTimeout(resolve, milliseconds)),
  isActive = () => true,
}: SpreadsheetImportServiceOptions) {
  const assertActive = () => {
    if (!isActive()) throw new SpreadsheetImportStaleError();
  };
  const awaitStage = async <T,>(stage: () => Promise<T>): Promise<T> => {
    assertActive();
    try {
      const result = await stage();
      assertActive();
      return result;
    } catch (error) {
      if (!isActive()) throw new SpreadsheetImportStaleError();
      throw error;
    }
  };

  const importSpreadsheet = async ({
    sizeBytes,
    loadWorkbook,
  }: SpreadsheetImportRequest): Promise<SpreadsheetImportResult> => {
    let summary = emptyImportSummary();
    let issues: SpreadsheetImportIssue[] = [];
    let omittedIssues = 0;
    let processed = 0;
    let nextCandidateId = 0;
    const unsettled = new Map<number, Pick<SpreadsheetImportIssue, 'sourceRow' | 'sourceColumn' | 'word'>>();
    const addIssue = (issue: SpreadsheetImportIssue) => {
      if (issues.length < 5_000) issues = [...issues, issue];
      else omittedIssues += 1;
    };
    const withEvidence = (result: SpreadsheetImportResult): SpreadsheetImportResult => ({
      ...result,
      ...(issues.length ? { issues: [...issues] } : {}),
      ...(omittedIssues ? { omittedIssues } : {}),
    });
    const publish = (word: string, phase: SpreadsheetImportProgress['phase']) => {
      assertActive();
      feedback.progress({
        current: processed,
        total: summary.total, word, phase,
        summary: { ...summary }, issues, omittedIssues,
      });
    };
    const track = (candidate: Pick<SpreadsheetImportIssue, 'sourceRow' | 'sourceColumn' | 'word'>) => {
      const id = nextCandidateId++;
      unsettled.set(id, candidate);
      return id;
    };
    const settle = (id: number, outcome: SpreadsheetSaveOutcome, failureKind: 'generation' | 'save' = 'save') => {
      if (!isActive()) return;
      const candidate = unsettled.get(id);
      if (!candidate) return;
      unsettled.delete(id);
      if (outcome !== 'pending') summary.pending = (summary.pending ?? 0) - 1;
      if (outcome === 'created') summary.created += 1;
      else if (outcome === 'reused') summary.reused += 1;
      else if (outcome === 'failed') {
        summary.failed += 1;
        addIssue({ ...candidate, kind: failureKind, message: failureKind === 'generation' ? 'The card could not be generated.' : 'The card could not be saved.' });
      } else addIssue({ ...candidate, kind: 'pending', message: 'The save was not confirmed.' });
      processed += 1;
      publish(candidate.word ?? '', 'saving');
    };
    let phase: 'load' | 'parse' | 'save' = 'load';
    assertActive();
    if (sizeBytes > maxFileBytes) {
      const message = `The spreadsheet is too large. Maximum file size is ${Math.floor(maxFileBytes / 1024 / 1024)} MB.`;
      assertActive();
      feedback.error(message);
      assertActive();
      feedback.resetSource();
      return { status: 'failed', reason: 'size', summary, message };
    }

    assertActive();
    feedback.start();
    assertActive();
    feedback.clearError();

    try {
      const workbook = await awaitStage(loadWorkbook);
      if (!workbook) {
        const message = 'Could not read this spreadsheet. Make sure it is a valid Excel or CSV file, then try again.';
        assertActive();
        feedback.error(message);
        return { status: 'failed', reason: 'read', summary, message };
      }

      phase = 'parse';
      const structuredMode = workbook.hasStructuredHeader ?? workbook.structuredRows.length > 0;
      if (structuredMode) {
        const sourceRows = workbook.structuredSourceRows
          ?? workbook.structuredRows.map((row, index) => ({ row, sourceRow: index + 2 }));
        const classified = classifyStructuredCardRows(sourceRows);
        summary = { ...summary, total: 0, pending: 0 };
        const accepted = [] as Extract<typeof classified[number], { kind: 'accepted' }>[];
        for (const item of classified) {
          summary.total += 1;
          if (item.kind === 'accepted') {
            summary.pending = (summary.pending ?? 0) + 1;
            accepted.push(item);
          } else {
            if (item.kind === 'invalid') summary.failed += 1;
            else summary.skipped += 1;
            processed += 1;
            addIssue({
              sourceRow: item.sourceRow, word: item.word, kind: item.kind,
              message: item.kind === 'invalid' ? 'A required field or identity is invalid.' : 'This row duplicates an earlier row.',
            });
          }
          publish(item.kind === 'accepted' ? item.row.word : item.word ?? '', 'checking');
        }
        if (classified.length === 0) {
          const message = 'No importable rows were found. Add a Word and Translation row, then try again.';
          feedback.error(message);
          return { status: 'failed', reason: 'empty', summary, message };
        }
        phase = 'save';
        if (accepted.length > 0) {
          const existingCards = await awaitStage(() => cards.findExisting(accepted.map(item => item.row.lexemeId ? item.row : item.row.word)));
          const plan: StructuredIntakePlan = { creates: [], patches: [] };
          const candidates: number[] = [];
          const patches: number[] = [];
          for (const item of accepted) {
            const row = item.row;
            const logicalKey = row.lexemeId ? `lexeme:${row.lexemeId}` : row.word;
            const existing = Array.from(existingCards.values()).find(card => cardLogicalKey(card) === logicalKey) ?? null;
            const mutation = planStructuredImportMutation(row, existing, now());
            const id = track({ sourceRow: item.sourceRow, word: row.word });
            if (mutation.kind === 'create') {
              plan.creates.push(mutation.card);
              candidates.push(id);
            } else {
              plan.patches.push({ card: mutation.card, fields: mutation.fields });
              patches.push(id);
            }
          }
          const all = [...candidates, ...patches];
          const persisted = await awaitStage(() => cards.persistStructured(plan, (index, outcome) => {
            const id = all[index];
            if (id !== undefined) settle(id, outcome);
          }));
          all.forEach((id, index) => {
            if (!unsettled.has(id)) return;
            const outcome = persisted.outcomes?.[index]
              ?? (index < Math.min(candidates.length, persisted.createdCount) ? 'created' : 'reused');
            settle(id, outcome);
          });
        }
        const result = withEvidence(itemImportResult(summary));
        if (result.status !== 'completed') feedback.error(result.message);
        return result;
      }

      const sourceCells = workbook.flatSourceCells ?? workbook.flatRows.flatMap((row, rowIndex) =>
        row.map((value, columnIndex) => ({ value, sourceRow: rowIndex + 1, sourceColumn: columnIndex + 1 })));
      const classified = classifyFlatWords(sourceCells);
      summary = { ...summary, total: 0, pending: 0 };
      const accepted: Array<Extract<FlatWordClassification, { kind: 'accepted' }>> = [];
      for (const item of classified) {
        summary.total += 1;
        if (item.kind === 'accepted') {
          summary.pending = (summary.pending ?? 0) + 1;
          accepted.push(item);
        } else {
          summary.skipped += 1;
          processed += 1;
          addIssue({
            sourceRow: item.sourceRow, sourceColumn: item.sourceColumn, word: item.word,
            kind: item.kind === 'duplicate' ? 'duplicate' : 'generation',
            message: item.kind === 'duplicate' ? 'This word appears earlier in the file.' : 'This word is beyond the 200-word processing limit.',
          });
        }
        publish(item.word, 'checking');
      }
      if (summary.total === 0) {
        const message = 'No importable words were found. Add a Word column or a simple list of words, then try again.';
        assertActive();
        feedback.error(message);
        return { status: 'failed', reason: 'empty', summary, message };
      }
      phase = 'save';
      const existingCards = await awaitStage(() => cards.findExisting(accepted.map(item => item.word)));
      const categoryDeltas: Record<string, number> = {};
      const settlements: Promise<void>[] = [];
      let generatedCount = 0;
      let aiSkipped = 0;

      for (let index = 0; index < accepted.length; index += 1) {
        const item = accepted[index];
        const word = item.word;
        assertActive();
        const id = track(item);
        const existing = existingCards.get(normalizeCardWord(word));
        if (existing) {
          try {
            await awaitStage(() => cards.touchExisting(existing, now()));
            settle(id, 'reused');
          } catch (error) {
            if (error instanceof SpreadsheetImportStaleError) throw error;
            settle(id, 'failed');
            assertActive();
            diagnostics.itemFailed?.(word, error);
            assertActive();
          }
          continue;
        }

        if (generatedCount >= maxAiCards) {
          summary.skipped += 1;
          aiSkipped += 1;
          summary.pending = (summary.pending ?? 0) - 1;
          processed += 1;
          unsettled.delete(id);
          addIssue({
            sourceRow: item.sourceRow, sourceColumn: item.sourceColumn, word,
            kind: 'generation', message: 'This word is beyond the AI generation limit.',
          });
          publish(word, 'checking');
          continue;
        }

        try {
          const result = await awaitStage(() => cards.generate(word, generatedCount));
          if (result.created) {
            generatedCount += 1;
          }
          if (result.settlement) {
            settlements.push(result.settlement.then(outcome => {
              settle(id, outcome);
              if (outcome === 'created') {
                const category = result.category || 'Other';
                categoryDeltas[category] = (categoryDeltas[category] || 0) + 1;
              }
            }));
          } else {
            settle(id, result.created ? 'created' : 'reused');
            if (result.created) {
              const category = result.category || 'Other';
              categoryDeltas[category] = (categoryDeltas[category] || 0) + 1;
            }
          }
        } catch (error) {
          if (error instanceof SpreadsheetImportStaleError) throw error;
          settle(id, 'failed', 'generation');
          assertActive();
          diagnostics.itemFailed?.(word, error);
          assertActive();
        }
        if (index < accepted.length - 1 && generatedCount < maxAiCards) {
          await awaitStage(() => delay(2500));
        }
      }

      await awaitStage(() => Promise.all(settlements));
      await awaitStage(() => cards.completeFlat({
        successCount: summary.created + summary.reused,
        generatedCount,
        skippedForAiLimit: aiSkipped,
        categoryDeltas,
      }));

      const result = withEvidence(itemImportResult(summary));
      if (result.status !== 'completed') {
        assertActive();
        feedback.error(result.message);
      }
      return result;
    } catch (error) {
      if (error instanceof SpreadsheetImportStaleError) throw error;
      assertActive();
      diagnostics.workbookFailed?.(error);
      if (error instanceof SpreadsheetUnsupportedFormatError) {
        const message = error.message;
        assertActive();
        feedback.error(message);
        return { status: 'failed', reason: 'read', summary, message };
      }
      if (error instanceof SpreadsheetReadError) {
        const message = 'Could not read this spreadsheet. Make sure it is a valid Excel or CSV file, then try again.';
        assertActive();
        feedback.error(message);
        return { status: 'failed', reason: 'read', summary, message };
      }
      if (phase !== 'save') {
        const message = 'Could not understand this spreadsheet. Check its columns and file format, then try again.';
        assertActive();
        feedback.error(message);
        return { status: 'failed', reason: 'parse', summary, message };
      }

      for (const id of [...unsettled.keys()]) settle(id, 'failed');
      const message = 'Could not save the imported cards. Check your sign-in and connection, then try the same file again.';
      assertActive();
      feedback.error(message);
      if (summary.created + summary.reused + (summary.pending ?? 0) > 0) {
        return withEvidence({ status: 'partial', summary, message });
      }
      return withEvidence({ status: 'failed', reason: 'save', summary, message });
    } finally {
      if (isActive()) {
        feedback.progress(null);
        if (isActive()) feedback.finish();
        if (isActive()) feedback.resetSource();
      }
    }
  };

  return { import: importSpreadsheet };
}

export const indexCardsByNormalizedWord = (cards: readonly CardData[]) =>
  new Map(cards.map(card => [cardWordKey(card), card]));

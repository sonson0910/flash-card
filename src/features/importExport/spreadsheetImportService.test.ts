import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
  createSpreadsheetImportService,
  type CardIntakePort,
  type SpreadsheetImportFeedbackPort,
} from './spreadsheetImportService';

const existingCard = (word: string): CardData => ({
  id: `word-${word}`,
  word,
  normalizedWord: word,
  translation: '',
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
});

const createFakePorts = () => {
  const events: string[] = [];
  const feedback: SpreadsheetImportFeedbackPort = {
    start: () => events.push('start'),
    clearError: () => events.push('clear-error'),
    progress: value => events.push(value ? `progress:${value.word}` : 'progress:clear'),
    error: message => events.push(`error:${message}`),
    finish: () => events.push('finish'),
    resetSource: () => events.push('reset-source'),
  };
  const cards: CardIntakePort = {
    findExisting: async words => {
      events.push(`find:${words.join(',')}`);
      return new Map();
    },
    persistStructured: async plan => {
      events.push(`persist:${plan.creates.map(card => card.word).join(',')}`);
      return { createdCount: plan.creates.length };
    },
    touchExisting: async card => { events.push(`touch:${card.word}`); },
    generate: async word => {
      events.push(`generate:${word}`);
      return { created: true, category: 'Imported' };
    },
    completeFlat: async summary => { events.push(`complete:${summary.generatedCount}`); },
  };
  return { events, feedback, cards };
};

describe('spreadsheet import service', () => {
  it('keeps the core contract independent from React and Firebase vendor types', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./spreadsheetImportService.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/from\s+['"]react['"]/);
    expect(source).not.toMatch(/from\s+['"]firebase(?:\/|['"])/);
    expect(source).not.toMatch(/User|QueryDocumentSnapshot|Dispatch|SetStateAction/);
  });

  it('rejects oversized files before reading and still resets the source', async () => {
    const { events, feedback, cards } = createFakePorts();
    const loadWorkbook = vi.fn();
    const importer = createSpreadsheetImportService({ cards, feedback });

    await importer.import({ sizeBytes: 10 * 1024 * 1024 + 1, loadWorkbook });

    expect(loadWorkbook).not.toHaveBeenCalled();
    expect(events).toEqual([
      'error:The spreadsheet is too large. Maximum file size is 10 MB.',
      'reset-source',
    ]);
  });

  it('bounds and deduplicates structured rows before persistence', async () => {
    const { events, feedback, cards } = createFakePorts();
    const importer = createSpreadsheetImportService({ cards, feedback, now: () => '2026-08-03T00:00:00.000Z' });
    const rows = Array.from({ length: 5_001 }, (_, index) => ({
      Word: `word-${index}`,
      Translation: `nghĩa-${index}`,
    }));
    rows[1] = { Word: ' WORD-0 ', Translation: 'nghĩa trùng' };

    const result = await importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => ({ structuredRows: rows, flatRows: [] }),
    });

    const findEvent = events.find(event => event.startsWith('find:')) ?? '';
    expect(findEvent.split(',')).toHaveLength(4_999);
    expect(findEvent).toContain('word-0');
    expect(result).toEqual({
      status: 'completed',
      summary: { total: 4_999, created: 4_999, reused: 0, failed: 0, skipped: 0 },
      message: 'Import complete: 4,999 created, 0 already in your library.',
    });
    expect(events.at(-3)).toBe('progress:clear');
    expect(events.slice(-2)).toEqual(['finish', 'reset-source']);
  });

  it('keeps source order, deduplicates flat words and touches existing cards before generation', async () => {
    const { events, feedback, cards } = createFakePorts();
    cards.findExisting = async words => {
      events.push(`find:${words.join(',')}`);
      return new Map([['apple', existingCard('apple')]]);
    };
    const importer = createSpreadsheetImportService({
      cards,
      feedback,
      delay: async () => { events.push('delay'); },
    });

    const result = await importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => ({
        structuredRows: [],
        flatRows: [[' Apple ', 'banana', 'BANANA', 'cherry']],
      }),
    });

    expect(events).toEqual([
      'start', 'clear-error', 'find:Apple,banana,cherry',
      'progress:Apple', 'touch:apple',
      'progress:banana', 'generate:banana', 'delay',
      'progress:cherry', 'generate:cherry',
      'complete:2', 'progress:clear', 'finish', 'reset-source',
    ]);
    expect(result).toEqual({
      status: 'completed',
      summary: { total: 3, created: 2, reused: 1, failed: 0, skipped: 0 },
      message: 'Import complete: 2 created, 1 already in your library.',
    });
  });

  it('caps flat generation, reports leftovers, and always cleans up after a port failure', async () => {
    const { events, feedback, cards } = createFakePorts();
    cards.generate = async word => {
      events.push(`generate:${word}`);
      if (word === 'broken') throw new Error('generation failed');
      return { created: true, category: 'Imported' };
    };
    const importer = createSpreadsheetImportService({
      cards,
      feedback,
      maxAiCards: 2,
      delay: async () => undefined,
    });

    const result = await importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => ({ structuredRows: [], flatRows: [['one', 'broken', 'two', 'three']] }),
    });

    expect(events).toContain('generate:one');
    expect(events).toContain('generate:broken');
    expect(events).toContain('generate:two');
    expect(events).not.toContain('generate:three');
    expect(events).toContain('error:Import partly finished: 2 created, 0 already present, 1 failed, and 1 skipped by the AI safety limit. Retry the failed or skipped words later.');
    expect(events.slice(-3)).toEqual(['progress:clear', 'finish', 'reset-source']);
    expect(result).toEqual({
      status: 'partial',
      summary: { total: 4, created: 2, reused: 0, failed: 1, skipped: 1 },
      message: 'Import partly finished: 2 created, 0 already present, 1 failed, and 1 skipped by the AI safety limit. Retry the failed or skipped words later.',
    });
  });

  it('returns a retryable failure instead of silently completing a null workbook', async () => {
    const { events, feedback, cards } = createFakePorts();
    const importer = createSpreadsheetImportService({ cards, feedback });

    const result = await importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => null,
    });

    expect(result).toEqual({
      status: 'failed',
      reason: 'read',
      summary: { total: 0, created: 0, reused: 0, failed: 0, skipped: 0 },
      message: 'Could not read this spreadsheet. Make sure it is a valid Excel or CSV file, then try again.',
    });
    expect(events).toContain(`error:${result.message}`);
    expect(events.slice(-3)).toEqual(['progress:clear', 'finish', 'reset-source']);
  });

  it('labels structured persistence failures as save failures, not parse failures', async () => {
    const { events, feedback, cards } = createFakePorts();
    cards.persistStructured = async () => { throw new Error('permission denied'); };
    const importer = createSpreadsheetImportService({ cards, feedback });

    const result = await importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => ({
        structuredRows: [{ Word: 'apple', Translation: 'táo' }],
        flatRows: [],
      }),
    });

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'save',
      summary: { total: 1, created: 0, reused: 0, failed: 1, skipped: 0 },
    });
    expect(events).toContain('error:Could not save the imported cards. Check your sign-in and connection, then try the same file again.');
    expect(events).not.toContain('error:Failed to parse Excel file.');
  });

  it('reports an all-item failure as failed rather than completed', async () => {
    const { events, feedback, cards } = createFakePorts();
    cards.generate = async word => {
      events.push(`generate:${word}`);
      throw new Error('offline');
    };
    const importer = createSpreadsheetImportService({
      cards,
      feedback,
      delay: async () => undefined,
    });

    const result = await importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => ({ structuredRows: [], flatRows: [['one', 'two']] }),
    });

    expect(result).toEqual({
      status: 'failed',
      reason: 'items',
      summary: { total: 2, created: 0, reused: 0, failed: 2, skipped: 0 },
      message: 'No cards were imported: 2 items failed. Check your sign-in and connection, then try again.',
    });
    expect(events).toContain(`error:${result.message}`);
  });

  it('reports workbook failures and runs cleanup in deterministic order', async () => {
    const { events, feedback, cards } = createFakePorts();
    const importer = createSpreadsheetImportService({ cards, feedback });

    const result = await importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => { throw new Error('parse failed'); },
    });

    expect(result).toMatchObject({ status: 'failed', reason: 'parse' });
    expect(events).toEqual([
      'start',
      'clear-error',
      'error:Could not understand this spreadsheet. Check its columns and file format, then try again.',
      'progress:clear',
      'finish',
      'reset-source',
    ]);
  });
});

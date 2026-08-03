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
    const rows = Array.from({ length: 5_001 }, (_, index) => ({ Word: `word-${index}` }));
    rows[1] = { Word: ' WORD-0 ' };

    await importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => ({ structuredRows: rows, flatRows: [] }),
    });

    const findEvent = events.find(event => event.startsWith('find:')) ?? '';
    expect(findEvent.split(',')).toHaveLength(4_999);
    expect(findEvent).toContain('word-0');
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

    await importer.import({
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

    await importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => ({ structuredRows: [], flatRows: [['one', 'broken', 'two', 'three']] }),
    });

    expect(events).toContain('generate:one');
    expect(events).toContain('generate:broken');
    expect(events).toContain('generate:two');
    expect(events).not.toContain('generate:three');
    expect(events).toContain('error:Created the safe limit of 2 AI cards in one import; 1 words were left for a later batch.');
    expect(events.slice(-3)).toEqual(['progress:clear', 'finish', 'reset-source']);
  });

  it('reports workbook failures and runs cleanup in deterministic order', async () => {
    const { events, feedback, cards } = createFakePorts();
    const importer = createSpreadsheetImportService({ cards, feedback });

    await importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => { throw new Error('parse failed'); },
    });

    expect(events).toEqual([
      'start',
      'clear-error',
      'error:Failed to parse Excel file.',
      'progress:clear',
      'finish',
      'reset-source',
    ]);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { createLexemeId } from '../multilingual/lexemeIdentity';
import {
  createSpreadsheetImportService,
  SpreadsheetImportStaleError,
  SpreadsheetUnsupportedFormatError,
  type CardIntakePort,
  type SpreadsheetImportFeedbackPort,
  type StructuredIntakePlan,
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

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
      events.push(`find:${words.map(word => typeof word === 'string' ? word : word.word).join(',')}`);
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
  it('plans same-word canonical senses independently when two are already present', async () => {
    const { feedback, cards } = createFakePorts();
    const senses = ['metal', 'guide', 'clue', 'position'].map(senseKey => ({
      senseKey,
      lexemeId: createLexemeId({ language: 'en', normalizedLemma: 'lead', partOfSpeech: 'noun', senseKey }),
    }));
    const existing = senses.slice(0, 2).map(({ lexemeId, senseKey }) => ({
      ...existingCard('lead'), id: lexemeId, lexemeId, language: 'en', senseKey, partOfSpeech: 'noun', normalizedLemma: 'lead',
    }));
    cards.findExisting = async () => new Map(existing.map(card => [`lexeme:${card.lexemeId}`, card]));
    const persist = vi.fn(async (plan: StructuredIntakePlan) => ({ createdCount: plan.creates.length }));
    cards.persistStructured = persist;
    const importer = createSpreadsheetImportService({ cards, feedback });
    const result = await importer.import({ sizeBytes: 1, loadWorkbook: async () => ({
      structuredRows: senses.map(({ lexemeId, senseKey }) => ({ Word: 'lead', Translation: senseKey, Language: 'en', 'Part of Speech': 'noun', 'Sense Key': senseKey, 'Lexeme ID': lexemeId })),
      flatRows: [],
    }) });
    expect(result.summary).toMatchObject({ created: 2, reused: 2 });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ creates: expect.any(Array), patches: expect.any(Array) }), expect.any(Function));
    expect(persist.mock.calls[0][0].creates).toHaveLength(2);
    expect(persist.mock.calls[0][0].patches).toHaveLength(2);
  });

  it('keeps ordinary same-spelling cards separate by target language', async () => {
    const { feedback, cards } = createFakePorts();
    const persist = vi.fn(async (plan: StructuredIntakePlan) => ({ createdCount: plan.creates.length }));
    cards.persistStructured = persist;
    const importer = createSpreadsheetImportService({ cards, feedback });

    const result = await importer.import({ sizeBytes: 1, loadWorkbook: async () => ({
      structuredRows: [
        { Word: 'bank', Translation: 'ngân hàng', Language: 'ko', 'Translation Language': 'vi' },
        { Word: 'bank', Translation: 'ngân hàng', Language: 'ja', 'Translation Language': 'vi' },
      ],
      flatRows: [],
    }) });

    expect(result.summary).toMatchObject({ created: 2, reused: 0 });
    expect(persist.mock.calls[0][0].creates).toMatchObject([
      { language: 'ko', translationLanguage: 'vi' },
      { language: 'ja', translationLanguage: 'vi' },
    ]);
    expect(persist.mock.calls[0][0].creates.map(card => card.id)).not.toEqual([
      persist.mock.calls[0][0].creates[0].id,
      persist.mock.calls[0][0].creates[0].id,
    ]);
  });

  it('does not patch a same-spelling card from another target language', async () => {
    const { feedback, cards } = createFakePorts();
    const japanese = { ...existingCard('bank'), id: 'word-ja-bank', language: 'ja', translationLanguage: 'vi' };
    const persist = vi.fn(async plan => ({ createdCount: plan.creates.length }));
    cards.findExisting = vi.fn(async () => new Map([['target:ja:bank', japanese]]));
    cards.persistStructured = persist;
    const importer = createSpreadsheetImportService({ cards, feedback });

    const result = await importer.import({ sizeBytes: 1, loadWorkbook: async () => ({
      structuredRows: [{ Word: 'bank', Translation: 'ngân hàng', Language: 'ko', 'Translation Language': 'vi' }],
      flatRows: [],
    }) });

    expect(result.summary).toMatchObject({ created: 1, reused: 0 });
    expect(persist.mock.calls[0][0]).toMatchObject({ creates: [{ language: 'ko' }], patches: [] });
  });

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
      status: 'partial',
      summary: { total: 5_000, created: 4_999, reused: 0, failed: 0, skipped: 1, pending: 0 },
      message: 'Import partly finished: 4,999 created, 0 already present, 0 failed, and 1 skipped. Retry the failed or skipped words later.',
      issues: [{ kind: 'duplicate', sourceRow: 3, word: 'word-0', message: 'This row duplicates an earlier row.' }],
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
      'start', 'clear-error', 'progress:Apple', 'progress:banana', 'progress:BANANA', 'progress:cherry',
      'find:Apple,banana,cherry',
      'touch:apple', 'progress:Apple',
      'generate:banana', 'progress:banana', 'delay',
      'generate:cherry', 'progress:cherry',
      'complete:2',
      'error:Import partly finished: 2 created, 1 already present, 0 failed, and 1 skipped. Retry the failed or skipped words later.',
      'progress:clear', 'finish', 'reset-source',
    ]);
    expect(result).toEqual({
      status: 'partial',
      summary: { total: 4, created: 2, reused: 1, failed: 0, skipped: 1, pending: 0 },
      message: 'Import partly finished: 2 created, 1 already present, 0 failed, and 1 skipped. Retry the failed or skipped words later.',
      issues: [{ sourceRow: 1, sourceColumn: 3, word: 'BANANA', kind: 'duplicate', message: 'This word appears earlier in the file.' }],
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
    expect(events).toContain('error:Import partly finished: 2 created, 0 already present, 1 failed, and 1 skipped. Retry the failed or skipped words later.');
    expect(events.slice(-3)).toEqual(['progress:clear', 'finish', 'reset-source']);
    expect(result).toEqual({
      status: 'partial',
      summary: { total: 4, created: 2, reused: 0, failed: 1, skipped: 1, pending: 0 },
      message: 'Import partly finished: 2 created, 0 already present, 1 failed, and 1 skipped. Retry the failed or skipped words later.',
      issues: [
        { sourceRow: 1, sourceColumn: 2, word: 'broken', kind: 'generation', message: 'The card could not be generated.' },
        { sourceRow: 1, sourceColumn: 4, word: 'three', kind: 'generation', message: 'This word is beyond the AI generation limit.' },
      ],
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

  it('reports a partially settled structured patch batch without hiding successful creates', async () => {
    const { feedback, cards } = createFakePorts();
    cards.persistStructured = async () => ({ createdCount: 1, patchedCount: 1, failedPatchCount: 1 });
    cards.findExisting = async () => new Map([['apple', existingCard('apple')], ['banana', existingCard('banana')]]);
    const importer = createSpreadsheetImportService({ cards, feedback });

    const result = await importer.import({ sizeBytes: 1, loadWorkbook: async () => ({
      structuredRows: [
        { Word: 'new', Translation: 'mới' },
        { Word: 'apple', Translation: 'táo' },
        { Word: 'banana', Translation: 'chuối' },
      ], flatRows: [],
    }) });

    expect(result).toMatchObject({ status: 'partial', summary: { created: 1, reused: 1, failed: 1 } });
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
      summary: { total: 2, created: 0, reused: 0, failed: 2, skipped: 0, pending: 0 },
      message: 'No cards were imported: 2 items failed. Check your sign-in and connection, then try again.',
      issues: [
        { sourceRow: 1, sourceColumn: 1, word: 'one', kind: 'generation', message: 'The card could not be generated.' },
        { sourceRow: 1, sourceColumn: 2, word: 'two', kind: 'generation', message: 'The card could not be generated.' },
      ],
    });
    expect(events).toContain(`error:${result.message}`);
  });

  it('keeps structured rows in structured mode when every row is invalid', async () => {
    const { feedback, cards } = createFakePorts();
    const findExisting = vi.spyOn(cards, 'findExisting');
    const importer = createSpreadsheetImportService({ cards, feedback });

    const result = await importer.import({
      sizeBytes: 100,
      loadWorkbook: async () => ({
        hasStructuredHeader: true,
        structuredRows: [{ Word: '', Translation: 'táo' }, { Word: 'pear', Translation: '' }],
        structuredSourceRows: [
          { row: { Word: '', Translation: 'táo' }, sourceRow: 4 },
          { row: { Word: 'pear', Translation: '' }, sourceRow: 6 },
        ],
        flatRows: [['Word', 'Translation'], ['pear', '']],
      }),
    });

    expect(findExisting).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'failed', reason: 'items',
      summary: { total: 2, created: 0, reused: 0, failed: 2, skipped: 0, pending: 0 },
      message: 'No cards were imported: 2 items failed. Check your sign-in and connection, then try again.',
      issues: [
        { sourceRow: 4, kind: 'invalid', message: 'A required field or identity is invalid.' },
        { sourceRow: 6, word: 'pear', kind: 'invalid', message: 'A required field or identity is invalid.' },
      ],
    });
  });

  it('leaves an unconfirmed save pending and never counts it as created', async () => {
    const { feedback, cards } = createFakePorts();
    const cloud = deferred<'pending'>();
    const generate = vi.fn(async () => ({ created: true, category: 'Imported', settlement: cloud.promise }));
    cards.generate = generate;
    const snapshots: Array<{ current: number; created: number; pending?: number }> = [];
    feedback.progress = value => {
      if (value?.summary) snapshots.push({ current: value.current, created: value.summary.created, pending: value.summary.pending });
    };
    const importer = createSpreadsheetImportService({ cards, feedback });
    const importing = importer.import({
      sizeBytes: 100,
      loadWorkbook: async () => ({
        structuredRows: [], flatRows: [['apple']],
        flatSourceCells: [{ value: 'apple', sourceRow: 7, sourceColumn: 3 }],
      }),
    });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    expect(snapshots.at(-1)).toEqual({ current: 0, created: 0, pending: 1 });
    cloud.resolve('pending');
    const result = await importing;

    expect(result).toEqual({
      status: 'partial',
      summary: { total: 1, created: 0, reused: 0, failed: 0, skipped: 0, pending: 1 },
      message: 'Import partly finished: 0 created, 0 already present, 0 failed, 0 skipped, and 1 not confirmed. Review the pending rows before retrying.',
      issues: [{ sourceRow: 7, sourceColumn: 3, word: 'apple', kind: 'pending', message: 'The save was not confirmed.' }],
    });
    expect(snapshots.at(-1)).toEqual({ current: 1, created: 0, pending: 1 });
  });

  it('keeps earlier progress issues immutable as later candidates are classified', async () => {
    const { feedback, cards } = createFakePorts();
    const snapshots: Array<NonNullable<Parameters<SpreadsheetImportFeedbackPort['progress']>[0]>> = [];
    feedback.progress = value => { if (value) snapshots.push(value); };
    const importer = createSpreadsheetImportService({ cards, feedback, delay: async () => undefined });

    await importer.import({
      sizeBytes: 100,
      loadWorkbook: async () => ({ structuredRows: [], flatRows: [['apple', 'apple']] }),
    });

    const checking = snapshots.filter(snapshot => snapshot.phase === 'checking');
    expect(checking[0].issues).toEqual([]);
    expect(checking[1].issues).toHaveLength(1);
  });

  it('caps evidence while classifying a large flat sheet', async () => {
    const { feedback, cards } = createFakePorts();
    const importer = createSpreadsheetImportService({ cards, feedback, maxAiCards: 0 });
    const cells = Array.from({ length: 5_002 }, (_, index) => ({
      value: `word-${index}`, sourceRow: index + 1, sourceColumn: 1,
    }));

    const result = await importer.import({
      sizeBytes: 100,
      loadWorkbook: async () => ({ structuredRows: [], flatRows: [], flatSourceCells: cells }),
    });

    expect(result.summary).toEqual({ total: 5_002, created: 0, reused: 0, failed: 0, skipped: 5_002, pending: 0 });
    expect(result.issues).toHaveLength(5_000);
    expect(result.omittedIssues).toBe(2);
  });

  it('surfaces the specific .xls re-save message instead of the generic read failure', async () => {
    const { events, feedback, cards } = createFakePorts();
    const importer = createSpreadsheetImportService({ cards, feedback });
    const specificMessage = "Legacy .xls files aren't supported. Re-save the file as .xlsx or .csv, then try again.";

    const result = await importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => { throw new SpreadsheetUnsupportedFormatError(specificMessage); },
    });

    expect(result).toMatchObject({ status: 'failed', reason: 'read', message: specificMessage });
    expect(events).toContain(`error:${specificMessage}`);
    expect(events).not.toContain('error:Could not read this spreadsheet. Make sure it is a valid Excel or CSV file, then try again.');
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

  it('stops all side effects when its lifecycle becomes inactive after an await', async () => {
    const { events, feedback, cards } = createFakePorts();
    let active = true;
    const existing = deferred<Map<string, CardData>>();
    cards.findExisting = async () => {
      events.push('find:apple');
      const result = await existing.promise;
      active = false;
      return result;
    };
    const importer = createSpreadsheetImportService({
      cards,
      feedback,
      isActive: () => active,
    });

    const pending = importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => ({ structuredRows: [], flatRows: [['apple']] }),
    });
    existing.resolve(new Map());

    await expect(pending).rejects.toBeInstanceOf(SpreadsheetImportStaleError);
    expect(events).toEqual(['start', 'clear-error', 'progress:apple', 'find:apple']);
    expect(events).not.toContain('generate:apple');
    expect(events).not.toContain('complete:1');
  });

  it('does not convert a stale final stage into a save failure', async () => {
    const { events, feedback, cards } = createFakePorts();
    let active = true;
    cards.completeFlat = async summary => {
      events.push(`complete:${summary.generatedCount}`);
      active = false;
    };
    const importer = createSpreadsheetImportService({
      cards,
      feedback,
      isActive: () => active,
      delay: async () => undefined,
    });

    const pending = importer.import({
      sizeBytes: 1024,
      loadWorkbook: async () => ({ structuredRows: [], flatRows: [['apple']] }),
    });

    await expect(pending).rejects.toBeInstanceOf(SpreadsheetImportStaleError);
    expect(events).toEqual([
      'start', 'clear-error', 'progress:apple', 'find:apple', 'generate:apple', 'progress:apple', 'complete:1',
    ]);
    expect(events.some(event => event.startsWith('error:'))).toBe(false);
    expect(events).not.toContain('reset-source');
  });
});

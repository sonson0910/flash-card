import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import {
  createCardIntakeController,
  type CardIntakeControllerPort,
  type CardIntakeDraftPort,
} from './cardIntakeController';

const card = (word: string, createdAt = '2026-01-01T00:00:00.000Z'): CardData => ({
  id: `word-${word}`,
  word,
  normalizedWord: word,
  translation: `${word}-vi`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  createdAt,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createFakePort = () => {
  const persistCards = vi.fn(async (cards: readonly CardData[]) =>
    cards.map(value => ({ card: value, created: true })));
  const port: CardIntakeControllerPort = {
    findExisting: vi.fn(async () => new Map()),
    persistStructured: vi.fn(async plan => ({ createdCount: plan.creates.length })),
    touchExisting: vi.fn(async () => undefined),
    generate: vi.fn(async () => ({ created: true, category: 'Imported' })),
    completeFlat: vi.fn(async () => undefined),
    generateCard: vi.fn(async word => ({
      card: card(word),
      mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
    })),
    persistCards,
    applyMedia: vi.fn(async () => undefined),
  };
  return { port, persistCards };
};

describe('card intake controller', () => {
  it('keeps its public contract independent from React and Firebase vendor types', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./cardIntakeController.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/from\s+['"]react['"]/);
    expect(source).not.toMatch(/from\s+['"]firebase(?:\/|['"])/);
    expect(source).not.toMatch(/\bUser\b|QueryDocumentSnapshot|Dispatch|SetStateAction/);
  });

  it('validates the draft before lookup and uses the active language profile for identity', async () => {
    const { port } = createFakePort();
    const intake = createCardIntakeController({ port, language: ENGLISH_TO_VIETNAMESE_PROFILE });

    intake.setDraft('   ');
    await expect(intake.generateDraft()).resolves.toMatchObject({ status: 'invalid', reason: 'empty' });
    intake.setDraft('x'.repeat(81));
    await expect(intake.generateDraft()).resolves.toMatchObject({ status: 'invalid', reason: 'too-long' });
    expect(port.findExisting).not.toHaveBeenCalled();

    intake.setDraft('  ＡＰＰＬＥ   Pie  ');
    await intake.generateDraft();
    expect(port.findExisting).toHaveBeenLastCalledWith(['apple pie']);
    expect(port.generateCard).toHaveBeenCalledWith('apple pie', ENGLISH_TO_VIETNAMESE_PROFILE);
  });

  it('holds a synchronous single-flight lock across concurrent generation submissions', async () => {
    const { port } = createFakePort();
    const generation = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    vi.mocked(port.generateCard).mockReturnValue(generation.promise);
    const intake = createCardIntakeController({ port });
    intake.setDraft('apple');

    const first = intake.generateDraft();
    const second = intake.generateDraft();

    await expect(second).resolves.toEqual({ status: 'busy' });
    expect(port.generateCard).toHaveBeenCalledTimes(1);
    generation.resolve({
      card: card('apple'),
      mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
    });
    await first;
    expect(intake.getSnapshot().isSubmitting).toBe(false);
  });

  it('reveals a duplicate without regenerating or rewriting its original createdAt', async () => {
    const { port, persistCards } = createFakePort();
    const existing = card('apple', '2025-03-04T00:00:00.000Z');
    const draft: CardIntakeDraftPort = {
      read: vi.fn(() => 'APPLE'),
      write: vi.fn(),
      clear: vi.fn(),
    };
    vi.mocked(port.findExisting).mockResolvedValue(new Map([['apple', existing]]));
    const intake = createCardIntakeController({
      port,
      draft,
      now: () => '2026-08-03T00:00:00.000Z',
    });

    const result = await intake.generateDraft();

    expect(result).toEqual({ status: 'existing', card: existing });
    expect(port.touchExisting).toHaveBeenCalledWith(existing, '2026-08-03T00:00:00.000Z');
    expect(port.generateCard).not.toHaveBeenCalled();
    expect(persistCards).not.toHaveBeenCalled();
    expect(existing.createdAt).toBe('2025-03-04T00:00:00.000Z');
    expect(intake.getSnapshot().draft).toBe('');
    expect(draft.clear).toHaveBeenCalledOnce();
  });

  it('deduplicates shared cards, excludes known words, and assigns createdAt only to new cards', async () => {
    const { port, persistCards } = createFakePort();
    const existing = card('apple', '2024-02-02T00:00:00.000Z');
    vi.mocked(port.findExisting).mockResolvedValue(new Map([['apple', existing]]));
    const intake = createCardIntakeController({
      port,
      now: () => '2026-08-03T12:00:00.000Z',
    });

    const result = await intake.adoptSharedDeck({
      cards: [
        { word: ' APPLE ', translation: 'táo', createdAt: '2030-01-01T00:00:00.000Z' },
        { word: 'ＡＰＰＬＥ', translation: 'quả táo' },
        {
          word: 'Banana',
          translation: 'chuối',
          category: 'Shared',
          cefrLevel: 'B1',
          exampleSentence: 'Bananas grow in warm climates.',
          exampleTranslation: 'Chuối phát triển ở khí hậu ấm.',
          collocations: ['ripe banana', 'banana peel'],
        },
        { word: '', translation: 'invalid' },
      ],
    });

    expect(port.findExisting).toHaveBeenCalledWith(['apple', 'banana']);
    expect(persistCards).toHaveBeenCalledTimes(1);
    const persisted = persistCards.mock.calls[0][0];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      word: 'banana',
      normalizedWord: 'banana',
      translation: 'chuối',
      createdAt: '2026-08-03T12:00:00.000Z',
      cefrLevel: 'B1',
      exampleSentence: 'Bananas grow in warm climates.',
      exampleTranslation: 'Chuối phát triển ở khí hậu ấm.',
      collocations: ['ripe banana', 'banana peel'],
    });
    expect(result).toMatchObject({ status: 'completed', candidateCount: 2, createdCount: 1, reusedCount: 1 });
    expect(existing.createdAt).toBe('2024-02-02T00:00:00.000Z');
  });

  it('ignores a late media result after the card lifecycle is invalidated', async () => {
    const { port } = createFakePort();
    const media = deferred<{ audioUrl: string | null; imageUrl: string | null }>();
    vi.mocked(port.generateCard).mockResolvedValue({ card: card('apple'), mediaPromise: media.promise });
    const intake = createCardIntakeController({ port });
    intake.setDraft('apple');

    const result = await intake.generateDraft();
    expect(result.status).toBe('created');
    intake.invalidateCard('word-apple');
    media.resolve({ audioUrl: 'https://media.example/apple.mp3', imageUrl: null });
    if (result.status === 'created') await result.mediaTask;

    expect(port.applyMedia).not.toHaveBeenCalled();
  });

  it('keeps the draft and releases loading state after generation failure', async () => {
    const { port } = createFakePort();
    vi.mocked(port.generateCard).mockRejectedValue(new Error('AI unavailable'));
    const intake = createCardIntakeController({ port });
    intake.setDraft('apple');

    const result = await intake.generateDraft();

    expect(result).toMatchObject({ status: 'failed', error: expect.any(Error) });
    expect(intake.getSnapshot()).toMatchObject({ draft: 'apple', isSubmitting: false, error: 'Failed to generate the flashcard. Your word is still here, so you can try again.' });
  });

  it('delegates spreadsheet parsing and always clears progress/loading/source on failure', async () => {
    const { port } = createFakePort();
    const resetSource = vi.fn();
    const intake = createCardIntakeController({ port, resetImportSource: resetSource });

    const result = await intake.importSpreadsheet({
      sizeBytes: 100,
      loadWorkbook: async () => { throw new Error('broken workbook'); },
    });

    expect(result).toEqual({ status: 'completed' });
    expect(intake.getSnapshot()).toMatchObject({ isImporting: false, importProgress: null });
    expect(resetSource).toHaveBeenCalledOnce();
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { classifyProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import {
  createCardIntakeController,
  settleMediaBestEffort,
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

  it('settles both media-fetch and media-persistence failures as best effort', async () => {
    const reportFailure = vi.fn();
    const applyMedia = vi.fn(async () => undefined);
    const fetchFailure = new Error('media fetch unavailable');

    await expect(settleMediaBestEffort(
      Promise.reject(fetchFailure),
      applyMedia,
      reportFailure,
    )).resolves.toBeUndefined();
    expect(applyMedia).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenLastCalledWith(fetchFailure);

    const persistFailure = new Error('media patch unavailable');
    vi.mocked(applyMedia).mockRejectedValueOnce(persistFailure);
    await expect(settleMediaBestEffort(
      Promise.resolve({ audioUrl: null, imageUrl: null }),
      applyMedia,
      reportFailure,
    )).resolves.toBeUndefined();
    expect(reportFailure).toHaveBeenLastCalledWith(persistFailure);
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

  it('preserves bounded rich learning fields when adopting a shared card', async () => {
    const { port, persistCards } = createFakePort();
    const intake = createCardIntakeController({ port });

    await intake.adoptSharedDeck({
      cards: [{
        word: ' nuanced ',
        translation: ' tinh tế ',
        explanationTranslation: ` ${'e'.repeat(2_100)} `,
        cefrLevel: ' C2 ',
        exampleSentence: ' A nuanced example. ',
        exampleTranslation: ' Một ví dụ tinh tế. ',
        collocations: [' nuanced view ', 42, '', 'nuanced answer', 'nuanced approach', 'nuanced debate', 'ignored fifth'],
        synonyms: [' subtle ', null, 'sophisticated', 'refined', 'delicate', 'ignored fifth'],
        antonyms: [' obvious ', false, '', 'blunt'],
        register: ` ${'r'.repeat(80)} `,
        commonMistake: ` ${'m'.repeat(2_100)} `,
        imageSearchQuery: ` ${'q'.repeat(140)} `,
      }],
    });

    const persisted = persistCards.mock.calls[0][0][0];
    expect(persisted).toMatchObject({
      word: 'nuanced',
      translation: 'tinh tế',
      cefrLevel: 'C2',
      exampleSentence: 'A nuanced example.',
      exampleTranslation: 'Một ví dụ tinh tế.',
      collocations: ['nuanced view', 'nuanced answer', 'nuanced approach', 'nuanced debate'],
      synonyms: ['subtle', 'sophisticated', 'refined', 'delicate'],
      antonyms: ['obvious', 'blunt'],
    });
    expect(persisted.explanationTranslation).toBe('e'.repeat(2_048));
    expect(persisted.register).toBe('r'.repeat(64));
    expect(persisted.commonMistake).toBe('m'.repeat(2_048));
    expect(persisted.imageSearchQuery).toBe('q'.repeat(120));
  });

  it('rejects shared cards whose translation is empty after trimming', async () => {
    const { port, persistCards } = createFakePort();
    const intake = createCardIntakeController({ port });

    const result = await intake.adoptSharedDeck({
      cards: [
        { word: 'empty', translation: '' },
        { word: 'spaces', translation: '   \t ' },
        { word: 'valid', translation: ' hợp lệ ' },
      ],
    });

    expect(port.findExisting).toHaveBeenCalledWith(['valid']);
    expect(persistCards).toHaveBeenCalledWith([
      expect.objectContaining({ word: 'valid', translation: 'hợp lệ' }),
    ], 'shared');
    expect(result).toMatchObject({ status: 'completed', candidateCount: 1, createdCount: 1 });
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

  it('does not persist media twice when it was already included in the created card', async () => {
    const { port } = createFakePort();
    const generated = {
      ...card('apple'),
      audioUrl: 'https://media.example/apple.mp3',
      imageUrl: 'https://images.pexels.com/apple.jpeg',
    };
    vi.mocked(port.generateCard).mockResolvedValue({
      card: generated,
      mediaPromise: Promise.resolve({
        audioUrl: generated.audioUrl,
        imageUrl: generated.imageUrl,
      }),
    });
    const intake = createCardIntakeController({ port });
    intake.setDraft('apple');

    const result = await intake.generateDraft();
    if (result.status === 'created') await result.mediaTask;

    expect(result).toMatchObject({ status: 'created' });
    expect(port.applyMedia).not.toHaveBeenCalled();
  });

  it('keeps a created card successful when its deferred media patch fails', async () => {
    const { port, persistCards } = createFakePort();
    const patchFailure = new Error('media patch unavailable');
    vi.mocked(port.generateCard).mockResolvedValue({
      card: card('apple'),
      mediaPromise: Promise.resolve({
        audioUrl: 'https://media.example/apple.mp3',
        imageUrl: null,
      }),
    });
    vi.mocked(port.applyMedia).mockRejectedValue(patchFailure);
    const mediaFailed = vi.fn();
    const intake = createCardIntakeController({
      port,
      diagnostics: { mediaFailed },
    });
    intake.setDraft('apple');

    const result = await intake.generateDraft();

    expect(result).toMatchObject({ status: 'created', card: card('apple') });
    expect(persistCards).toHaveBeenCalledOnce();
    if (result.status === 'created') {
      await expect(result.mediaTask).resolves.toBeUndefined();
    }
    expect(mediaFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 'word-apple' }), patchFailure);
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

  it('surfaces a sanitized protected-service blocker while preserving the draft', async () => {
    const { port } = createFakePort();
    vi.mocked(port.generateCard).mockRejectedValue(classifyProtectedFunctionError(
      Object.assign(new Error('private backend detail'), { code: 'functions/failed-precondition' }),
      'Card generation',
    ));
    const intake = createCardIntakeController({ port });
    intake.setDraft('apple');

    await intake.generateDraft();

    expect(intake.getSnapshot()).toMatchObject({
      draft: 'apple',
      error: 'Card generation cannot run because this app and its cloud deployment are out of sync. Update the deployment configuration before retrying.',
    });
  });

  it('propagates spreadsheet failure and always clears progress/loading/source', async () => {
    const { port } = createFakePort();
    const resetSource = vi.fn();
    const intake = createCardIntakeController({ port, resetImportSource: resetSource });

    const result = await intake.importSpreadsheet({
      sizeBytes: 100,
      loadWorkbook: async () => { throw new Error('broken workbook'); },
    });

    expect(result).toMatchObject({ status: 'failed', reason: 'parse' });
    expect(intake.getSnapshot()).toMatchObject({
      isImporting: false,
      importProgress: null,
      importResult: { status: 'failed', reason: 'parse' },
    });
    expect(resetSource).toHaveBeenCalledOnce();
  });

  it('surfaces a busy import attempt instead of silently ignoring it', async () => {
    const { port } = createFakePort();
    const pending = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    vi.mocked(port.generateCard).mockReturnValue(pending.promise);
    const intake = createCardIntakeController({ port });
    intake.setDraft('apple');
    const generation = intake.generateDraft();

    const result = await intake.importSpreadsheet({
      sizeBytes: 10,
      loadWorkbook: async () => ({ structuredRows: [], flatRows: [['pear']] }),
    });

    expect(result).toEqual({ status: 'busy' });
    expect(intake.getSnapshot().error).toBe('Wait for the current card operation to finish, then choose the spreadsheet again.');
    pending.resolve({ card: card('apple'), mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }) });
    await generation;
  });
});

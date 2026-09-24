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
    generateCard: vi.fn(async request => ({
      card: card(request.term),
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
    expect(port.generateCard).toHaveBeenCalledWith({
      term: 'apple pie',
      operationId: expect.any(String),
      language: ENGLISH_TO_VIETNAMESE_PROFILE,
    });
  });

  it('passes bounded extension context and requested deck through structured generation', async () => {
    const { port } = createFakePort();
    const intake = createCardIntakeController({ port });
    intake.setDraft('lead');

    await intake.generateDraft({
      context: ` The lead\n${'actor '.repeat(100)}arrived. `,
      requestedDeck: ' Reading ',
      requestedDeckAvailable: deck => deck === 'Reading',
    });

    expect(port.generateCard).toHaveBeenCalledWith(expect.objectContaining({
      term: 'lead',
      language: ENGLISH_TO_VIETNAMESE_PROFILE,
      context: expect.stringContaining('The lead actor'),
      requestedDeck: 'Reading',
      requestedDeckAvailable: expect.any(Function),
    }));
  });

  it('keeps a verified extension operation ID through a failed manual retry', async () => {
    const { port } = createFakePort();
    vi.mocked(port.generateCard).mockRejectedValueOnce(new Error('Temporary network error'));
    const intake = createCardIntakeController({ port });
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    intake.setDraft('lead');

    expect((await intake.generateDraft({ operationId, context: 'Lead the group.' })).status).toBe('failed');
    await intake.generateDraft({ operationId, context: 'Lead the group.' });

    expect(vi.mocked(port.generateCard).mock.calls.map(([request]) => request.operationId))
      .toEqual([operationId, operationId]);
  });

  it('reports a random capture request id and bounded failure latency without private text', async () => {
    const { port } = createFakePort();
    const captureStarted = vi.fn();
    const captureFailed = vi.fn();
    vi.mocked(port.generateCard).mockRejectedValueOnce(new Error('Provider unavailable'));
    const intake = createCardIntakeController({ port, diagnostics: { captureStarted, captureFailed } });
    intake.setDraft('lead');
    expect((await intake.generateDraft({ surface: 'extension' })).status).toBe('failed');
    expect(captureStarted).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), surface: 'extension',
    });
    expect(captureFailed).toHaveBeenCalledWith(expect.objectContaining({
      requestId: captureStarted.mock.calls[0][0].requestId,
      surface: 'extension', latencyMs: expect.any(Number),
    }));
    expect(captureFailed.mock.calls[0][0].latencyMs).toBeLessThanOrEqual(600_000);
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
      origin: 'ai',
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

  it('sanitizes untrusted word-family fields when adopting a shared card', async () => {
    const { port, persistCards } = createFakePort();
    const intake = createCardIntakeController({ port });

    await intake.adoptSharedDeck({
      cards: [
        {
          word: ' resilient ',
          translation: ' bền bỉ ',
          wordFamily: {
            noun: ' resilience ',
            verb: 'r'.repeat(101),
            adj: { nested: 'must drop' },
            adv: 42,
            extra: 'must drop',
          },
        },
        {
          word: ' empty-family ',
          translation: ' trống ',
          wordFamily: { noun: '  ', extra: 'must drop' },
        },
      ],
    });

    const persisted = persistCards.mock.calls[0][0];
    expect(persisted[0].wordFamily).toEqual({ noun: 'resilience', verb: 'r'.repeat(100) });
    expect(persisted[1]).not.toHaveProperty('wordFamily');
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
    expect(intake.getSnapshot()).toMatchObject({ draft: 'apple', isSubmitting: false, error: 'Chưa tạo hoặc lưu được thẻ. Từ đã chọn vẫn được giữ lại; hãy thử lại.' });
  });

  it('keeps one draft operation ID across a manual retry and clears it after save', async () => {
    const { port } = createFakePort();
    const writeOperation = vi.fn();
    const clearOperation = vi.fn();
    const intake = createCardIntakeController({ port, draft: {
      read: () => null, write: vi.fn(), clear: vi.fn(),
      writeOperation, clearOperation,
    } });
    vi.mocked(port.generateCard).mockRejectedValueOnce(new Error('transient'));
    intake.setDraft('apple');
    expect((await intake.generateDraft()).status).toBe('failed');
    expect((await intake.generateDraft()).status).toBe('created');
    const ids = vi.mocked(port.generateCard).mock.calls.map(([request]) => request.operationId);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-/);
    expect(ids[1]).toBe(ids[0]);
    expect(writeOperation).toHaveBeenCalledOnce();
    expect(clearOperation).toHaveBeenCalledOnce();
  });

  it('mints a new draft operation ID when the same word is retried with a different context', async () => {
    const { port } = createFakePort();
    const intake = createCardIntakeController({ port });
    vi.mocked(port.generateCard).mockRejectedValueOnce(new Error('transient'));
    intake.setDraft('lead');

    expect((await intake.generateDraft({ context: 'metal, heavy' })).status).toBe('failed');
    const firstId = vi.mocked(port.generateCard).mock.calls[0][0].operationId;

    vi.mocked(port.generateCard).mockResolvedValueOnce({
      card: card('lead'),
      mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
    });
    expect((await intake.generateDraft({ context: 'to guide someone' })).status).toBe('created');
    const secondId = vi.mocked(port.generateCard).mock.calls[1][0].operationId;

    expect(secondId).not.toBe(firstId);
  });

  it('reuses the same draft operation ID across a retry that keeps the same word and context', async () => {
    const { port } = createFakePort();
    const intake = createCardIntakeController({ port });
    vi.mocked(port.generateCard).mockRejectedValueOnce(new Error('transient'));
    intake.setDraft('lead');

    expect((await intake.generateDraft({ context: 'metal, heavy' })).status).toBe('failed');
    expect((await intake.generateDraft({ context: 'metal, heavy' })).status).toBe('created');

    const ids = vi.mocked(port.generateCard).mock.calls.map(([request]) => request.operationId);
    expect(ids[1]).toBe(ids[0]);
  });

  it('mints a new draft operation ID for the same word and context under a different language profile', async () => {
    const { port } = createFakePort();
    const draftState = { operation: null as null | { word: string; context: string; languageId: string; id: string } };
    const draft: CardIntakeDraftPort = {
      read: () => null, write: vi.fn(), clear: vi.fn(),
      readOperation: () => draftState.operation,
      writeOperation: operation => { draftState.operation = operation; },
      clearOperation: () => { draftState.operation = null; },
    };
    vi.mocked(port.generateCard).mockRejectedValueOnce(new Error('transient'));
    const english = createCardIntakeController({ port, draft, language: ENGLISH_TO_VIETNAMESE_PROFILE });
    english.setDraft('lead');
    expect((await english.generateDraft()).status).toBe('failed');
    const firstId = vi.mocked(port.generateCard).mock.calls[0][0].operationId;

    vi.mocked(port.generateCard).mockResolvedValueOnce({
      card: card('lead'),
      mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
    });
    const otherLanguage = { ...ENGLISH_TO_VIETNAMESE_PROFILE, id: 'en-fr' };
    const french = createCardIntakeController({ port, draft, language: otherLanguage });
    french.setDraft('lead');
    expect((await french.generateDraft()).status).toBe('created');
    const secondId = vi.mocked(port.generateCard).mock.calls[1][0].operationId;

    expect(secondId).not.toBe(firstId);
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
      error: 'Dịch vụ AI chưa sẵn sàng. Từ đã chọn vẫn được giữ lại; hãy thử lại sau.',
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

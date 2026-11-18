import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { classifyProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import { languageProfileForPair } from '../courses/courseLanguageProfile';
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
    createConfirmedCatalogCards: vi.fn(async cards => ({
      status: 'completed' as const, cards, createdCount: cards.length, reusedCount: 0,
    })),
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

  it('rejects an oversized or duplicate catalog batch before it reaches the port', async () => {
    const { port } = createFakePort();
    const intake = createCardIntakeController({ port });
    const catalogCard = (id: string) => ({ ...card(id), lexemeId: `lexeme-${id}` });

    await expect(intake.createConfirmedCatalogCards(
      Array.from({ length: 21 }, (_, index) => catalogCard(String(index))),
    )).resolves.toEqual({ status: 'invalid', reason: 'too-many-cards' });
    await expect(intake.createConfirmedCatalogCards([
      catalogCard('one'), catalogCard('one'),
    ])).resolves.toEqual({ status: 'invalid', reason: 'invalid-catalog-cards' });
    expect(port.createConfirmedCatalogCards).not.toHaveBeenCalled();
  });

  it('stages an AI preview and saves only after an explicit save action', async () => {
    const { port, persistCards } = createFakePort();
    const intake = createCardIntakeController({ port, now: () => '2026-09-25T00:00:00.000Z' });

    intake.cardCreator.open();
    intake.cardCreator.updateDraft({ word: 'apple', context: 'A red apple.', deck: 'General' });
    const preview = await intake.cardCreator.generatePreview();

    expect(preview).toMatchObject({ status: 'preview', card: { word: 'apple', origin: 'ai' } });
    expect(persistCards).not.toHaveBeenCalled();
    expect(intake.getSnapshot().cardCreator).toMatchObject({
      open: true,
      stage: 'preview',
      completedAiRequests: 1,
      preview: { word: 'apple', customDeck: 'General' },
    });

    const saved = await intake.cardCreator.save();
    expect(saved).toMatchObject({ status: 'saved', card: { word: 'apple', origin: 'ai' } });
    expect(persistCards).toHaveBeenCalledOnce();
    expect(port.generateCard).toHaveBeenCalledOnce();
    expect(intake.getSnapshot().cardCreator.open).toBe(false);
  });

  it('shows complete AI fields during generation and preserves a learner edit', async () => {
    const { port } = createFakePort();
    const generation = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    vi.mocked(port.generateCard).mockReturnValue(generation.promise);
    const intake = createCardIntakeController({ port });
    intake.cardCreator.open();
    intake.cardCreator.updateDraft({ word: 'apple' });
    const pending = intake.cardCreator.generatePreview();
    await vi.waitFor(() => expect(port.generateCard).toHaveBeenCalledOnce());
    const request = vi.mocked(port.generateCard).mock.calls[0][0];
    request.onProgress?.({ operationId: request.operationId!, stage: 'field', field: 'translation', value: 'táo' });
    expect(intake.getSnapshot().cardCreator).toMatchObject({
      stage: 'generating', preview: { translation: 'táo' },
    });
    intake.cardCreator.updatePreview({ translation: 'quả táo do tôi sửa' });
    request.onProgress?.({ operationId: request.operationId!, stage: 'field', field: 'translation', value: 'táo mới' });
    generation.resolve({
      card: { ...card('apple'), translation: 'táo mới', explanation: 'A fruit.' },
      mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
    });
    await expect(pending).resolves.toMatchObject({ status: 'preview' });
    expect(intake.getSnapshot().cardCreator.preview).toMatchObject({
      translation: 'quả táo do tôi sửa', explanation: 'A fruit.',
    });
    expect(port.persistCards).not.toHaveBeenCalled();
  });

  it('publishes only current-operation AI stages and ignores them after close', async () => {
    const { port } = createFakePort();
    const generation = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    vi.mocked(port.generateCard).mockReturnValue(generation.promise);
    const intake = createCardIntakeController({ port });
    intake.cardCreator.open();
    intake.cardCreator.updateDraft({ word: 'apple' });
    const pending = intake.cardCreator.generatePreview();
    await vi.waitFor(() => expect(port.generateCard).toHaveBeenCalledOnce());
    const request = vi.mocked(port.generateCard).mock.calls[0][0];

    request.onProgress?.({ operationId: request.operationId!, stage: 'reserving' });
    expect(intake.getSnapshot().cardCreator.generationStage).toBe('reserving');
    request.onProgress?.({ operationId: 'wrong-operation', stage: 'drafting' });
    expect(intake.getSnapshot().cardCreator.generationStage).toBe('reserving');

    intake.cardCreator.cancel();
    request.onProgress?.({ operationId: request.operationId!, stage: 'drafting' });
    expect(intake.getSnapshot().cardCreator.generationStage).toBeNull();
    generation.resolve({ card: card('apple'), mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }) });
    await expect(pending).resolves.toEqual({ status: 'cancelled' });
  });

  it('clears the current AI stage when generation settles or fails', async () => {
    const { port } = createFakePort();
    const first = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    vi.mocked(port.generateCard)
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('generation failed'));
    const intake = createCardIntakeController({ port });
    intake.cardCreator.open();
    intake.cardCreator.updateDraft({ word: 'apple' });

    const preview = intake.cardCreator.generatePreview();
    await vi.waitFor(() => expect(port.generateCard).toHaveBeenCalledOnce());
    const firstRequest = vi.mocked(port.generateCard).mock.calls[0][0];
    firstRequest.onProgress?.({ operationId: firstRequest.operationId!, stage: 'drafting' });
    first.resolve({ card: card('apple'), mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }) });
    await expect(preview).resolves.toMatchObject({ status: 'preview' });
    expect(intake.getSnapshot().cardCreator.generationStage).toBeNull();

    const retry = intake.cardCreator.regenerate(['meaning']);
    await vi.waitFor(() => expect(port.generateCard).toHaveBeenCalledTimes(2));
    const retryRequest = vi.mocked(port.generateCard).mock.calls[1][0];
    retryRequest.onProgress?.({ operationId: retryRequest.operationId!, stage: 'drafting' });
    await expect(retry).resolves.toMatchObject({ status: 'failed' });
    expect(intake.getSnapshot().cardCreator).toMatchObject({ stage: 'error', generationStage: null });
  });

  it('keeps learner preview edits when initial generation or regeneration fails', async () => {
    const { port } = createFakePort();
    const initial = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    const regeneration = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    vi.mocked(port.generateCard)
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(regeneration.promise);
    const intake = createCardIntakeController({ port });
    intake.cardCreator.open();
    intake.cardCreator.updateDraft({ word: 'apple' });

    const firstAttempt = intake.cardCreator.generatePreview();
    await vi.waitFor(() => expect(port.generateCard).toHaveBeenCalledOnce());
    const firstRequest = vi.mocked(port.generateCard).mock.calls[0][0];
    firstRequest.onProgress?.({ operationId: firstRequest.operationId!, stage: 'field', field: 'translation', value: 'táo' });
    intake.cardCreator.updatePreview({ translation: 'quả táo do tôi sửa' });
    initial.reject(new Error('generation failed'));
    await expect(firstAttempt).resolves.toMatchObject({ status: 'failed' });
    expect(intake.getSnapshot().cardCreator.preview).toMatchObject({ translation: 'quả táo do tôi sửa' });
    await expect(intake.cardCreator.save()).resolves.toMatchObject({ status: 'failed', error: { code: 'invalid' } });
    expect(port.persistCards).not.toHaveBeenCalled();

    const retry = intake.cardCreator.regenerate(['meaning']);
    await vi.waitFor(() => expect(port.generateCard).toHaveBeenCalledTimes(2));
    intake.cardCreator.updatePreview({ translation: 'quả táo do tôi sửa lần nữa' });
    regeneration.reject(new Error('generation failed'));
    await expect(retry).resolves.toMatchObject({ status: 'failed' });
    expect(intake.getSnapshot().cardCreator.preview).toMatchObject({ translation: 'quả táo do tôi sửa lần nữa' });
  });

  it('aborts the live stream and requests quota cancellation when the dialog closes', async () => {
    const { port } = createFakePort();
    const generation = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    vi.mocked(port.generateCard).mockReturnValue(generation.promise);
    port.cancelGeneration = vi.fn(async () => undefined);
    const intake = createCardIntakeController({ port });
    intake.cardCreator.open();
    intake.cardCreator.updateDraft({ word: 'apple' });
    const pending = intake.cardCreator.generatePreview();
    await vi.waitFor(() => expect(port.generateCard).toHaveBeenCalledOnce());
    const request = vi.mocked(port.generateCard).mock.calls[0][0];
    intake.cardCreator.cancel();
    expect(request.signal?.aborted).toBe(true);
    expect(port.cancelGeneration).toHaveBeenCalledWith(request.operationId);
    generation.resolve({ card: card('apple'), mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }) });
    await expect(pending).resolves.toEqual({ status: 'cancelled' });
  });

  it.each([
    ['word', { word: 'pear' }],
    ['context', { context: 'A green apple.' }],
    ['part of speech', { partOfSpeech: 'noun' }],
  ])('aborts and cancels a live generation when its %s changes', async (_field, patch) => {
    const { port } = createFakePort();
    const generation = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    vi.mocked(port.generateCard).mockReturnValue(generation.promise);
    port.cancelGeneration = vi.fn(async () => undefined);
    const intake = createCardIntakeController({ port });
    intake.cardCreator.open();
    intake.cardCreator.updateDraft({ word: 'apple', context: 'A red apple.', partOfSpeech: 'adjective' });
    const pending = intake.cardCreator.generatePreview();
    await vi.waitFor(() => expect(port.generateCard).toHaveBeenCalledOnce());
    const request = vi.mocked(port.generateCard).mock.calls[0][0];

    intake.cardCreator.updateDraft(patch);

    expect(request.signal?.aborted).toBe(true);
    expect(port.cancelGeneration).toHaveBeenCalledTimes(1);
    expect(port.cancelGeneration).toHaveBeenCalledWith(request.operationId);
    generation.resolve({ card: card('apple'), mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }) });
    await expect(pending).resolves.toEqual({ status: 'cancelled' });
  });

  it('aborts and refunds an in-flight generation when the controller is disposed', async () => {
    const { port } = createFakePort();
    const generation = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    vi.mocked(port.generateCard).mockReturnValue(generation.promise);
    port.cancelGeneration = vi.fn(async () => undefined);
    const intake = createCardIntakeController({ port });
    intake.cardCreator.open();
    intake.cardCreator.updateDraft({ word: 'apple' });
    const pending = intake.cardCreator.generatePreview();
    await vi.waitFor(() => expect(port.generateCard).toHaveBeenCalledOnce());
    const request = vi.mocked(port.generateCard).mock.calls[0][0];

    intake.dispose();
    intake.dispose();

    expect(request.signal?.aborted).toBe(true);
    expect(port.cancelGeneration).toHaveBeenCalledTimes(1);
    expect(port.cancelGeneration).toHaveBeenCalledWith(request.operationId);
    generation.resolve({ card: card('apple'), mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }) });
    await expect(pending).resolves.toEqual({ status: 'cancelled' });
  });

  it('does not refund a completed generation when the controller is disposed', async () => {
    const { port } = createFakePort();
    port.cancelGeneration = vi.fn(async () => undefined);
    const intake = createCardIntakeController({ port });
    intake.cardCreator.open();
    intake.cardCreator.updateDraft({ word: 'apple' });

    await expect(intake.cardCreator.generatePreview()).resolves.toMatchObject({ status: 'preview' });
    intake.dispose();

    expect(port.cancelGeneration).not.toHaveBeenCalled();
  });

  it('reuses one AI operation ID for transport retry and refreshes it for deliberate regeneration', async () => {
    const { port } = createFakePort();
    vi.mocked(port.generateCard)
      .mockRejectedValueOnce(new Error('temporary network error'))
      .mockResolvedValueOnce({
        card: { ...card('apple'), translation: 'táo cũ', phonetic: '/a/' },
        mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
      })
      .mockResolvedValueOnce({
        card: {
          ...card('apple'), translation: 'táo mới', explanation: 'A fruit.', phonetic: '/b/',
          exampleSentence: 'A new example.', exampleTranslation: 'Ví dụ mới.',
          cefrLevel: 'B2', wordFamily: { noun: 'apples' },
        },
        mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
      });
    const intake = createCardIntakeController({ port });
    intake.cardCreator.open();
    intake.cardCreator.updateDraft({ word: 'apple' });

    await expect(intake.cardCreator.generatePreview()).resolves.toMatchObject({ status: 'failed' });
    expect(intake.getSnapshot().cardCreator.preview).toBeNull();
    await expect(intake.cardCreator.generatePreview()).resolves.toMatchObject({ status: 'preview' });
    const firstOperationId = vi.mocked(port.generateCard).mock.calls[0][0].operationId;
    const retryOperationId = vi.mocked(port.generateCard).mock.calls[1][0].operationId;
    expect(retryOperationId).toBe(firstOperationId);

    const regenerated = await intake.cardCreator.regenerate(['meaning']);
    expect(regenerated).toMatchObject({ status: 'preview', card: { translation: 'táo mới' } });
    const deliberateOperationId = vi.mocked(port.generateCard).mock.calls[2][0].operationId;
    expect(deliberateOperationId).not.toBe(retryOperationId);
    expect(intake.getSnapshot().cardCreator.preview).toMatchObject({
      id: 'word-apple',
      translation: 'táo mới',
      phonetic: '/a/',
    });
  });

  it('merges selected regeneration fields without changing identity or learning state', async () => {
    const { port } = createFakePort();
    const original = {
      ...card('apple'),
      translation: 'táo',
      phonetic: '/a/',
      difficulty: 'good' as const,
      reviews: 4,
      bookmarked: true,
      lexemeId: 'lexeme-apple',
      language: 'en',
      translationLanguage: 'vi',
      normalizedLemma: 'apple',
      senseKey: 'fruit',
    };
    vi.mocked(port.generateCard)
      .mockResolvedValueOnce({ card: original, mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }) })
      .mockResolvedValueOnce({
        card: {
          ...original,
          id: 'new-id', word: 'attacker', translation: 'quả táo mới', phonetic: '/new/',
          difficulty: 'hard', reviews: 99, bookmarked: false,
        },
        mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
      });
    const intake = createCardIntakeController({ port });
    intake.cardCreator.open();
    intake.cardCreator.updateDraft({ word: 'apple' });
    await intake.cardCreator.generatePreview();
    await intake.cardCreator.regenerate(['meaning']);

    expect(intake.getSnapshot().cardCreator.preview).toMatchObject({
      id: 'word-apple',
      word: 'apple',
      translation: 'quả táo mới',
      phonetic: '/a/',
      difficulty: 'good',
      reviews: 4,
      bookmarked: true,
      lexemeId: 'lexeme-apple',
      language: 'en',
      translationLanguage: 'vi',
      normalizedLemma: 'apple',
      senseKey: 'fruit',
    });
    expect(port.persistCards).not.toHaveBeenCalled();
  });

  it('fences a late generation result after cancel and exposes the opener for the dialog to refocus', async () => {
    const { port } = createFakePort();
    const generation = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    vi.mocked(port.generateCard).mockReturnValue(generation.promise);
    const focus = vi.fn();
    const intake = createCardIntakeController({ port });
    intake.cardCreator.open({ focus } as unknown as HTMLElement);
    // The controller publishes the opener on the model instead of calling
    // .focus() itself: Radix's Dialog FocusScope is still trapped at the
    // instant a close publishes, so only the dialog's own onCloseAutoFocus
    // (which fires after the trap releases) can safely restore focus. See
    // the focusTarget doc comment on CardCreatorModel.
    expect(intake.getSnapshot().cardCreator.focusTarget).toMatchObject({ focus });
    intake.cardCreator.updateDraft({ word: 'apple' });
    const pending = intake.cardCreator.generatePreview();
    intake.cardCreator.cancel();
    generation.resolve({ card: card('apple'), mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }) });

    await expect(pending).resolves.toEqual({ status: 'cancelled' });
    expect(port.persistCards).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(intake.getSnapshot().cardCreator).toMatchObject({ open: false, preview: null, focusTarget: null });
  });

  it('creates and saves a manual card without invoking AI', async () => {
    const { port, persistCards } = createFakePort();
    const intake = createCardIntakeController({ port, now: () => '2026-09-25T00:00:00.000Z' });
    intake.cardCreator.open();
    intake.cardCreator.createManualDraft({
      word: 'bonjour',
      translation: 'xin chào',
      explanation: 'A greeting.',
      deck: 'Travel',
    });

    const result = await intake.cardCreator.save();
    expect(result).toMatchObject({ status: 'saved', card: {
      word: 'bonjour', translation: 'xin chào', origin: 'manual', customDeck: 'Travel',
    } });
    expect(port.generateCard).not.toHaveBeenCalled();
    expect(persistCards).toHaveBeenCalledWith([
      expect.objectContaining({ word: 'bonjour', origin: 'manual', translation: 'xin chào' }),
    ], 'generate');
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
          origin: 'ai',
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
    expect(result).toMatchObject({
      status: 'completed',
      candidateCount: 2,
      createdCount: 1,
      reusedCount: 1,
      cards: [expect.objectContaining({ id: 'word-banana' })],
      resolvedCards: [
        expect.objectContaining({ id: 'word-apple' }),
        expect.objectContaining({ id: 'word-banana' }),
      ],
    });
    expect(existing.createdAt).toBe('2024-02-02T00:00:00.000Z');
  });

  it('rejects shared adoption before lookup until the bound language pair matches', async () => {
    const { port, persistCards } = createFakePort();
    const shared = {
      cards: [{ word: '사과', translation: 'quả táo' }],
      expectedPair: { targetLanguage: 'ko', nativeLanguage: 'vi' },
    };
    const oldIntake = createCardIntakeController({
      port,
      language: ENGLISH_TO_VIETNAMESE_PROFILE,
    });

    await expect(oldIntake.adoptSharedDeck(shared)).resolves.toEqual({ status: 'pair-mismatch' });
    expect(port.findExisting).not.toHaveBeenCalled();
    expect(persistCards).not.toHaveBeenCalled();

    const currentIntake = createCardIntakeController({
      port,
      language: languageProfileForPair('ko', 'vi'),
    });
    await expect(currentIntake.adoptSharedDeck(shared)).resolves.toMatchObject({
      status: 'completed', candidateCount: 1, createdCount: 1,
    });
    expect(port.findExisting).toHaveBeenCalledWith(['사과']);
    expect(persistCards).toHaveBeenCalledOnce();
  });

  it('retries only missing shared cards after a partial save', async () => {
    const { port, persistCards } = createFakePort();
    vi.mocked(port.findExisting)
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([['apple', card('apple')]]));
    persistCards.mockRejectedValueOnce(new Error('banana save failed'));
    const intake = createCardIntakeController({ port });
    const shared = { cards: [
      { word: 'apple', translation: 'táo' },
      { word: 'banana', translation: 'chuối' },
    ] };

    await expect(intake.adoptSharedDeck(shared)).resolves.toMatchObject({ status: 'failed' });
    await expect(intake.adoptSharedDeck(shared)).resolves.toMatchObject({
      status: 'completed', candidateCount: 2, createdCount: 1, reusedCount: 1,
    });
    expect(persistCards).toHaveBeenCalledTimes(2);
    expect(persistCards.mock.calls[1]![0].map(value => value.word)).toEqual(['banana']);
  });
  it('returns the real legacy ID for an existing shared card without rewriting scheduler state', async () => {
    const { port, persistCards } = createFakePort();
    const existing = {
      ...card('apple', '2024-02-02T00:00:00.000Z'),
      id: 'legacy-apple',
      normalizedWord: '',
      difficulty: 'good' as const,
      reviews: 3,
      nextReviewDate: '2026-09-10',
      reviewHistory: [{ rating: 'good' as const, reviewedAt: '2026-08-01', scheduledDays: 3, elapsedDays: 3 }],
    };
    vi.mocked(port.findExisting).mockResolvedValue(new Map([['apple', existing]]));
    const intake = createCardIntakeController({ port });

    const result = await intake.adoptSharedDeck({
      cards: [{ word: 'APPLE', translation: 'táo' }],
    });

    expect(result).toMatchObject({
      status: 'completed',
      candidateCount: 1,
      createdCount: 0,
      reusedCount: 1,
      cards: [],
      resolvedCards: [existing],
    });
    expect(persistCards).not.toHaveBeenCalled();
    expect(existing).toMatchObject({
      difficulty: 'good',
      reviews: 3,
      nextReviewDate: '2026-09-10',
      reviewHistory: [expect.objectContaining({ rating: 'good' })],
    });
  });

  it('returns an authoritative persisted card when a concurrent create is reported as reused', async () => {
    const { port, persistCards } = createFakePort();
    const authoritative = { ...card('apple'), id: 'legacy-apple', normalizedWord: 'apple' };
    vi.mocked(persistCards).mockResolvedValue([{ card: authoritative, created: false }]);
    const intake = createCardIntakeController({ port });

    const result = await intake.adoptSharedDeck({
      cards: [{ word: 'apple', translation: 'táo' }],
    });

    expect(result).toMatchObject({
      status: 'completed',
      candidateCount: 1,
      createdCount: 0,
      reusedCount: 1,
      cards: [],
      resolvedCards: [authoritative],
    });
  });

  it('fails closed when an existing lookup is keyed to the wrong card identity', async () => {
    const { port, persistCards } = createFakePort();
    vi.mocked(port.findExisting).mockResolvedValue(new Map([['apple', card('banana')]]));
    const intake = createCardIntakeController({ port });

    const result = await intake.adoptSharedDeck({
      cards: [{ word: 'apple', translation: 'táo' }],
    });

    expect(result).toMatchObject({ status: 'failed', error: expect.any(Error) });
    expect(persistCards).not.toHaveBeenCalled();
  });

  it('fails closed when an existing card ID is unsafe or oversized', async () => {
    const { port, persistCards } = createFakePort();
    vi.mocked(port.findExisting)
      .mockResolvedValueOnce(new Map([['apple', { ...card('apple'), id: 'legacy/apple' }]]))
      .mockResolvedValueOnce(new Map([['apple', { ...card('apple'), id: `legacy-${'a'.repeat(128)}` }]]));
    const intake = createCardIntakeController({ port });

    await expect(intake.adoptSharedDeck({
      cards: [{ word: 'apple', translation: 'táo' }],
    })).resolves.toMatchObject({ status: 'failed', error: expect.any(Error) });
    await expect(intake.adoptSharedDeck({
      cards: [{ word: 'apple', translation: 'táo' }],
    })).resolves.toMatchObject({ status: 'failed', error: expect.any(Error) });
    expect(persistCards).not.toHaveBeenCalled();
  });

  it('fails closed when persistence returns only a partial result set', async () => {
    const { port, persistCards } = createFakePort();
    vi.mocked(persistCards).mockResolvedValue([
      { card: card('apple'), created: true },
    ]);
    const intake = createCardIntakeController({ port });

    const result = await intake.adoptSharedDeck({
      cards: [
        { word: 'apple', translation: 'táo' },
        { word: 'banana', translation: 'chuối' },
      ],
    });

    expect(result).toMatchObject({ status: 'failed', error: expect.any(Error) });
  });

  it('correlates reordered persistence results by identity while preserving candidate order', async () => {
    const { port, persistCards } = createFakePort();
    vi.mocked(persistCards).mockResolvedValue([
      { card: card('banana'), created: true },
      { card: card('apple'), created: true },
    ]);
    const intake = createCardIntakeController({ port });

    const result = await intake.adoptSharedDeck({
      cards: [
        { word: 'apple', translation: 'táo' },
        { word: 'banana', translation: 'chuối' },
      ],
    });

    expect(result).toMatchObject({
      status: 'completed',
      candidateCount: 2,
      createdCount: 2,
      reusedCount: 0,
      cards: [card('apple'), card('banana')],
      resolvedCards: [card('apple'), card('banana')],
    });
  });

  it('fails closed when persistence returns duplicate identities', async () => {
    const { port, persistCards } = createFakePort();
    vi.mocked(persistCards).mockResolvedValue([
      { card: card('apple'), created: true },
      { card: card('apple'), created: true },
    ]);
    const intake = createCardIntakeController({ port });

    const result = await intake.adoptSharedDeck({
      cards: [
        { word: 'apple', translation: 'táo' },
        { word: 'banana', translation: 'chuối' },
      ],
    });

    expect(result).toMatchObject({ status: 'failed', error: expect.any(Error) });
  });

  it('requires a newly created result to retain the candidate card ID', async () => {
    const { port, persistCards } = createFakePort();
    vi.mocked(persistCards).mockResolvedValue([
      { card: { ...card('apple'), id: 'legacy-apple' }, created: true },
    ]);
    const intake = createCardIntakeController({ port });

    const result = await intake.adoptSharedDeck({
      cards: [{ word: 'apple', translation: 'táo' }],
    });

    expect(result).toMatchObject({ status: 'failed', error: expect.any(Error) });
  });

  it('fails closed when a persistence result has a wrong or malformed identity', async () => {
    const { port, persistCards } = createFakePort();
    vi.mocked(persistCards).mockResolvedValueOnce([
      { card: card('banana'), created: true },
    ]);
    const intake = createCardIntakeController({ port });

    await expect(intake.adoptSharedDeck({
      cards: [{ word: 'apple', translation: 'táo' }],
    })).resolves.toMatchObject({ status: 'failed', error: expect.any(Error) });

    vi.mocked(persistCards).mockResolvedValueOnce([
      { card: card('apple'), created: 'yes' as unknown as boolean },
    ]);
    await expect(intake.adoptSharedDeck({
      cards: [{ word: 'apple', translation: 'táo' }],
    })).resolves.toMatchObject({ status: 'failed', error: expect.any(Error) });
  });

  it('fails closed when malformed input leaves no accepted shared candidates', async () => {
    const { port, persistCards } = createFakePort();
    const intake = createCardIntakeController({ port });

    const result = await intake.adoptSharedDeck({
      cards: [null, {}, { word: 'missing-translation', translation: ' ' }],
    });

    expect(result).toMatchObject({ status: 'failed', error: expect.any(Error) });
    expect(persistCards).not.toHaveBeenCalled();
  });

  it('fails closed when persistence accepts no otherwise valid shared candidate', async () => {
    const { port, persistCards } = createFakePort();
    vi.mocked(persistCards).mockResolvedValue([]);
    const intake = createCardIntakeController({ port });

    const result = await intake.adoptSharedDeck({
      cards: [{ word: 'valid', translation: 'hợp lệ' }],
    });

    expect(result).toMatchObject({ status: 'failed', error: expect.any(Error) });
    expect(persistCards).toHaveBeenCalledWith([expect.objectContaining({ word: 'valid' })], 'shared');
  });

  it('keeps shared adoption single-flight while persistence is pending', async () => {
    const { port, persistCards } = createFakePort();
    const pending = deferred<Array<{ card: CardData; created: boolean }>>();
    vi.mocked(persistCards).mockReturnValue(pending.promise);
    const intake = createCardIntakeController({ port });

    const first = intake.adoptSharedDeck({ cards: [{ word: 'apple', translation: 'táo' }] });
    await vi.waitFor(() => expect(persistCards).toHaveBeenCalledOnce());
    await expect(intake.adoptSharedDeck({ cards: [{ word: 'banana', translation: 'chuối' }] }))
      .resolves.toEqual({ status: 'busy' });
    pending.resolve([{ card: card('apple'), created: true }]);
    await expect(first).resolves.toMatchObject({ status: 'completed', resolvedCards: [card('apple')] });
  });

  it('fails stale adoption after an owner generation changes, including A-to-B-to-A', async () => {
    const { port, persistCards } = createFakePort();
    const found = deferred<Map<string, CardData>>();
    let ownerGeneration = 0;
    vi.mocked(port.findExisting).mockReturnValue(found.promise);
    port.captureSession = vi.fn(() => {
      const capturedGeneration = ownerGeneration;
      return () => capturedGeneration === ownerGeneration;
    });
    const intake = createCardIntakeController({ port });

    const pending = intake.adoptSharedDeck({ cards: [{ word: 'apple', translation: 'táo' }] });
    ownerGeneration = 1;
    ownerGeneration = 2;
    found.resolve(new Map());

    const result = await pending;
    expect(result).toMatchObject({ status: 'failed', error: expect.any(Error) });
    expect(persistCards).not.toHaveBeenCalled();
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

  it('preserves only safe shared-card origins during adoption', async () => {
    const { port, persistCards } = createFakePort();
    const intake = createCardIntakeController({ port });

    const result = await intake.adoptSharedDeck({
      cards: [
        { word: 'ai card', translation: 'thẻ AI', origin: 'ai' },
        { word: 'manual card', translation: 'thẻ tự tạo', origin: 'manual' },
        { word: 'legacy card', translation: 'thẻ cũ' },
        { word: 'unknown card', translation: 'thẻ lạ', origin: 'provider' },
      ],
    });

    expect(result).toMatchObject({ status: 'completed', createdCount: 4 });
    expect(persistCards).toHaveBeenCalledOnce();
    const persisted = persistCards.mock.calls[0][0];
    expect(persisted.map(value => value.origin)).toEqual(['ai', 'manual', undefined, undefined]);
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

  it('clears only a shared-adoption error and preserves newer intake errors', async () => {
    const { port } = createFakePort();
    const intake = createCardIntakeController({ port });
    const sharedCards = [{ word: 'apple', translation: 'táo' }];

    vi.mocked(port.findExisting).mockRejectedValueOnce(new Error('shared lookup failed'));
    await expect(intake.adoptSharedDeck({ cards: sharedCards })).resolves.toMatchObject({ status: 'failed' });
    expect(intake.getSnapshot().error).toBe(
      'Could not finish adding this shared deck. Retry the same link; cards already saved will be reused.',
    );
    intake.clearSharedAdoptionError();
    expect(intake.getSnapshot().error).toBeNull();

    vi.mocked(port.findExisting).mockRejectedValueOnce(new Error('shared lookup failed'));
    await intake.adoptSharedDeck({ cards: sharedCards });
    intake.setDraft('pear');
    vi.mocked(port.generateCard).mockRejectedValueOnce(new Error('generation failed'));
    await intake.generateDraft();
    const generationError = intake.getSnapshot().error;
    expect(generationError).toBeTruthy();
    intake.clearSharedAdoptionError();
    expect(intake.getSnapshot().error).toBe(generationError);

    vi.mocked(port.findExisting).mockRejectedValueOnce(new Error('shared lookup failed'));
    await intake.adoptSharedDeck({ cards: sharedCards });
    const spreadsheet = await intake.importSpreadsheet({
      sizeBytes: 100,
      loadWorkbook: async () => { throw new Error('broken workbook'); },
    });
    expect(spreadsheet).toMatchObject({ status: 'failed', reason: 'parse' });
    const spreadsheetError = intake.getSnapshot().error;
    expect(spreadsheetError).toBeTruthy();
    intake.clearSharedAdoptionError();
    expect(intake.getSnapshot().error).toBe(spreadsheetError);
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

  it('keeps an active import running while its view closes and reopens', async () => {
    const { port } = createFakePort();
    const settlement = deferred<'created' | 'reused' | 'failed' | 'pending'>();
    vi.mocked(port.generate).mockResolvedValue({
      created: true,
      category: 'Imported',
      settlement: settlement.promise,
    });
    const intake = createCardIntakeController({ port });
    const closedView = vi.fn();
    const close = intake.subscribe(closedView);
    const importing = intake.importSpreadsheet({
      sizeBytes: 100,
      loadWorkbook: async () => ({ structuredRows: [], flatRows: [['apple']] }),
    });
    await vi.waitFor(() => expect(port.generate).toHaveBeenCalledOnce());

    close();
    const reopenedSnapshots: ReturnType<typeof intake.getSnapshot>[] = [];
    intake.subscribe(snapshot => reopenedSnapshots.push(snapshot));
    settlement.resolve('created');

    await expect(importing).resolves.toMatchObject({
      status: 'completed',
      summary: { total: 1, created: 1, pending: 0 },
    });
    expect(intake.getSnapshot()).toMatchObject({
      isImporting: false,
      importProgress: null,
      importResult: { status: 'completed', summary: { created: 1 } },
    });
    expect(reopenedSnapshots.some(snapshot => snapshot.importResult?.status === 'completed')).toBe(true);
  });

  it('fences an import to its captured owner session and allows the new owner to retry', async () => {
    const { port } = createFakePort();
    const existing = deferred<Map<string, CardData>>();
    let owner = 'owner-a';
    port.captureSession = vi.fn(() => {
      const capturedOwner = owner;
      return () => owner === capturedOwner;
    });
    vi.mocked(port.findExisting).mockReturnValueOnce(existing.promise);
    const resetSource = vi.fn();
    const intake = createCardIntakeController({
      port,
      resetImportSource: resetSource,
      spreadsheetDelay: async () => undefined,
    });
    const snapshots: ReturnType<typeof intake.getSnapshot>[] = [];
    intake.subscribe(snapshot => snapshots.push(snapshot));
    const staleImport = intake.importSpreadsheet({
      sizeBytes: 100,
      loadWorkbook: async () => ({ structuredRows: [], flatRows: [['apple']] }),
    });
    await vi.waitFor(() => expect(port.findExisting).toHaveBeenCalledOnce());

    owner = 'owner-b';
    const publicationCountAtSwitch = snapshots.length;
    existing.resolve(new Map());

    await expect(staleImport).resolves.toEqual({ status: 'stale' });
    expect(snapshots).toHaveLength(publicationCountAtSwitch);
    expect(port.generate).not.toHaveBeenCalled();
    expect(resetSource).not.toHaveBeenCalled();

    vi.mocked(port.findExisting).mockResolvedValue(new Map());
    await expect(intake.importSpreadsheet({
      sizeBytes: 100,
      loadWorkbook: async () => ({ structuredRows: [], flatRows: [['pear']] }),
    })).resolves.toMatchObject({
      status: 'completed',
      summary: { total: 1, created: 1 },
    });
    expect(port.generate).toHaveBeenCalledWith('pear', 0);
    expect(port.captureSession).toHaveBeenCalledTimes(2);
    expect(resetSource).toHaveBeenCalledOnce();
  });

  it('does not mix a pending import or its late settlement into a retry', async () => {
    const { port } = createFakePort();
    const secondSave = deferred<Awaited<ReturnType<CardIntakeControllerPort['persistStructured']>>>();
    const settlementCallbacks: Array<Parameters<CardIntakeControllerPort['persistStructured']>[1]> = [];
    vi.mocked(port.persistStructured)
      .mockImplementationOnce(async (_plan, onSettlement) => {
        settlementCallbacks.push(onSettlement);
        return { createdCount: 0, outcomes: ['pending'] };
      })
      .mockImplementationOnce(async (_plan, onSettlement) => {
        settlementCallbacks.push(onSettlement);
        return secondSave.promise;
      });
    const intake = createCardIntakeController({ port });
    const request = (word: string) => ({
      sizeBytes: 100,
      loadWorkbook: async () => ({
        structuredRows: [{ Word: word, Translation: `${word}-vi` }],
        flatRows: [],
      }),
    });

    await expect(intake.importSpreadsheet(request('apple'))).resolves.toMatchObject({
      status: 'partial',
      summary: { total: 1, created: 0, pending: 1 },
      issues: [{ word: 'apple', kind: 'pending' }],
    });

    const retry = intake.importSpreadsheet(request('pear'));
    await vi.waitFor(() => expect(port.persistStructured).toHaveBeenCalledTimes(2));
    const retrySnapshot = intake.getSnapshot();
    expect(retrySnapshot).toMatchObject({
      isImporting: true,
      importResult: null,
      importProgress: { word: 'pear', summary: { pending: 1 } },
    });

    settlementCallbacks[0]?.(0, 'created');
    expect(intake.getSnapshot()).toEqual(retrySnapshot);

    settlementCallbacks[1]?.(0, 'created');
    secondSave.resolve({ createdCount: 1, outcomes: ['created'] });
    await expect(retry).resolves.toMatchObject({
      status: 'completed',
      summary: { total: 1, created: 1, pending: 0 },
    });
    expect(intake.getSnapshot().importResult).toMatchObject({
      status: 'completed',
      summary: { total: 1, created: 1, pending: 0 },
    });
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

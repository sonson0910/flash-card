import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardIntakePortOptions } from './cardIntakePortContract';
import { createCardIntakePipeline } from './cardIntakePipeline';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';

const generationRuntime = vi.hoisted(() => ({
  generateWordInfo: vi.fn(),
}));

const repositoryRuntime = vi.hoisted(() => ({
  createCardV2IfAbsent: vi.fn(async (...args: unknown[]) => ({
    card: args[2] as { id: string }, created: true,
    gamification: null as null | { xp: number; level: number; streak: number; studyDay: string; events: readonly ('streak' | 'levelup')[] },
  })),
}));

const createOperationIdAt = (call: readonly unknown[]) => (call[3] as { opId: string }).opId;

vi.mock('../../lib/firebase', () => ({ db: {}, isFirebaseConfigured: true }));
vi.mock('../../lib/audio', () => ({ fetchAudioUrl: vi.fn(async () => null) }));
vi.mock('../../lib/images', () => ({ fetchImageUrl: vi.fn(async () => null) }));
vi.mock('../../lib/gemini', () => ({ generateWordInfo: generationRuntime.generateWordInfo }));
vi.mock('../../lib/cardRepository', () => ({
  createCardV2IfAbsent: repositoryRuntime.createCardV2IfAbsent,
  createLibraryFacetOperationId: () => 'facet-op',
  deriveLibraryFacetOperationId: (id: string, suffix: string) => `${id}:${suffix}`,
  findCardByNormalizedWord: vi.fn(async () => null),
  findCardsByNormalizedWords: vi.fn(async () => new Map()),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  repositoryRuntime.createCardV2IfAbsent.mockClear();
});

const card = (id: string) => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `${id}-vi`,
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

const createContext = (): CardIntakePortOptions => ({
  ownerId: 'owner-a',
  libraryEpoch: 3,
  knownLibraryTotal: 0,
  cloudStats: {
    total: 0,
    reviewed: 0,
    easy: 0,
    good: 0,
    hard: 0,
    unrated: 0,
    bookmarked: 0,
    due: 0,
    legacyUnindexed: 0,
  },
  cardsPerPage: 9,
  getCards: () => [],
  publishCards: vi.fn(),
  patchCard: vi.fn(async () => undefined),
  hydrateExisting: vi.fn(),
  rememberPromoted: vi.fn(),
  resetCatalog: vi.fn(),
  resetCloudPage: vi.fn(),
  updateCloudStats: vi.fn(),
  updateCloudTotal: vi.fn(),
  updateCategoryFacets: vi.fn(async () => undefined),
  setCloudUnavailable: vi.fn(),
  notify: vi.fn(),
  focusLibrary: vi.fn(),
  acceptGamificationOutcome: vi.fn(),
});

describe('Card Intake Pipeline contract', () => {
  it('keeps React lifecycle separate from the persistence protocol', () => {
    const hookSource = readFileSync(
      fileURLToPath(new URL('./useCardIntakePort.ts', import.meta.url)),
      'utf8',
    );
    const pipelineSource = readFileSync(
      fileURLToPath(new URL('./cardIntakePipeline.ts', import.meta.url)),
      'utf8',
    );

    expect(hookSource).toContain('createCardIntakePipeline');
    expect(hookSource).toContain('replaceOwner(options.ownerId)');
    expect(hookSource).not.toMatch(/firebase|cardRepository|cardMirror|deviceSync/);
    expect(pipelineSource).not.toMatch(/from ['"]react['"]|useRef\(/);
    expect(pipelineSource).not.toMatch(/cardMirror|deviceSync/);
  });

  it('keeps one stable intent interface while the owner generation advances', () => {
    let context = createContext();
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });
    const methods = {
      findExisting: pipeline.findExisting,
      touchExisting: pipeline.touchExisting,
      generateCard: pipeline.generateCard,
      persistCards: pipeline.persistCards,
      applyMedia: pipeline.applyMedia,
      persistStructured: pipeline.persistStructured,
      generate: pipeline.generate,
      completeFlat: pipeline.completeFlat,
    };

    context = { ...context, ownerId: 'owner-b', libraryEpoch: 4 };
    pipeline.replaceOwner('owner-b');
    context = { ...context, ownerId: 'owner-a', libraryEpoch: 5 };
    pipeline.replaceOwner('owner-a');

    expect(pipeline).toMatchObject(methods);
  });

  it('publishes a new card optimistically, then confirms it against the cloud', async () => {
    const context = createContext();
    const candidate = card('queued-card');
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });

    await expect(pipeline.persistCards([candidate], 'shared')).resolves.toEqual([
      { card: candidate, created: true },
    ]);

    expect(context.publishCards).toHaveBeenCalledWith([candidate]);
    await vi.waitFor(() => expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledWith({}, 'owner-a', candidate, {
      libraryEpoch: 3,
      opId: expect.stringMatching(/^create-/),
      timeZone: expect.any(String),
    }));
  });

  it('reuses the original create operation after a lost-response retry', async () => {
    const context = createContext();
    const candidate = card('retry-card');
    const outcome = { xp: 10, level: 1, streak: 0, studyDay: '2026-09-27', events: [] as const };
    repositoryRuntime.createCardV2IfAbsent
      .mockRejectedValueOnce(new Error('response lost after the server committed'))
      .mockResolvedValueOnce({ card: candidate, created: true, gamification: outcome });
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.persistCards([candidate], 'generate')).resolves.toEqual([
      { card: candidate, created: true },
    ]);
    await vi.waitFor(() => expect(context.notify).toHaveBeenCalledWith(
      'The card could not be saved. Check your connection and try again.',
    ));
    await expect(pipeline.persistCards([candidate], 'generate')).resolves.toEqual([
      { card: candidate, created: true },
    ]);
    await vi.waitFor(() => expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledTimes(2));

    expect(createOperationIdAt(repositoryRuntime.createCardV2IfAbsent.mock.calls[1]!))
      .toBe(createOperationIdAt(repositoryRuntime.createCardV2IfAbsent.mock.calls[0]!));
    await vi.waitFor(() => expect(context.acceptGamificationOutcome).toHaveBeenCalledWith(
      outcome,
      createOperationIdAt(repositoryRuntime.createCardV2IfAbsent.mock.calls[0]!),
    ));
  });

  it('uses a new create operation after delete and recreate', async () => {
    const context = createContext();
    const first = { ...card('recreated-card'), createdAt: '2026-09-27T00:00:00.000Z' };
    const recreated = { ...card('recreated-card'), createdAt: '2026-09-27T00:01:00.000Z' };
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await pipeline.persistCards([first], 'generate');
    await vi.waitFor(() => expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledTimes(1));
    await pipeline.persistCards([recreated], 'generate');
    await vi.waitFor(() => expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledTimes(2));

    const firstOperation = createOperationIdAt(repositoryRuntime.createCardV2IfAbsent.mock.calls[0]!);
    const recreatedOperation = createOperationIdAt(repositoryRuntime.createCardV2IfAbsent.mock.calls[1]!);
    expect(recreatedOperation).not.toBe(firstOperation);
  });

  it('accepts the server outcome once for a created-card replay', async () => {
    const context = createContext();
    const candidate = card('rewarded-card');
    const outcome = { xp: 10, level: 1, streak: 0, studyDay: '2026-09-27', events: [] as const };
    repositoryRuntime.createCardV2IfAbsent.mockResolvedValueOnce({ card: candidate, created: true, gamification: outcome });
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await pipeline.persistCards([candidate], 'shared');
    await vi.waitFor(() => expect(context.acceptGamificationOutcome).toHaveBeenCalledWith(
      outcome,
      createOperationIdAt(repositoryRuntime.createCardV2IfAbsent.mock.calls[0]!),
    ));
    await pipeline.persistCards([candidate], 'shared');

    expect(context.acceptGamificationOutcome).toHaveBeenCalledOnce();
  });

  it('reveals an existing card on a refreshed first page without requiring reload', async () => {
    const existing = card('existing-card');
    const context = {
      ...createContext(),
      getCards: () => [existing],
    };
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });

    await pipeline.touchExisting(existing, '2026-08-13T03:00:00.000Z');

    expect(context.resetCatalog).toHaveBeenCalledOnce();
    expect(context.resetCloudPage).toHaveBeenCalledOnce();
    expect(context.focusLibrary).toHaveBeenCalledOnce();
  });

  it('rejects signed-out development generation before any AI call', async () => {
    vi.stubEnv('DEV', true);
    const context = { ...createContext(), ownerId: null };
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.generateCard({ term: 'opportunity', language: ENGLISH_TO_VIETNAMESE_PROFILE })).rejects.toMatchObject({
      name: 'ProtectedFunctionError',
      kind: 'authentication',
      code: 'unauthenticated',
      message: 'AI generation needs a current sign-in. Sign in again, then retry.',
    });
    expect(generationRuntime.generateWordInfo).not.toHaveBeenCalled();
  });

  it('uses verified context and deck routing for AI generation', async () => {
    generationRuntime.generateWordInfo.mockResolvedValueOnce({
      translation: 'dẫn đầu', explanation: '', explanationTranslation: '', phonetic: '/liːd/',
      emoji: '🎭', category: 'General', partOfSpeech: 'verb', cefrLevel: 'B1',
      exampleSentence: '', exampleTranslation: '', collocations: [], synonyms: [], antonyms: [],
      register: '', commonMistake: '', imageSearchQuery: 'lead actor',
    });
    const pipeline = createCardIntakePipeline({ getContext: createContext });

    const generated = await pipeline.generateCard({
      term: 'lead',
      operationId: '123e4567-e89b-42d3-a456-426614174000',
      language: ENGLISH_TO_VIETNAMESE_PROFILE,
      context: 'The lead actor arrived.',
      requestedDeck: 'Reading',
      requestedDeckAvailable: deck => deck === 'Reading',
    });

    expect(generationRuntime.generateWordInfo).toHaveBeenCalledWith('lead', {
      context: 'The lead actor arrived.',
      operationId: '123e4567-e89b-42d3-a456-426614174000',
      sourceLanguage: 'en',
      targetLanguage: 'vi',
    });
    expect(generated.card.customDeck).toBe('Reading');
    expect(generated.card.origin).toBe('ai');
  });

  it('persists captured browser-extension source metadata on the generated card without leaking it into the AI request', async () => {
    generationRuntime.generateWordInfo.mockResolvedValueOnce({
      translation: 'dẫn đầu', explanation: '', explanationTranslation: '', phonetic: '/liːd/',
      emoji: '🎭', category: 'General', partOfSpeech: 'verb', cefrLevel: 'B1',
      exampleSentence: '', exampleTranslation: '', collocations: [], synonyms: [], antonyms: [],
      register: '', commonMistake: '', imageSearchQuery: 'lead actor',
    });
    const pipeline = createCardIntakePipeline({ getContext: createContext });

    const generated = await pipeline.generateCard({
      term: 'lead',
      surface: 'extension',
      language: ENGLISH_TO_VIETNAMESE_PROFILE,
      context: 'The lead actor arrived.',
      sourceUrl: 'https://example.com/article',
      pageTitle: 'An Example Article',
      capturedAt: '2026-09-27T00:00:00.000Z',
    });

    expect(generated.card.source).toEqual({
      url: 'https://example.com/article',
      title: 'An Example Article',
      context: 'The lead actor arrived.',
      capturedAt: '2026-09-27T00:00:00.000Z',
    });
    const [, aiOptions] = generationRuntime.generateWordInfo.mock.calls[0]!;
    expect(aiOptions).not.toHaveProperty('sourceUrl');
    expect(aiOptions).not.toHaveProperty('pageTitle');
  });

  it('omits source metadata entirely for a plain in-app generation request', async () => {
    generationRuntime.generateWordInfo.mockResolvedValueOnce({
      translation: 'dẫn đầu', explanation: '', explanationTranslation: '', phonetic: '/liːd/',
      emoji: '🎭', category: 'General', partOfSpeech: 'verb', cefrLevel: 'B1',
      exampleSentence: '', exampleTranslation: '', collocations: [], synonyms: [], antonyms: [],
      register: '', commonMistake: '', imageSearchQuery: 'lead actor',
    });
    const pipeline = createCardIntakePipeline({ getContext: createContext });

    const generated = await pipeline.generateCard({ term: 'lead', language: ENGLISH_TO_VIETNAMESE_PROFILE });

    expect(generated.card.source).toBeUndefined();
  });

  it('does not touch the new owner state when a stale cloud settlement fails after an owner switch', async () => {
    const queued = deferred<void>();
    const ownerA = createContext();
    const ownerB = { ...createContext(), ownerId: 'owner-b', libraryEpoch: 4 };
    const candidate = card('late-a-card');
    let context: CardIntakePortOptions = ownerA;
    repositoryRuntime.createCardV2IfAbsent.mockImplementationOnce(async () => {
      await queued.promise;
      throw new Error('cloud write failed');
    });
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });

    const persistence = pipeline.persistCards([candidate], 'shared');
    // The optimistic publish for owner-a happens synchronously, before any owner switch can occur.
    expect(ownerA.publishCards).toHaveBeenCalledWith([candidate]);
    context = ownerB;
    pipeline.replaceOwner('owner-b');
    queued.resolve();

    await expect(persistence).resolves.toEqual([{ card: candidate, created: true }]);
    await vi.waitFor(() => expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalled());
    expect(ownerB.publishCards).not.toHaveBeenCalled();
    expect(ownerA.setCloudUnavailable).not.toHaveBeenCalled();
  });
});

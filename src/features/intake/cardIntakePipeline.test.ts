import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardIntakePortOptions } from './cardIntakePortContract';
import { createCardIntakePipeline } from './cardIntakePipeline';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import { OperationTimeoutError } from '../../lib/async';

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
  vi.useRealTimers();
  generationRuntime.generateWordInfo.mockClear();
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
      createConfirmedCatalogCards: pipeline.createConfirmedCatalogCards,
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

  it('publishes a shared card optimistically but waits for cloud confirmation', async () => {
    const context = createContext();
    const candidate = card('queued-card');
    const confirmation = deferred<{ card: typeof candidate; created: boolean; gamification: null }>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(confirmation.promise);
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });

    const persistence = pipeline.persistCards([candidate], 'shared');
    expect(context.publishCards).toHaveBeenCalledWith([candidate]);
    await vi.waitFor(() => expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledWith({}, 'owner-a', candidate, {
      libraryEpoch: 3,
      opId: expect.stringMatching(/^create-/),
      timeZone: expect.any(String),
    }));
    let finished = false;
    void persistence.then(() => { finished = true; });
    expect(finished).toBe(false);
    confirmation.resolve({ card: candidate, created: true, gamification: null });
    await expect(persistence).resolves.toEqual([{ card: candidate, created: true }]);
  });

  it('bounds concurrent shared-card creates while preserving the full batch', async () => {
    const context = createContext();
    const candidates = [card('shared-one'), card('shared-two'), card('shared-three')];
    const confirmations = candidates.map(candidate =>
      deferred<{ card: typeof candidate; created: boolean; gamification: null }>());
    confirmations.forEach(confirmation => {
      repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(confirmation.promise);
    });
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const persistence = pipeline.persistCards(candidates, 'shared');
    expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledTimes(2);
    confirmations[0]!.resolve({ card: candidates[0]!, created: true, gamification: null });
    await vi.waitFor(() => expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledTimes(3));
    confirmations[1]!.resolve({ card: candidates[1]!, created: true, gamification: null });
    confirmations[2]!.resolve({ card: candidates[2]!, created: true, gamification: null });
    await expect(persistence).resolves.toEqual(candidates.map(candidate => ({ card: candidate, created: true })));
  });

  it('rejects a shared save when cloud confirmation fails', async () => {
    const context = createContext();
    const candidate = card('failed-shared-card');
    repositoryRuntime.createCardV2IfAbsent.mockRejectedValueOnce(new Error('cloud write failed'));
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.persistCards([candidate], 'shared')).rejects.toThrow(
      'Some shared cards could not be confirmed.',
    );
    expect(context.publishCards).toHaveBeenLastCalledWith([]);
  });

  it('reports a shared card as reused when the server already has it', async () => {
    const context = createContext();
    const candidate = card('shared-duplicate');
    repositoryRuntime.createCardV2IfAbsent.mockResolvedValueOnce({
      card: candidate,
      created: false,
      gamification: null,
    });
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.persistCards([candidate], 'shared')).resolves.toEqual([
      { card: candidate, created: false },
    ]);
  });

  it('waits for every canonical catalog create before publishing authoritative cards once', async () => {
    const context = createContext();
    const first = { ...card('catalog-first'), lexemeId: 'lexeme-first' };
    const second = { ...card('catalog-second'), lexemeId: 'lexeme-second' };
    const firstResult = deferred<{ card: typeof first; created: boolean; gamification: null }>();
    const secondResult = deferred<{ card: typeof second; created: boolean; gamification: null }>();
    repositoryRuntime.createCardV2IfAbsent
      .mockReturnValueOnce(firstResult.promise)
      .mockReturnValueOnce(secondResult.promise);
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const creation = pipeline.createConfirmedCatalogCards([first, second]);
    expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledTimes(2);
    expect(context.publishCards).not.toHaveBeenCalled();
    firstResult.resolve({ card: { ...first, translation: 'authoritative first' }, created: true, gamification: null });
    await Promise.resolve();
    expect(context.publishCards).not.toHaveBeenCalled();
    secondResult.resolve({ card: { ...second, translation: 'authoritative second' }, created: false, gamification: null });

    await expect(creation).resolves.toEqual({
      status: 'completed',
      cards: [
        { ...first, translation: 'authoritative first' },
        { ...second, translation: 'authoritative second' },
      ],
      createdCount: 1,
      reusedCount: 1,
    });
    expect(context.publishCards).toHaveBeenCalledTimes(1);
    expect(context.publishCards).toHaveBeenCalledWith([
      { ...first, translation: 'authoritative first' },
      { ...second, translation: 'authoritative second' },
    ]);
    expect(context.updateCloudStats).toHaveBeenCalledTimes(1);
    expect(context.updateCategoryFacets).toHaveBeenCalledTimes(1);
    expect(context.resetCatalog).toHaveBeenCalledTimes(1);
    expect(context.resetCloudPage).toHaveBeenCalledTimes(1);
  });

  it('returns a partial catalog result only after all canonical creates settle', async () => {
    const context = createContext();
    const rejected = { ...card('catalog-rejected'), lexemeId: 'lexeme-rejected' };
    const confirmed = { ...card('catalog-confirmed'), lexemeId: 'lexeme-confirmed' };
    repositoryRuntime.createCardV2IfAbsent
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ card: confirmed, created: true, gamification: null });
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.createConfirmedCatalogCards([rejected, confirmed])).resolves.toEqual({
      status: 'partial', cards: [confirmed], failedCount: 1,
    });
    expect(context.publishCards).toHaveBeenCalledTimes(1);
    expect(context.updateCategoryFacets).toHaveBeenCalledTimes(1);
  });

  it('returns stale without publishing when the owner changes during catalog confirmation', async () => {
    const ownerA = createContext();
    const ownerB = createContext();
    ownerB.ownerId = 'owner-b';
    let context = ownerA;
    const candidate = { ...card('catalog-stale'), lexemeId: 'lexeme-stale' };
    const confirmation = deferred<{ card: typeof candidate; created: boolean; gamification: null }>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(confirmation.promise);
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const creation = pipeline.createConfirmedCatalogCards([candidate]);
    context = ownerB;
    pipeline.replaceOwner('owner-b');
    confirmation.resolve({ card: candidate, created: true, gamification: null });

    await expect(creation).resolves.toEqual({ status: 'stale' });
    expect(ownerA.publishCards).not.toHaveBeenCalled();
    expect(ownerB.publishCards).not.toHaveBeenCalled();
  });

  it('does not publish old-generation catalog cards after the library epoch advances', async () => {
    let context = createContext();
    const previous = context;
    const candidate = { ...card('catalog-cleared'), lexemeId: 'lexeme-cleared' };
    const confirmation = deferred<{ card: typeof candidate; created: boolean; gamification: null }>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(confirmation.promise);
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const creation = pipeline.createConfirmedCatalogCards([candidate]);
    context = { ...context, libraryEpoch: 4 };
    confirmation.resolve({ card: candidate, created: true, gamification: null });

    await expect(creation).resolves.toEqual({ status: 'stale' });
    expect(previous.publishCards).not.toHaveBeenCalled();
    expect(context.publishCards).not.toHaveBeenCalled();
    expect(context.updateCloudStats).not.toHaveBeenCalled();
    expect(context.updateCategoryFacets).not.toHaveBeenCalled();
  });

  it('returns confirmed structured save outcomes, including already-present patches', async () => {
    const context = createContext();
    const candidate = card('structured-created');
    const existing = card('structured-existing');
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    const settlements: Array<[number, string]> = [];

    repositoryRuntime.createCardV2IfAbsent.mockResolvedValueOnce({
      card: candidate,
      created: true,
      gamification: null,
    });

    await expect(pipeline.persistStructured({
      creates: [candidate],
      patches: [{ card: existing, fields: { translation: 'đã cập nhật' } }],
    }, (index, outcome) => settlements.push([index, outcome]))).resolves.toEqual({
      createdCount: 1,
      outcomes: ['created', 'reused'],
    });

    expect(settlements).toEqual([[0, 'created'], [1, 'reused']]);
  });

  it('reports a server deduplication as reused for a structured create', async () => {
    const context = createContext();
    const candidate = card('structured-reused');
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    repositoryRuntime.createCardV2IfAbsent.mockResolvedValueOnce({
      card: candidate,
      created: false,
      gamification: null,
    });

    await expect(pipeline.persistStructured({ creates: [candidate], patches: [] })).resolves.toEqual({
      createdCount: 0,
      outcomes: ['reused'],
    });
  });

  it('keeps a timed-out structured save pending even if its callable succeeds later', async () => {
    vi.useFakeTimers();
    const context = createContext();
    const candidate = card('structured-pending');
    const cloud = deferred<{ card: typeof candidate; created: boolean; gamification: null }>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(cloud.promise);
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const persistence = pipeline.persistStructured({ creates: [candidate], patches: [] });
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(persistence).resolves.toEqual({
      createdCount: 0,
      outcomes: ['pending'],
    });
    cloud.resolve({ card: candidate, created: true, gamification: null });
    await Promise.resolve();
  });

  it('classifies definitive and timed-out structured patches without treating either as reused', async () => {
    const context = createContext();
    const first = card('patch-failed');
    const second = card('patch-pending');
    context.patchCard = vi.fn()
      .mockRejectedValueOnce(new Error('patch rejected'))
      .mockRejectedValueOnce(new OperationTimeoutError('patch timed out'));
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.persistStructured({
      creates: [],
      patches: [
        { card: first, fields: { translation: 'x' } },
        { card: second, fields: { translation: 'y' } },
      ],
    })).resolves.toEqual({
      createdCount: 0,
      outcomes: ['failed', 'pending'],
    });
  });

  it('returns an optimistic generated card with its authoritative settlement promise', async () => {
    const context = createContext();
    const candidate = card('flat-created');
    const cloud = deferred<{ card: typeof candidate; created: boolean; gamification: null }>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(cloud.promise);
    generationRuntime.generateWordInfo.mockResolvedValueOnce({
      translation: candidate.translation,
      explanation: '', explanationTranslation: '', phonetic: '', emoji: '📝', category: 'General',
      partOfSpeech: '', cefrLevel: '', exampleSentence: '', exampleTranslation: '', collocations: [],
      synonyms: [], antonyms: [], register: '', commonMistake: '', imageSearchQuery: '',
    });
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const generated = await pipeline.generate(candidate.word, 0);

    expect(generated.created).toBe(true);
    cloud.resolve({ card: candidate, created: true, gamification: null });
    await expect(generated.settlement).resolves.toBe('created');
  });

  it('keeps a flat generated save pending after timeout when its callable later succeeds', async () => {
    vi.useFakeTimers();
    const context = createContext();
    const candidate = card('flat-pending');
    const cloud = deferred<{ card: typeof candidate; created: boolean; gamification: null }>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(cloud.promise);
    generationRuntime.generateWordInfo.mockResolvedValueOnce({
      translation: candidate.translation,
      explanation: '', explanationTranslation: '', phonetic: '', emoji: '📝', category: 'General',
      partOfSpeech: '', cefrLevel: '', exampleSentence: '', exampleTranslation: '', collocations: [],
      synonyms: [], antonyms: [], register: '', commonMistake: '', imageSearchQuery: '',
    });
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    const generated = await pipeline.generate(candidate.word, 0);
    const settlements: string[] = [];
    if (!generated.settlement) throw new Error('Expected a settlement promise.');
    void generated.settlement.then(outcome => settlements.push(outcome));

    await vi.advanceTimersByTimeAsync(8_000);
    await expect(generated.settlement).resolves.toBe('pending');
    expect(settlements).toEqual(['pending']);

    cloud.resolve({ card: candidate, created: true, gamification: null });
    await Promise.resolve();
    expect(settlements).toEqual(['pending']);
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

    await expect(persistence).rejects.toThrow('Some shared cards could not be confirmed.');
    await vi.waitFor(() => expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalled());
    expect(ownerB.publishCards).not.toHaveBeenCalled();
    expect(ownerA.setCloudUnavailable).not.toHaveBeenCalled();
  });
});

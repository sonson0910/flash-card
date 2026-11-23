import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardIntakePortOptions } from './cardIntakePortContract';
import type { CardData } from '../../types/card';
import { createCardIntakePipeline } from './cardIntakePipeline';
import { createCardIntakeController, type CardIntakeControllerPort } from './cardIntakeController';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import { languageProfileForPair } from '../courses/courseLanguageProfile';
import { createTargetAwareCardId, createWordCardId } from '../../lib/cardIdentity';
import { OperationTimeoutError } from '../../lib/async';
import { createSpreadsheetImportService } from '../importExport/spreadsheetImportService';
import { createLearningStateController, type LearningStateMutation } from '../learning/learningStateController';

const generationRuntime = vi.hoisted(() => ({
  generateWordInfo: vi.fn(),
  cancelWordInfoGeneration: vi.fn(),
}));

const repositoryRuntime = vi.hoisted(() => ({
  createCardV2IfAbsent: vi.fn(async (...args: unknown[]) => ({
    card: args[2] as { id: string }, created: true,
    gamification: null as null | { xp: number; level: number; streak: number; studyDay: string; events: readonly ('streak' | 'levelup')[] },
  })),
  findCardByNormalizedWord: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null),
  findCardsByNormalizedWords: vi.fn(async () => new Map()),
  createLibraryFacetOperationId: vi.fn(() => 'facet-op'),
}));

const createOperationIdAt = (call: readonly unknown[]) => (call[3] as { opId: string }).opId;

vi.mock('../../lib/firebase', () => ({ db: {}, isFirebaseConfigured: true }));
vi.mock('../../lib/audio', () => ({ fetchAudioUrl: vi.fn(async () => null) }));
vi.mock('../../lib/images', () => ({ fetchImageUrl: vi.fn(async () => null) }));
vi.mock('../../lib/gemini', () => ({
  generateWordInfo: generationRuntime.generateWordInfo,
  cancelWordInfoGeneration: generationRuntime.cancelWordInfoGeneration,
  PART_OF_SPEECH_HINTS: ['noun', 'verb', 'adjective', 'adverb'],
}));
vi.mock('../../lib/cardRepository', () => ({
  createCardV2IfAbsent: repositoryRuntime.createCardV2IfAbsent,
  createLibraryFacetOperationId: repositoryRuntime.createLibraryFacetOperationId,
  deriveLibraryFacetOperationId: (id: string, suffix: string) => `${id}:${suffix}`,
  findCardByNormalizedWord: repositoryRuntime.findCardByNormalizedWord,
  findCardsByNormalizedWords: repositoryRuntime.findCardsByNormalizedWords,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  generationRuntime.generateWordInfo.mockClear();
  generationRuntime.cancelWordInfoGeneration.mockClear();
  repositoryRuntime.createCardV2IfAbsent.mockClear();
  repositoryRuntime.findCardByNormalizedWord.mockClear();
  repositoryRuntime.findCardsByNormalizedWords.mockClear();
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
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
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
  forgetPromoted: vi.fn(),
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

  it('looks up ordinary explicit target-language cards by their target-aware identity', async () => {
    const context = createContext();
    const korean = { ...card('bank'), id: 'word-ko-bank', language: 'ko', translationLanguage: 'vi' };
    repositoryRuntime.findCardByNormalizedWord.mockResolvedValueOnce(korean);
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.findExisting([{
      word: 'bank', normalizedWord: 'bank', language: 'ko',
    }])).resolves.toEqual(new Map([['target:ko:bank', korean]]));

    expect(repositoryRuntime.findCardByNormalizedWord).toHaveBeenCalledWith(
      {}, 'owner-a', expect.objectContaining({ word: 'bank', language: 'ko' }), 3,
    );
  });

  describe('with a non-English course active', () => {
    const englishBank = { ...card('bank'), id: 'word-bank', libraryEpoch: 3 } as CardData;
    const koreanBank = {
      ...card('bank'), id: 'word-ko-bank', language: 'ko', translationLanguage: 'vi', libraryEpoch: 3,
    } as CardData;
    const koreanContext = (cards: CardData[]): CardIntakePortOptions => ({
      ...createContext(), languageProfile: languageProfileForPair('ko', 'vi'), getCards: () => cards,
    });

    it('asks the library for cards of the active target language only', async () => {
      const pipeline = createCardIntakePipeline({ getContext: () => koreanContext([]) });

      await pipeline.findExisting(['Bank']);

      expect(repositoryRuntime.findCardsByNormalizedWords).toHaveBeenCalledWith({}, 'owner-a', ['bank'], 3, 'ko');
    });

    it('does not take a same-spelling card of another course for the word', async () => {
      const pipeline = createCardIntakePipeline({ getContext: () => koreanContext([englishBank]) });

      await expect(pipeline.findExisting(['Bank'])).resolves.toEqual(new Map());
    });

    it('still finds the card of the active course among same-spelling cards', async () => {
      const pipeline = createCardIntakePipeline({ getContext: () => koreanContext([englishBank, koreanBank]) });

      await expect(pipeline.findExisting(['Bank'])).resolves.toEqual(new Map([['bank', koreanBank]]));
    });

    it('imports a flat word as a new card instead of reusing the other course card', async () => {
      const context = koreanContext([englishBank]);
      const pipeline = createCardIntakePipeline({ getContext: () => context });
      const generate = vi.fn(async () => ({ created: true, category: 'General' }));
      const service = createSpreadsheetImportService({
        cards: {
          findExisting: pipeline.findExisting, touchExisting: pipeline.touchExisting,
          generate, completeFlat: vi.fn(async () => undefined), persistStructured: vi.fn(),
        },
        feedback: { start: vi.fn(), clearError: vi.fn(), progress: vi.fn(), error: vi.fn(), finish: vi.fn(), resetSource: vi.fn() },
        delay: async () => undefined,
      });

      const result = await service.import({
        sizeBytes: 10,
        loadWorkbook: async () => ({ hasStructuredHeader: false, structuredRows: [], flatRows: [['Bank']] }) as never,
      });

      expect(generate).toHaveBeenCalledWith('Bank', 0);
      expect(result.summary).toMatchObject({ created: 1, reused: 0 });
      expect(context.notify).not.toHaveBeenCalledWith(expect.stringContaining('already in your library'));
      expect(context.publishCards).not.toHaveBeenCalled();
    });
  });

  it('keeps legacy default-English lookups on the bulk word path', async () => {
    const context = createContext();
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.findExisting(['bank'])).resolves.toEqual(new Map());

    expect(repositoryRuntime.findCardsByNormalizedWords).toHaveBeenCalledWith({}, 'owner-a', ['bank'], 3);
    expect(repositoryRuntime.findCardByNormalizedWord).not.toHaveBeenCalled();
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
    try {
      expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledTimes(1);
      confirmations[0]!.resolve({ card: candidates[0]!, created: true, gamification: null });
      await vi.waitFor(() => expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledTimes(2));
      confirmations[1]!.resolve({ card: candidates[1]!, created: true, gamification: null });
      await vi.waitFor(() => expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledTimes(3));
      confirmations[2]!.resolve({ card: candidates[2]!, created: true, gamification: null });
      await expect(persistence).resolves.toEqual(candidates.map(candidate => ({ card: candidate, created: true })));
    } finally {
      confirmations.forEach((confirmation, index) => confirmation.resolve({
        card: candidates[index]!, created: true, gamification: null,
      }));
      await persistence;
    }
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

  it('stops pinning a generated card to page 1 when its save fails', async () => {
    const context = createContext();
    const candidate = card('unsaved-generated-card');
    repositoryRuntime.createCardV2IfAbsent.mockRejectedValueOnce(new Error('cloud write failed'));
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await pipeline.persistCards([candidate], 'generate');

    expect(vi.mocked(context.rememberPromoted).mock.calls[0]?.[0]).toEqual(candidate);
    await vi.waitFor(() => expect(context.notify).toHaveBeenCalledWith(
      'The card could not be saved. Check your connection and try again.',
    ));
    expect(context.forgetPromoted).toHaveBeenCalledWith(candidate);
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
    expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledTimes(1);
    expect(context.publishCards).not.toHaveBeenCalled();
    firstResult.resolve({ card: { ...first, translation: 'authoritative first' }, created: true, gamification: null });
    await vi.waitFor(() => expect(repositoryRuntime.createCardV2IfAbsent).toHaveBeenCalledTimes(2));
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

  it('leaves the deck of a word that already exists alone when a spreadsheet row names another deck', async () => {
    const context = createContext();
    const candidate = { ...card('structured-existing-deck'), customDeck: 'Imported' };
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    repositoryRuntime.createCardV2IfAbsent.mockResolvedValueOnce({
      card: { ...candidate, customDeck: 'Travel' } as { id: string },
      created: false,
      gamification: null,
    });

    await expect(pipeline.persistStructured({ creates: [candidate], patches: [] })).resolves.toEqual({
      createdCount: 0,
      outcomes: ['reused'],
    });
    expect(context.patchCard).not.toHaveBeenCalledWith(candidate.id, { customDeck: 'Imported' }, expect.anything());
  });

  it('counts starred and already rated spreadsheet cards in the library totals straight away', async () => {
    const context = createContext();
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    const creates = [
      { ...card('structured-starred'), bookmarked: true, difficulty: 'easy' as const },
      { ...card('structured-plain'), difficulty: 'unrated' as const },
      card('structured-untouched'),
    ];

    await pipeline.persistStructured({ creates, patches: [] });

    const update = vi.mocked(context.updateCloudStats).mock.calls[0]![0];
    expect(update(context.cloudStats)).toMatchObject({ total: 3, unrated: 2, bookmarked: 1 });
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
      partOfSpeechHint: 'verb',
      requestedDeck: 'Reading',
      requestedDeckAvailable: deck => deck === 'Reading',
    });

    expect(generationRuntime.generateWordInfo).toHaveBeenCalledWith('lead', {
      context: 'The lead actor arrived.',
      partOfSpeech: 'verb',
      operationId: '123e4567-e89b-42d3-a456-426614174000',
      expectedOwnerId: 'owner-a',
      sourceLanguage: 'en',
      targetLanguage: 'vi',
    });
    expect(generated.card.customDeck).toBe('Reading');
    expect(generated.card.origin).toBe('ai');
  });

  it('gives a generated card the id its course language is stored under', async () => {
    const wordInfo = {
      translation: 'quả táo', explanation: '', explanationTranslation: '', phonetic: '',
      emoji: '🍎', category: 'Food', partOfSpeech: 'noun', cefrLevel: '',
      exampleSentence: '', exampleTranslation: '', collocations: [], synonyms: [], antonyms: [],
      register: '', commonMistake: '', imageSearchQuery: '',
    };
    generationRuntime.generateWordInfo.mockResolvedValue(wordInfo);
    const pipeline = createCardIntakePipeline({ getContext: createContext });

    const korean = await pipeline.generateCard({ term: '사과', language: languageProfileForPair('ko', 'vi') });
    const japanese = await pipeline.generateCard({ term: 'bank', language: languageProfileForPair('ja', 'vi') });
    const english = await pipeline.generateCard({ term: 'bank', language: ENGLISH_TO_VIETNAMESE_PROFILE });

    expect(korean.card).toMatchObject({ language: 'ko', id: createTargetAwareCardId('사과', 'ko') });
    expect(japanese.card).toMatchObject({ language: 'ja', id: createTargetAwareCardId('bank', 'ja') });
    expect(japanese.card.id).not.toBe('word-bank');
    // English cards keep the id shape already stored in every library.
    expect(english.card.id).toBe('word-bank');
    generationRuntime.generateWordInfo.mockReset();
  });

  it('patches late media onto the id a non-English card was created under', async () => {
    const context = createContext();
    generationRuntime.generateWordInfo.mockResolvedValueOnce({
      translation: 'quả táo', explanation: '', explanationTranslation: '', phonetic: '',
      emoji: '🍎', category: 'Food', partOfSpeech: 'noun', cefrLevel: '',
      exampleSentence: '', exampleTranslation: '', collocations: [], synonyms: [], antonyms: [],
      register: '', commonMistake: '', imageSearchQuery: '',
    });
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    const generated = await pipeline.generateCard({ term: '사과', language: languageProfileForPair('ko', 'vi') });
    const storedId = createTargetAwareCardId('사과', 'ko');
    // The service stores a non-English card under its target-aware id whatever id the request carried.
    repositoryRuntime.createCardV2IfAbsent.mockImplementationOnce(async (...args: unknown[]) => ({
      card: { ...(args[2] as { id: string }), id: storedId }, created: true, gamification: null,
    }));

    const [persisted] = await pipeline.persistCards([generated.card], 'generate');
    await pipeline.applyMedia(persisted!.card, { audioUrl: null, imageUrl: 'https://images.example/apple.jpg' });

    expect(vi.mocked(context.patchCard)).toHaveBeenCalledWith(
      storedId,
      { audioUrl: null, imageUrl: 'https://images.example/apple.jpg' },
      expect.objectContaining({ id: storedId }),
    );
  });

  describe('late media for a card that was just created', () => {
    const created = (candidate: CardData, epoch: number): { card: CardData; created: true; gamification: null } => ({
      card: { ...candidate, libraryEpoch: epoch, revision: 1 }, created: true, gamification: null,
    });

    it('patches with the card as stored, so the patch carries the epoch and revision it was created under', async () => {
      const context = { ...createContext(), libraryEpoch: 1 };
      const pipeline = createCardIntakePipeline({ getContext: () => context });
      const candidate = card('attention');
      repositoryRuntime.createCardV2IfAbsent.mockImplementationOnce(async (...args: unknown[]) => created(args[2] as CardData, 1));

      const [persisted] = await pipeline.persistCards([candidate], 'generate');
      await pipeline.applyMedia(persisted!.card, { audioUrl: 'https://audio.example/attention.mp3', imageUrl: null });

      const [, fields, source] = vi.mocked(context.patchCard).mock.calls[0]!;
      expect(source).toMatchObject({ id: candidate.id, libraryEpoch: 1, revision: 1 });

      // The learning state builds its precondition from that source: it must not be the unsaved epoch 0, revision 0.
      const persistedMutations: LearningStateMutation[] = [];
      const controller = createLearningStateController({
        port: {
          activeOwner: () => 'owner-a',
          activeOwnerId: () => 'owner-a',
          findCard: () => source as CardData,
          persist: async mutation => {
            persistedMutations.push(mutation);
            return { ownerKey: 'owner-a', operationId: mutation.operationId, publication: mutation.publication };
          },
        },
        snapshots: { library: { apply: () => undefined }, practice: { apply: () => undefined } },
      });
      await controller.patch(candidate.id, fields as Partial<CardData>, Object.keys(fields) as Array<keyof CardData>, 'op-media');
      expect(persistedMutations[0]).toMatchObject({ operation: 'patch', libraryEpoch: 1, baseRevision: 1 });
    });

    it('waits for the save to settle before patching a card that is still being created', async () => {
      const context = { ...createContext(), libraryEpoch: 1 };
      const pipeline = createCardIntakePipeline({ getContext: () => context });
      const candidate = card('attention');
      const stored = deferred<{ card: CardData; created: boolean; gamification: null }>();
      repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(stored.promise);

      const [persisted] = await pipeline.persistCards([candidate], 'generate');
      const applied = pipeline.applyMedia(persisted!.card, { audioUrl: 'https://audio.example/attention.mp3', imageUrl: null });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(context.patchCard).not.toHaveBeenCalled();

      stored.resolve(created(candidate, 1));
      await applied;
      expect(context.patchCard).toHaveBeenCalledWith(
        candidate.id,
        { audioUrl: 'https://audio.example/attention.mp3', imageUrl: null },
        expect.objectContaining({ libraryEpoch: 1, revision: 1 }),
      );
    });

    it('does not patch a card whose save failed', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const context = { ...createContext(), libraryEpoch: 1 };
      const pipeline = createCardIntakePipeline({ getContext: () => context });
      repositoryRuntime.createCardV2IfAbsent.mockRejectedValueOnce(new Error('offline'));

      const [persisted] = await pipeline.persistCards([card('attention')], 'generate');
      await pipeline.applyMedia(persisted!.card, { audioUrl: 'https://audio.example/attention.mp3', imageUrl: null });

      expect(context.patchCard).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  it('moves the shown card to the id the service stored it under when an earlier claim on the word decides it', async () => {
    // A word that was once the new headword of a renamed card stays claimed by that card id,
    // so the service stores the recaptured word there rather than under the id derived from the word.
    const candidate = card('attention');
    const storedId = 'word-focus';
    let shown: CardData[] = [];
    const context: CardIntakePortOptions = {
      ...createContext(),
      getCards: () => shown,
      publishCards: vi.fn((next: CardData[]) => { shown = next; }),
    };
    const stored = deferred<{ card: CardData; created: boolean; gamification: null }>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(stored.promise);
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const [persisted] = await pipeline.persistCards([candidate], 'generate');
    expect(shown.map(value => value.id)).toEqual([candidate.id]);
    stored.resolve({ card: { ...candidate, id: storedId, revision: 1 }, created: true, gamification: null });
    await vi.waitFor(() => expect(shown.map(value => value.id)).toEqual([storedId]));

    expect(vi.mocked(context.rememberPromoted)).toHaveBeenLastCalledWith(expect.objectContaining({ id: storedId, word: candidate.word }));
    await pipeline.applyMedia(persisted!.card, { audioUrl: 'https://audio.example/attention.mp3', imageUrl: null });
    expect(vi.mocked(context.patchCard)).toHaveBeenCalledWith(
      storedId,
      { audioUrl: 'https://audio.example/attention.mp3', imageUrl: null },
      expect.objectContaining({ id: storedId }),
    );
  });

  it('keeps a non-English card that is still stored under the earlier word-only id as the one card for its word', async () => {
    const earlier = { ...card('사과'), id: createWordCardId('사과'), language: 'ko', revision: 4 };
    const candidate = { ...card('사과'), id: createTargetAwareCardId('사과', 'ko'), language: 'ko' };
    expect(candidate.id).not.toBe(earlier.id);
    let shown: CardData[] = [];
    const context: CardIntakePortOptions = {
      ...createContext(),
      getCards: () => shown,
      publishCards: vi.fn((next: CardData[]) => { shown = next; }),
    };
    repositoryRuntime.createCardV2IfAbsent.mockResolvedValueOnce({ card: earlier, created: false, gamification: null });
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await pipeline.persistCards([candidate], 'generate');

    await vi.waitFor(() => expect(shown.map(value => value.id)).toEqual([earlier.id]));
    expect(vi.mocked(context.patchCard)).toHaveBeenCalledWith(earlier.id, expect.anything(), expect.objectContaining({ id: earlier.id }));
  });

  it('replaces the card shown at once with the card already on the page when the word is held under another id', async () => {
    // A library written before non-English ids carried the language still holds this word under
    // its word-only id, and that card is already on the page the learner is looking at.
    const earlier = { ...card('사과'), id: createWordCardId('사과'), language: 'ko', partOfSpeech: 'noun', revision: 4, libraryEpoch: 3 };
    const candidate = { ...card('사과'), id: createTargetAwareCardId('사과', 'ko'), language: 'ko' };
    // The list the port reads only changes when the app renders again, as in the running app.
    let rendered: CardData[] = [earlier];
    let stats = { ...createContext().cloudStats, total: 1, unrated: 1 };
    const publishCards = vi.fn<(next: CardData[]) => void>();
    const context: CardIntakePortOptions = {
      ...createContext(),
      getCards: () => rendered,
      publishCards,
      updateCloudStats: vi.fn(update => { stats = typeof update === 'function' ? update(stats) : update; }),
    };
    const stored = deferred<{ card: CardData; created: boolean; gamification: null }>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(stored.promise);
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const [persisted] = await pipeline.persistCards([candidate], 'generate');
    rendered = publishCards.mock.calls.at(-1)![0];
    expect(rendered.map(value => value.id)).toEqual([candidate.id, earlier.id]);
    expect(stats.total).toBe(2);
    stored.resolve({ card: earlier, created: false, gamification: null });

    await vi.waitFor(() => expect(publishCards.mock.calls.at(-1)![0].map(value => value.id)).toEqual([earlier.id]));
    expect(stats).toMatchObject({ total: 1, unrated: 1 });
    expect(vi.mocked(context.updateCategoryFacets)).toHaveBeenLastCalledWith({ General: -1 }, expect.stringMatching(/^facet-op:create-.+:duplicate$/));
    expect(vi.mocked(context.rememberPromoted)).toHaveBeenLastCalledWith(expect.objectContaining({ id: earlier.id }));
    // Media that arrives afterwards follows the stored card, as it does for a word held under the same id.
    await pipeline.applyMedia(persisted!.card, { audioUrl: null, imageUrl: 'https://images.example/apple.jpg' });
    expect(vi.mocked(context.patchCard)).toHaveBeenLastCalledWith(
      earlier.id,
      { audioUrl: null, imageUrl: 'https://images.example/apple.jpg' },
      expect.objectContaining({ id: earlier.id }),
    );
    expect(vi.mocked(context.patchCard)).not.toHaveBeenCalledWith(candidate.id, expect.anything(), expect.anything());
  });

  it('drops the card shown at once when the page already holds a newer copy of the stored card', async () => {
    const earlier = { ...card('사과'), id: createWordCardId('사과'), language: 'ko', revision: 6, libraryEpoch: 3 };
    const candidate = { ...card('사과'), id: createTargetAwareCardId('사과', 'ko'), language: 'ko' };
    let rendered: CardData[] = [earlier];
    const publishCards = vi.fn<(next: CardData[]) => void>();
    const context: CardIntakePortOptions = { ...createContext(), getCards: () => rendered, publishCards };
    const stored = deferred<{ card: CardData; created: boolean; gamification: null }>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(stored.promise);
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await pipeline.persistCards([candidate], 'generate');
    rendered = publishCards.mock.calls.at(-1)![0];
    // The answer was read before an edit the page already shows.
    stored.resolve({ card: { ...earlier, revision: 5 }, created: false, gamification: null });

    await vi.waitFor(() => expect(publishCards.mock.calls.at(-1)![0]).toEqual([earlier]));
    expect(vi.mocked(context.rememberPromoted)).toHaveBeenLastCalledWith(earlier);
  });

  it('replaces the card shown at once with the stored card when the service answers that the word already exists under the same id', async () => {
    const candidate = { ...card('apple'), id: createWordCardId('apple') };
    const stored = { ...candidate, reviews: 5, revision: 3, libraryEpoch: 3, difficulty: 'good' as const } as CardData;
    let shown: CardData[] = [];
    let stats = { ...createContext().cloudStats };
    const context: CardIntakePortOptions = {
      ...createContext(),
      getCards: () => shown,
      publishCards: vi.fn((next: CardData[]) => { shown = next; }),
      updateCloudStats: vi.fn(update => { stats = typeof update === 'function' ? update(stats) : update; }),
    };
    repositoryRuntime.createCardV2IfAbsent.mockResolvedValueOnce({ card: stored, created: false, gamification: null });
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await pipeline.persistCards([candidate], 'generate');

    await vi.waitFor(() => expect(shown).toEqual([expect.objectContaining({ id: stored.id, reviews: 5, revision: 3, difficulty: 'good' })]));
    expect(stats).toMatchObject({ total: 0, unrated: 0 });
    expect(vi.mocked(context.updateCategoryFacets)).toHaveBeenLastCalledWith({ General: -1 }, expect.stringMatching(/:duplicate$/));
  });

  it('takes back each duplicate in a batch under its own compensation id', async () => {
    let shown: CardData[] = [];
    const context: CardIntakePortOptions = {
      ...createContext(),
      getCards: () => shown,
      publishCards: vi.fn((next: CardData[]) => { shown = next; }),
    };
    repositoryRuntime.createCardV2IfAbsent.mockImplementation(async (...args: unknown[]) => ({
      card: args[2] as CardData, created: false, gamification: null,
    }));
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await pipeline.persistCards([card('apple'), card('pear')], 'shared');

    const compensations = vi.mocked(context.updateCategoryFacets).mock.calls
      .filter(([, operationId]) => String(operationId).endsWith(':duplicate'));
    expect(compensations).toHaveLength(2);
    expect(new Set(compensations.map(([, operationId]) => operationId)).size).toBe(2);
    repositoryRuntime.createCardV2IfAbsent.mockImplementation(async (...args: unknown[]) => ({
      card: args[2] as { id: string }, created: true, gamification: null,
    }));
  });

  it('takes back the optimistic counts and category facet of a card the service refused', async () => {
    let stats = { ...createContext().cloudStats };
    const context: CardIntakePortOptions = {
      ...createContext(),
      updateCloudStats: vi.fn(update => { stats = typeof update === 'function' ? update(stats) : update; }),
    };
    repositoryRuntime.createCardV2IfAbsent
      .mockRejectedValueOnce(new Error('The card limit was reached.'))
      .mockImplementationOnce(async (...args: unknown[]) => ({ card: args[2] as { id: string }, created: true, gamification: null }));
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const result = await pipeline.persistStructured({
      creates: [{ ...card('apple'), bookmarked: true } as CardData, card('pear') as CardData],
      patches: [],
    });

    expect(result.outcomes).toEqual(['failed', 'created']);
    expect(stats).toMatchObject({ total: 1, unrated: 1, bookmarked: 0 });
    const facetCalls = vi.mocked(context.updateCategoryFacets).mock.calls;
    expect(facetCalls.reduce((net, [delta]) => net + (delta.General ?? 0), 0)).toBe(1);
    const failedCompensation = facetCalls.filter(([, operationId]) => String(operationId).endsWith(':failed'));
    expect(failedCompensation).toHaveLength(1);
  });

  it('counts a retried refusal again instead of reusing the compensation id of the first attempt', async () => {
    const context = createContext();
    repositoryRuntime.createCardV2IfAbsent.mockRejectedValue(new Error('offline'));
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    const candidate = card('apple') as CardData;
    repositoryRuntime.createLibraryFacetOperationId.mockReturnValueOnce('facet-first').mockReturnValueOnce('facet-second');

    await pipeline.persistCards([candidate], 'generate');
    await vi.waitFor(() => expect(vi.mocked(context.setCloudUnavailable)).toHaveBeenCalledTimes(1));
    await pipeline.persistCards([candidate], 'generate');
    await vi.waitFor(() => expect(vi.mocked(context.setCloudUnavailable)).toHaveBeenCalledTimes(2));

    const operationIds = vi.mocked(context.updateCategoryFacets).mock.calls
      .filter(([, operationId]) => String(operationId).endsWith(':failed'))
      .map(([, operationId]) => operationId);
    expect(operationIds).toHaveLength(2);
    expect(new Set(operationIds).size).toBe(2);
    repositoryRuntime.createCardV2IfAbsent.mockReset();
    repositoryRuntime.createCardV2IfAbsent.mockImplementation(async (...args: unknown[]) => ({
      card: args[2] as { id: string }, created: true, gamification: null,
    }));
  });

  it('does not reload the library page for a card the service refused', async () => {
    const context = createContext();
    repositoryRuntime.createCardV2IfAbsent.mockRejectedValueOnce(new Error('The card limit was reached.'));
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const result = await pipeline.persistStructured({ creates: [card('apple') as CardData], patches: [] });

    expect(result.outcomes).toEqual(['failed']);
    // The page was reset once when the card was added at once; the refusal removes a card the
    // server never listed, so it needs no second read.
    expect(vi.mocked(context.resetCloudPage)).toHaveBeenCalledTimes(1);
  });

  it('keeps the optimistic counts of a single card whose save timed out, because the create may still land', async () => {
    vi.useFakeTimers();
    const context = createContext();
    const candidate = card('apple') as CardData;
    const cloud = deferred<{ card: typeof candidate; created: boolean; gamification: null }>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(cloud.promise);
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const persistence = pipeline.persistCards([candidate], 'generate');
    await vi.advanceTimersByTimeAsync(8_000);
    await persistence;

    expect(vi.mocked(context.updateCloudStats)).toHaveBeenCalledTimes(1);
    const facetCalls = vi.mocked(context.updateCategoryFacets).mock.calls;
    expect(facetCalls.reduce((net, [delta]) => net + (delta.General ?? 0), 0)).toBe(1);
    cloud.resolve({ card: candidate, created: true, gamification: null });
  });

  it('keeps a single card whose save timed out and accepts the outcome the server returns later', async () => {
    vi.useFakeTimers();
    let shown: CardData[] = [];
    const context = createContext();
    context.getCards = () => shown;
    context.publishCards = vi.fn((cards: CardData[]) => { shown = cards; }) as never;
    const candidate = card('slow-save') as CardData;
    const cloud = deferred<{ card: typeof candidate; created: boolean; gamification: unknown }>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(cloud.promise as never);
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    const gamification = { xp: 110, level: 2, streak: 1, studyDay: '2026-11-23', events: ['levelup'] as const };

    await expect(pipeline.persistCards([candidate], 'generate')).resolves.toEqual([{ card: candidate, created: true }]);
    await vi.advanceTimersByTimeAsync(8_000);

    expect(context.notify).not.toHaveBeenCalled();
    expect(context.setCloudUnavailable).not.toHaveBeenCalled();
    expect(shown).toHaveLength(1);

    cloud.resolve({ card: candidate, created: true, gamification });
    await vi.advanceTimersByTimeAsync(0);

    expect(shown).toHaveLength(1);
    expect(context.notify).not.toHaveBeenCalled();
    expect(context.acceptGamificationOutcome).toHaveBeenCalledTimes(1);
    expect(context.acceptGamificationOutcome).toHaveBeenCalledWith(gamification, expect.any(String));
  });

  it('removes a single card whose save timed out when the server later refuses it', async () => {
    vi.useFakeTimers();
    let shown: CardData[] = [];
    const context = createContext();
    context.getCards = () => shown;
    context.publishCards = vi.fn((cards: CardData[]) => { shown = cards; }) as never;
    const candidate = card('refused-late') as CardData;
    const cloud = deferred<never>();
    repositoryRuntime.createCardV2IfAbsent.mockReturnValueOnce(cloud.promise as never);
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await pipeline.persistCards([candidate], 'generate');
    await vi.advanceTimersByTimeAsync(8_000);
    expect(shown).toHaveLength(1);

    cloud.reject(new Error('permission-denied'));
    await vi.advanceTimersByTimeAsync(0);

    expect(shown).toHaveLength(0);
    expect(context.setCloudUnavailable).toHaveBeenCalledWith(true);
    expect(context.notify).toHaveBeenCalledWith('The card could not be saved. Check your connection and try again.');
  });

  it('reports a reused shared card under the id it is stored under', async () => {
    const earlier = { ...card('사과'), id: createWordCardId('사과'), language: 'ko', partOfSpeech: 'noun', revision: 4 };
    const shared = { ...card('사과'), id: createTargetAwareCardId('사과', 'ko'), language: 'ko' };
    repositoryRuntime.createCardV2IfAbsent.mockResolvedValueOnce({ card: earlier, created: false, gamification: null });
    const pipeline = createCardIntakePipeline({ getContext: createContext });

    const results = await pipeline.persistCards([shared], 'shared');

    // The result keeps the shared content and names the document that exists.
    expect(results).toEqual([{ card: { ...shared, id: earlier.id }, created: false }]);
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

  it.each([
    ['with a context sentence', { context: 'The lead actor arrived.' }],
    ['without a context sentence', {}],
  ])('saves an extension capture made through the intake controller with its page and capture time (%s)', async (_label, extra) => {
    generationRuntime.generateWordInfo.mockResolvedValueOnce({
      translation: 'dẫn đầu', explanation: '', explanationTranslation: '', phonetic: '/liːd/',
      emoji: '🎭', category: 'General', partOfSpeech: 'verb', cefrLevel: 'B1',
      exampleSentence: '', exampleTranslation: '', collocations: [], synonyms: [], antonyms: [],
      register: '', commonMistake: '', imageSearchQuery: 'lead actor',
    });
    const pipeline = createCardIntakePipeline({ getContext: createContext });
    const intake = createCardIntakeController({ port: pipeline as unknown as CardIntakeControllerPort });
    intake.setDraft('lead');

    const result = await intake.generateDraft({
      operationId: '123e4567-e89b-42d3-a456-426614174000',
      surface: 'extension',
      ...extra,
      sourceUrl: 'https://example.com/article',
      pageTitle: 'An Example Article',
      capturedAt: '2026-09-27T00:00:00.000Z',
    });

    expect(result.status).toBe('created');
    const savedCard = repositoryRuntime.createCardV2IfAbsent.mock.calls[0]?.[2] as { source?: unknown } | undefined;
    expect(savedCard?.source).toEqual({
      url: 'https://example.com/article',
      title: 'An Example Article',
      ...extra,
      capturedAt: '2026-09-27T00:00:00.000Z',
    });
  });

  it('carries alternative translations onto the generated card only when the model returned some', async () => {
    const wordInfo = {
      translation: 'dẫn đầu', explanation: '', explanationTranslation: '', phonetic: '/liːd/',
      emoji: '🎭', category: 'General', partOfSpeech: 'verb', cefrLevel: 'B1',
      exampleSentence: '', exampleTranslation: '', collocations: [], synonyms: [], antonyms: [],
      register: '', commonMistake: '', imageSearchQuery: 'lead actor',
    };
    generationRuntime.generateWordInfo
      .mockResolvedValueOnce({ ...wordInfo, translationAlternatives: ['chỉ huy', 'dẫn dắt'] })
      .mockResolvedValueOnce({ ...wordInfo, translationAlternatives: [] });
    const pipeline = createCardIntakePipeline({ getContext: createContext });

    const withAlternatives = await pipeline.generateCard({ term: 'lead', language: ENGLISH_TO_VIETNAMESE_PROFILE });
    const without = await pipeline.generateCard({ term: 'lead', language: ENGLISH_TO_VIETNAMESE_PROFILE });

    expect(withAlternatives.card).toMatchObject({ translationAlternatives: ['chỉ huy', 'dẫn dắt'] });
    expect(without.card).not.toHaveProperty('translationAlternatives');
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

  it('fences a delayed generation import when the owner changes before it starts', async () => {
    let context = createContext();
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const pending = pipeline.generateCard({
      term: 'lead', operationId: '123e4567-e89b-42d3-a456-426614174000',
      language: ENGLISH_TO_VIETNAMESE_PROFILE,
    });
    context = { ...context, ownerId: 'owner-b', libraryEpoch: 4 };
    pipeline.replaceOwner('owner-b');

    await expect(pending).rejects.toThrow('The intake session changed before this operation completed.');
    expect(generationRuntime.generateWordInfo).not.toHaveBeenCalled();
  });

  it('cancels a started generation with its captured owner after an owner switch', async () => {
    const wordInfo = deferred<{
      translation: string; explanation: string; explanationTranslation: string; phonetic: string;
      emoji: string; category: string; partOfSpeech: string; cefrLevel: string;
      exampleSentence: string; exampleTranslation: string; collocations: string[]; synonyms: string[];
      antonyms: string[]; register: string; commonMistake: string; imageSearchQuery: string;
    }>();
    generationRuntime.generateWordInfo.mockReturnValueOnce(wordInfo.promise);
    generationRuntime.cancelWordInfoGeneration.mockResolvedValueOnce(true);
    const ownerA = createContext();
    let context: CardIntakePortOptions = ownerA;
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    const pending = pipeline.generateCard({ term: 'lead', operationId, language: ENGLISH_TO_VIETNAMESE_PROFILE });
    await vi.waitFor(() => expect(generationRuntime.generateWordInfo).toHaveBeenCalledOnce());

    context = { ...ownerA, ownerId: 'owner-b', libraryEpoch: 4 };
    pipeline.replaceOwner('owner-b');
    await expect(pipeline.cancelGeneration?.(operationId)).resolves.toBe(true);
    await expect(pipeline.cancelGeneration?.('00000000-0000-4000-8000-000000000000')).resolves.toBeNull();

    expect(generationRuntime.cancelWordInfoGeneration).toHaveBeenCalledOnce();
    expect(generationRuntime.cancelWordInfoGeneration).toHaveBeenCalledWith(operationId, 'owner-a');
    wordInfo.resolve({
      translation: 'dẫn đầu', explanation: '', explanationTranslation: '', phonetic: '/liːd/',
      emoji: '🎭', category: 'General', partOfSpeech: 'verb', cefrLevel: 'B1',
      exampleSentence: '', exampleTranslation: '', collocations: [], synonyms: [], antonyms: [],
      register: '', commonMistake: '', imageSearchQuery: 'lead actor',
    });
    await expect(pending).rejects.toThrow('The intake session changed before this operation completed.');
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

  it('settles structured patches individually when a later patch fails', async () => {
    const context = createContext();
    vi.mocked(context.patchCard)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('offline'));
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.persistStructured({ creates: [], patches: [
      { card: card('first'), fields: { bookmarked: true } },
      { card: card('second'), fields: { bookmarked: true } },
    ] })).resolves.toEqual({ createdCount: 0, outcomes: ['reused', 'failed'] });
  });
});

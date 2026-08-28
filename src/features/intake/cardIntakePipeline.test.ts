import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardIntakePortOptions } from './cardIntakePortContract';
import {
  createCardIntakePipeline,
  StaleIntakeSessionError,
} from './cardIntakePipeline';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';

const generationRuntime = vi.hoisted(() => ({
  generateWordInfo: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: null, isFirebaseConfigured: false }));
vi.mock('../../lib/audio', () => ({ fetchAudioUrl: vi.fn(async () => null) }));
vi.mock('../../lib/images', () => ({ fetchImageUrl: vi.fn(async () => null) }));
vi.mock('../../lib/gemini', () => ({ generateWordInfo: generationRuntime.generateWordInfo }));

afterEach(() => {
  vi.unstubAllEnvs();
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
  upsertDeviceCards: vi.fn(async () => []),
  acknowledgeDevicePending: vi.fn(async () => undefined),
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
  addXp: vi.fn(),
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

  it('publishes a queued card optimistically through the current owner context', async () => {
    const context = createContext();
    const candidate = card('queued-card');
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });

    await expect(pipeline.persistCards([candidate], 'shared')).resolves.toEqual([
      { card: candidate, created: true },
    ]);

    expect(context.upsertDeviceCards).toHaveBeenCalledWith([candidate], 1);
    expect(context.publishCards).toHaveBeenCalledWith([candidate]);
    expect(context.addXp).toHaveBeenCalledWith(10);
  });

  it('reveals an existing card on a refreshed first page without requiring reload', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
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
      language: ENGLISH_TO_VIETNAMESE_PROFILE,
      context: 'The lead actor arrived.',
      requestedDeck: 'Reading',
      requestedDeckAvailable: deck => deck === 'Reading',
    });

    expect(generationRuntime.generateWordInfo).toHaveBeenCalledWith('lead', {
      context: 'The lead actor arrived.',
      sourceLanguage: 'en',
      targetLanguage: 'vi',
    });
    expect(generated.card.customDeck).toBe('Reading');
  });

  it('rejects late optimistic publication after an A-to-B owner switch', async () => {
    const queued = deferred<[]>();
    const ownerA = {
      ...createContext(),
      upsertDeviceCards: vi.fn(() => queued.promise),
    };
    let context: CardIntakePortOptions = ownerA;
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });

    const persistence = pipeline.persistCards([card('late-a-card')], 'shared');
    context = { ...createContext(), ownerId: 'owner-b', libraryEpoch: 4 };
    pipeline.replaceOwner('owner-b');
    queued.resolve([]);

    await expect(persistence).rejects.toBeInstanceOf(StaleIntakeSessionError);
    expect(ownerA.publishCards).not.toHaveBeenCalled();
    expect(ownerA.addXp).not.toHaveBeenCalled();
  });
});

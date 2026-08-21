import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardIntakePortOptions } from './cardIntakePortContract';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import {
  createCardIntakePipeline,
  StaleIntakeSessionError,
} from './cardIntakePipeline';
import {
  createCardIntakeController,
  RequestedDeckUnavailableError,
} from './cardIntakeController';

vi.mock('../../lib/firebase', () => ({ db: null, isFirebaseConfigured: false }));

const generation = vi.hoisted(() => ({
  generateWordInfo: vi.fn(async () => ({
    translation: 'bền bỉ', explanation: 'able to recover', explanationTranslation: 'có thể hồi phục',
    phonetic: '/rɪˈzɪl.i.ənt/', emoji: '🛡️', category: 'Quality', partOfSpeech: 'adjective',
    cefrLevel: 'B2', exampleSentence: 'A resilient team recovers.', exampleTranslation: 'Một đội bền bỉ sẽ hồi phục.',
    collocations: [], synonyms: [], antonyms: [], register: 'neutral', commonMistake: '', imageSearchQuery: 'resilient team',
  })),
}));
vi.mock('../../lib/gemini', () => generation);
vi.mock('../../lib/audio', () => ({ fetchAudioUrl: vi.fn(async () => null) }));
vi.mock('../../lib/images', () => ({ fetchImageUrl: vi.fn(async () => null), isSupportedImageUrl: () => false }));

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

const createLibraryReplica = () => ({
  findExisting: vi.fn(async () => new Map<string, ReturnType<typeof card>>()),
  createIntake: vi.fn(async (input: { card: ReturnType<typeof card>; libraryEpoch: number }) => ({
    status: 'queued' as const,
    card: input.card,
    libraryEpoch: input.libraryEpoch,
    operationId: `op-${input.card.id}`,
  })),
  createIntakeBatch: vi.fn(async (inputs: readonly { card: ReturnType<typeof card>; libraryEpoch: number }[]) =>
    inputs.map(input => ({
      status: 'queued' as const,
      card: input.card,
      libraryEpoch: input.libraryEpoch,
      operationId: `op-${input.card.id}`,
    }))),
  resolveIntake: vi.fn(async (receipt: {
    card: ReturnType<typeof card>;
    status: 'queued' | 'stale';
    libraryEpoch: number;
    operationId: string | null;
  }) => ({
    status: 'queued' as const,
    card: receipt.card,
    created: true,
    queued: true,
    receipt,
    acknowledged: false,
  })),
  settleIntake: vi.fn(),
  settleExisting: vi.fn(async () => undefined),
});

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
  libraryReplica: createLibraryReplica(),
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

  it('delegates persistence convergence to the injected Library Replica', () => {
    const pipelineSource = readFileSync(
      fileURLToPath(new URL('./cardIntakePipeline.ts', import.meta.url)),
      'utf8',
    );

    expect(pipelineSource).not.toMatch(/createCardIfAbsent|acknowledgeDevicePending/);
    expect(pipelineSource).not.toMatch(/from ['"]\.\.\/\.\.\/lib\/(cardRepository|cardMirror|deviceSync)/);
    expect(pipelineSource).toContain('libraryReplica');
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

    expect(context.libraryReplica.createIntakeBatch).toHaveBeenCalledWith([
      { card: candidate, libraryEpoch: 3, knownLibraryTotal: 1 },
    ]);
    expect(context.publishCards).toHaveBeenCalledWith([candidate]);
    expect(context.addXp).toHaveBeenCalledWith(10);
  });

  it('does not publish or award XP for a stale replica receipt', async () => {
    const context = createContext();
    const candidate = card('stale-receipt');
    vi.mocked(context.libraryReplica.createIntakeBatch).mockResolvedValue([{
      status: 'stale',
      card: candidate,
      libraryEpoch: 2,
      operationId: null,
    }]);
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.persistCards([candidate], 'generate')).resolves.toEqual([]);

    expect(context.publishCards).not.toHaveBeenCalled();
    expect(context.addXp).not.toHaveBeenCalled();
    expect(context.updateCloudStats).not.toHaveBeenCalled();
    expect(context.libraryReplica.resolveIntake).not.toHaveBeenCalled();
  });

  it('routes an authoritative duplicate settlement through the replica before compensating optimism', async () => {
    const candidate = card('optimistic-duplicate');
    const authoritative = { ...card('canonical-duplicate'), revision: 8, libraryEpoch: 3 };
    const context = createContext();
    vi.mocked(context.libraryReplica.resolveIntake).mockResolvedValue({
      status: 'existing',
      card: authoritative,
      created: false,
      queued: false,
      receipt: {
        status: 'queued',
        card: candidate,
        libraryEpoch: 3,
        operationId: 'op-duplicate',
      },
      acknowledged: true,
    });
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await pipeline.persistCards([candidate], 'generate');
    await vi.waitFor(() => expect(context.libraryReplica.resolveIntake).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(context.addXp).toHaveBeenCalledWith(-10));

    expect(context.libraryReplica.resolveIntake).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'op-optimistic-duplicate',
    }));
    expect(context.updateCloudStats).toHaveBeenCalledWith(expect.any(Function));
    expect(context.updateCategoryFacets).toHaveBeenCalledWith({ General: -1 });
    expect(context.libraryReplica.settleExisting).not.toHaveBeenCalled();
  });

  it('keeps the optimistic card queued and announces offline settlement through the replica', async () => {
    const context = createContext();
    const candidate = card('offline-card');
    await createCardIntakePipeline({ getContext: () => context }).persistCards([candidate], 'shared');

    await vi.waitFor(() => expect(context.libraryReplica.resolveIntake).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(context.setCloudUnavailable).toHaveBeenCalledWith(true));

    expect(context.notify).toHaveBeenCalledWith('Saved locally; awaiting sync.');
    expect(context.publishCards).toHaveBeenCalledWith([candidate]);
    expect(context.addXp).toHaveBeenCalledWith(10);
    expect(context.addXp).not.toHaveBeenCalledWith(-10);
  });

  it('does not compensate or touch a duplicate after the owner session becomes stale', async () => {
    const settlement = deferred<Awaited<ReturnType<CardIntakePortOptions['libraryReplica']['resolveIntake']>>>();
    const ownerA = createContext();
    ownerA.libraryReplica.resolveIntake = vi.fn(() => settlement.promise);
    let context: CardIntakePortOptions = ownerA;
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    const persistence = pipeline.persistCards([card('stale-duplicate')], 'generate');

    await persistence;
    context = { ...createContext(), ownerId: 'owner-b', libraryEpoch: 4 };
    pipeline.replaceOwner('owner-b');
    settlement.resolve({
      status: 'existing',
      card: card('canonical-after-switch'),
      created: false,
      queued: false,
      receipt: {
        status: 'queued',
        card: card('stale-duplicate'),
        libraryEpoch: 3,
        operationId: 'op-stale',
      },
      acknowledged: true,
    });

    await vi.waitFor(() => expect(ownerA.libraryReplica.resolveIntake).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(ownerA.addXp).not.toHaveBeenCalledWith(-10);
    expect(ownerA.libraryReplica.settleExisting).not.toHaveBeenCalled();
  });

  it('maps the structured request context and deck into generation and card output', async () => {
    const context = createContext();
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const generated = await pipeline.generateCard({
      term: ' resilient ',
      language: {
        id: 'en-vi',
        source: { code: 'en', displayName: 'English' },
        target: { code: 'vi', displayName: 'Vietnamese' },
        speechLocale: 'en-US',
        normalize: value => typeof value === 'string' ? value.trim().toLowerCase() : '',
      },
      context: 'The resilient team recovered quickly.',
      requestedDeck: 'Reading',
    });

    expect(generation.generateWordInfo).toHaveBeenCalledWith('resilient', expect.objectContaining({
      context: 'The resilient team recovered quickly.',
      requestedDeck: 'Reading',
      sourceLanguage: 'en',
      targetLanguage: 'vi',
    }));
    expect(generated.card.customDeck).toBe('Reading');
  });

  it('checks requested deck availability immediately before invoking AI generation', async () => {
    const context = createContext();
    let deckAvailable = true;
    generation.generateWordInfo.mockClear();
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.generateCard({
      term: 'resilient',
      language: ENGLISH_TO_VIETNAMESE_PROFILE,
      requestedDeck: 'Reading',
      requestedDeckAvailable: () => {
        deckAvailable = false;
        return deckAvailable;
      },
    })).rejects.toBeInstanceOf(RequestedDeckUnavailableError);

    expect(generation.generateWordInfo).not.toHaveBeenCalled();
  });

  it('reveals an existing card on a refreshed first page without requiring reload', async () => {
    const existing = card('existing-card');
    const context = {
      ...createContext(),
      getCards: () => [existing],
      libraryReplica: {
        ...createLibraryReplica(),
        findExisting: vi.fn(async () => new Map([[existing.word, existing]])),
      },
    };
    const pipeline = createCardIntakePipeline({
      getContext: () => context,
    });

    await pipeline.touchExisting(existing, '2026-08-13T03:00:00.000Z');

    expect(context.resetCatalog).toHaveBeenCalledOnce();
    expect(context.resetCloudPage).toHaveBeenCalledOnce();
    expect(context.focusLibrary).toHaveBeenCalledOnce();
    expect(context.libraryReplica.settleExisting).toHaveBeenCalledWith(expect.objectContaining({
      card: expect.objectContaining({ id: existing.id }),
    }));
  });

  it('assigns an existing card to a requested deck before touching it', async () => {
    const existing = { ...card('existing-card'), customDeck: null, libraryEpoch: 3 };
    const context = {
      ...createContext(),
      patchCard: vi.fn(async () => undefined),
    };
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    await expect(pipeline.assignExistingDeck?.(existing, 'Reading')).resolves.toMatchObject({
      id: existing.id,
      customDeck: 'Reading',
    });
    expect(context.patchCard).toHaveBeenCalledWith(
      existing.id,
      { customDeck: 'Reading' },
      existing,
    );
  });

  it('does not touch or clear an existing card after the deck patch crosses an owner switch', async () => {
    const existing = { ...card('existing-card'), customDeck: null, libraryEpoch: 3 };
    const patch = deferred<void>();
    const ownerA = {
      ...createContext(),
      getCards: () => [existing],
      libraryReplica: {
        ...createLibraryReplica(),
        findExisting: vi.fn(async () => new Map([[existing.word, existing]])),
      },
      patchCard: vi.fn(() => patch.promise),
    };
    let context: CardIntakePortOptions = ownerA;
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    const intake = createCardIntakeController({ port: pipeline });
    intake.setDraft('existing-card');

    const generation = intake.generateDraft({
      requestedDeck: 'Reading',
      requestedDeckAvailable: () => true,
    });
    await vi.waitFor(() => expect(ownerA.patchCard).toHaveBeenCalledWith(
      existing.id,
      { customDeck: 'Reading' },
      expect.objectContaining({ id: existing.id, customDeck: null }),
    ));

    const ownerB = createContext();
    context = { ...ownerB, ownerId: 'owner-b', libraryEpoch: 4 };
    pipeline.replaceOwner('owner-b');
    patch.resolve();

    const result = await generation;
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('Expected stale intake to fail.');
    expect(result.error).toBeInstanceOf(StaleIntakeSessionError);
    expect(ownerA.publishCards).not.toHaveBeenCalled();
    expect(ownerB.publishCards).not.toHaveBeenCalled();
    expect(intake.getSnapshot().draft).toBe('existing-card');
  });

  it('rejects late optimistic publication after an A-to-B owner switch', async () => {
    const queued = deferred<Awaited<ReturnType<CardIntakePortOptions['libraryReplica']['createIntakeBatch']>>>();
    const ownerA = {
      ...createContext(),
      libraryReplica: {
        ...createLibraryReplica(),
        createIntakeBatch: vi.fn(() => queued.promise),
      },
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

  it('rejects late optimistic publication after the library epoch advances', async () => {
    const queued = deferred<Awaited<ReturnType<CardIntakePortOptions['libraryReplica']['createIntakeBatch']>>>();
    const ownerA = {
      ...createContext(),
      libraryReplica: {
        ...createLibraryReplica(),
        createIntakeBatch: vi.fn(() => queued.promise),
      },
    };
    let context: CardIntakePortOptions = ownerA;
    const pipeline = createCardIntakePipeline({ getContext: () => context });

    const persistence = pipeline.persistCards([card('late-epoch-card')], 'shared');
    context = { ...ownerA, libraryEpoch: 4 };
    queued.resolve([{
      status: 'queued',
      card: card('late-epoch-card'),
      libraryEpoch: 3,
      operationId: 'op-late-epoch-card',
    }]);

    await expect(persistence).rejects.toBeInstanceOf(StaleIntakeSessionError);
    expect(ownerA.publishCards).not.toHaveBeenCalled();
    expect(ownerA.addXp).not.toHaveBeenCalled();
  });
});

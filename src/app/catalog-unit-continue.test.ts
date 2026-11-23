import { describe, expect, it, vi } from 'vitest';
import { createLexemeId } from '../features/multilingual/lexemeIdentity';
import type { CardData } from '../types/card';
import { continueCatalogUnitCards, type CatalogUnitContinuePorts } from './catalog-unit-continue';

const scope = { ownerId: 'owner-a', libraryEpoch: 2, targetLanguage: 'en' };

function card(word: string): CardData {
  return {
    id: word,
    lexemeId: createLexemeId({ language: 'en', normalizedLemma: word, partOfSpeech: 'noun', senseKey: 'main' }),
    language: 'en', normalizedLemma: word, senseKey: 'main', partOfSpeech: 'noun',
    word, translation: word, explanation: word, phonetic: '', emoji: '📚',
    category: 'Catalog', audioUrl: null, imageUrl: null, libraryEpoch: 2,
  };
}

function ports(existing = new Map<string, CardData>()): CatalogUnitContinuePorts {
  return {
    readCards: vi.fn(async () => new Map(existing)),
    createMissing: vi.fn(async (cards: readonly CardData[]) => ({ status: 'completed' as const, cards, createdCount: cards.length, reusedCount: 0 })),
    readPlainEnglishCards: vi.fn(async () => new Map<string, CardData>()),
    startStudy: vi.fn(async () => true),
    isCurrent: vi.fn(() => true),
  };
}

describe('catalog unit continuation', () => {
  it('uses one bounded read and studies existing cards in membership order', async () => {
    const first = card('first');
    const second = card('second');
    const dependencies = ports(new Map([[second.lexemeId!, second], [first.lexemeId!, first]]));

    await expect(continueCatalogUnitCards([first, second], scope, dependencies)).resolves.toBe('started');

    expect(dependencies.readCards).toHaveBeenCalledOnce();
    expect(dependencies.readCards).toHaveBeenCalledWith([first.lexemeId, second.lexemeId], scope);
    expect(dependencies.createMissing).not.toHaveBeenCalled();
    expect(dependencies.startStudy).toHaveBeenCalledWith([first, second], expect.any(Function));
  });

  it('creates only missing lexemes and waits for canonical settlement before study', async () => {
    const first = card('first');
    const second = card('second');
    const dependencies = ports(new Map([[first.lexemeId!, first]]));
    let settle!: (value: Awaited<ReturnType<CatalogUnitContinuePorts['createMissing']>>) => void;
    vi.mocked(dependencies.createMissing).mockImplementation(() => new Promise(resolve => { settle = resolve; }));

    const continuation = continueCatalogUnitCards([first, second], scope, dependencies);
    await vi.waitFor(() => expect(dependencies.createMissing).toHaveBeenCalledWith([second]));
    expect(dependencies.startStudy).not.toHaveBeenCalled();
    settle({ status: 'completed', cards: [{ ...second, id: 'server-second' }], createdCount: 1, reusedCount: 0 });

    await expect(continuation).resolves.toBe('started');
    expect(dependencies.startStudy).toHaveBeenCalledWith([first, expect.objectContaining({ id: 'server-second' })], expect.any(Function));
  });

  it('studies a plain English card already held for the word instead of creating a second card', async () => {
    const first = card('first');
    const second = card('second');
    const plainSecond: CardData = {
      ...second, id: 'word-second', lexemeId: undefined, normalizedLemma: undefined, senseKey: undefined,
      partOfSpeech: undefined, normalizedWord: 'second', difficulty: 'good', interval: 30,
    };
    const dependencies = ports(new Map([[first.lexemeId!, first]]));
    vi.mocked(dependencies.readPlainEnglishCards).mockResolvedValue(new Map([['second', plainSecond]]));

    await expect(continueCatalogUnitCards([first, second], scope, dependencies)).resolves.toBe('started');

    expect(dependencies.readPlainEnglishCards).toHaveBeenCalledWith(['second'], scope);
    expect(dependencies.createMissing).not.toHaveBeenCalled();
    expect(dependencies.startStudy).toHaveBeenCalledWith([first, plainSecond], expect.any(Function));
  });

  it('creates only the words that no lexeme card or plain English card holds', async () => {
    const first = card('first');
    const second = card('second');
    const plainFirst: CardData = { ...first, id: 'word-first', lexemeId: undefined, normalizedWord: 'first' };
    const dependencies = ports();
    vi.mocked(dependencies.readPlainEnglishCards).mockResolvedValue(new Map([['first', plainFirst]]));

    await expect(continueCatalogUnitCards([first, second], scope, dependencies)).resolves.toBe('started');

    expect(dependencies.createMissing).toHaveBeenCalledWith([second]);
    expect(dependencies.startStudy).toHaveBeenCalledWith([plainFirst, second], expect.any(Function));
  });

  it('does not look for plain English cards when every lexeme card exists or the target is not English', async () => {
    const first = card('first');
    const complete = ports(new Map([[first.lexemeId!, first]]));
    await continueCatalogUnitCards([first], scope, complete);
    expect(complete.readPlainEnglishCards).not.toHaveBeenCalled();

    const korean: CardData = { ...card('hello'), language: 'ko' };
    const koreanPorts = ports();
    await continueCatalogUnitCards([korean], { ...scope, targetLanguage: 'ko' }, koreanPorts);
    expect(koreanPorts.readPlainEnglishCards).not.toHaveBeenCalled();
  });

  it('leaves partial canonical creations retryable without starting study', async () => {
    const first = card('first');
    const dependencies = ports();
    vi.mocked(dependencies.createMissing).mockResolvedValue({ status: 'partial', cards: [], failedCount: 1 });

    await expect(continueCatalogUnitCards([first], scope, dependencies)).resolves.toBe('partial');
    expect(dependencies.startStudy).not.toHaveBeenCalled();
  });

  it('rejects oversized and repeated units before any read', async () => {
    const dependencies = ports();
    const oversized = Array.from({ length: 21 }, (_, index) => card(`word-${index}`));

    await expect(continueCatalogUnitCards(oversized, scope, dependencies)).resolves.toBe('unavailable');
    await expect(continueCatalogUnitCards([card('same'), card('same')], scope, dependencies)).resolves.toBe('unavailable');
    expect(dependencies.readCards).not.toHaveBeenCalled();
  });

  it('stops after an owner or epoch change and never creates or studies cards', async () => {
    const dependencies = ports();
    vi.mocked(dependencies.readCards).mockImplementation(async () => {
      vi.mocked(dependencies.isCurrent).mockReturnValue(false);
      return new Map();
    });

    await expect(continueCatalogUnitCards([card('first')], scope, dependencies)).resolves.toBe('stale');
    expect(dependencies.createMissing).not.toHaveBeenCalled();
    expect(dependencies.startStudy).not.toHaveBeenCalled();
  });

  it('does not create cards when navigation invalidates the unit during card hydration', async () => {
    const dependencies = ports();
    let stillOnUnit = true;
    vi.mocked(dependencies.isCurrent).mockImplementation(() => stillOnUnit);
    vi.mocked(dependencies.readCards).mockImplementation(async () => {
      stillOnUnit = false;
      return new Map();
    });

    await expect(continueCatalogUnitCards([card('first')], scope, dependencies)).resolves.toBe('stale');
    expect(dependencies.createMissing).not.toHaveBeenCalled();
    expect(dependencies.startStudy).not.toHaveBeenCalled();
  });

  it('does not open study when navigation changes while card creation settles', async () => {
    const dependencies = ports();
    let stillOnUnit = true;
    vi.mocked(dependencies.isCurrent).mockImplementation(() => stillOnUnit);
    vi.mocked(dependencies.createMissing).mockImplementation(async cards => {
      stillOnUnit = false;
      return { status: 'completed', cards, createdCount: cards.length, reusedCount: 0 };
    });

    await expect(continueCatalogUnitCards([card('first')], scope, dependencies)).resolves.toBe('stale');
    expect(dependencies.startStudy).not.toHaveBeenCalled();
  });

  it('does not report a started session when practice refuses activation', async () => {
    const first = card('first');
    const dependencies = ports(new Map([[first.lexemeId!, first]]));
    vi.mocked(dependencies.startStudy).mockResolvedValue(false);

    await expect(continueCatalogUnitCards([first], scope, dependencies)).resolves.toBe('stale');
  });
});

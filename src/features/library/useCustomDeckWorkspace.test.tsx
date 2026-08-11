import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
  readCachedDecksForIdentity,
  useCustomDeckWorkspace,
  type CustomDeckCachePort,
  type CustomDeckWorkspaceActions,
  type CustomDeckWorkspaceOptions,
} from './useCustomDeckWorkspace';

const assignedCard: CardData = {
  id: 'word-focus',
  word: 'focus',
  translation: 'tập trung',
  explanation: '',
  phonetic: '',
  emoji: '🎯',
  category: 'Study',
  audioUrl: null,
  imageUrl: null,
  customDeck: 'IELTS',
};

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const setup = () => {
  let storedDecks = ['IELTS'];
  let storedOwner: string | null = 'owner-1';
  const cache: CustomDeckCachePort = {
    read: () => ({ ownerId: storedOwner, decks: storedDecks }),
    write: vi.fn((ownerId, decks) => {
      storedOwner = ownerId;
      storedDecks = [...decks];
    }),
  };
  const mutations = {
    add: vi.fn(async () => undefined),
    clearAssignments: vi.fn(async () => undefined),
    removeProfile: vi.fn(async () => undefined),
  };
  const ports = {
    assignCard: vi.fn(async () => undefined),
    patchDeviceCards: vi.fn(async () => []),
    acknowledgeDevicePending: vi.fn(async () => undefined),
    publishCards: vi.fn(),
    publishPractice: vi.fn(),
    chooseAllDecks: vi.fn(),
    recoverCloud: vi.fn(),
    reportError: vi.fn(),
    warn: vi.fn(),
  };
  const options: CustomDeckWorkspaceOptions = {
    identityReady: true,
    owner: { id: 'owner-1', remoteAvailable: true },
    remoteDecks: ['IELTS'],
    cards: [assignedCard],
    activeDeck: 'IELTS',
    knownLibraryTotal: 1,
    mutations,
    cache,
    ports,
  };
  let actions: CustomDeckWorkspaceActions | null = null;
  renderToStaticMarkup(<Harness />);
  function Harness() {
    actions = useCustomDeckWorkspace(options).actions;
    return null;
  }
  return { actions: actions!, cache, mutations, ports };
};

describe('useCustomDeckWorkspace', () => {
  it('does not expose cached decks before identity ownership is verified', () => {
    let cachedOwner: string | null = 'owner-a';
    const cache: CustomDeckCachePort = {
      read: () => ({ ownerId: cachedOwner, decks: ['Owner A private deck'] }),
      write: vi.fn(ownerId => { cachedOwner = ownerId; }),
    };

    expect(readCachedDecksForIdentity(cache, false, null, null)).toEqual([]);
    expect(readCachedDecksForIdentity(cache, true, 'owner-b', null)).toEqual([]);
    expect(readCachedDecksForIdentity(cache, true, 'owner-a', null)).toEqual([
      'Owner A private deck',
    ]);
    expect(readCachedDecksForIdentity(cache, true, 'owner-b', ['Owner B remote deck']))
      .toEqual(['Owner B remote deck']);
  });

  it('publishes a compact vendor-free model and action contract', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useCustomDeckWorkspace.ts', import.meta.url)),
      'utf8',
    );
    const { actions } = setup();

    expect(source).not.toMatch(/firebase|firestore|Dispatch|SetStateAction/i);
    expect(source).not.toContain('confirmDelete');
    expect(Object.keys(actions)).toEqual(['changeNewDeckInput', 'assignDeck', 'createDeck', 'deleteDeck']);
  });

  it('publishes a normalized deck only after the owner mutation is confirmed', async () => {
    const { actions, cache, mutations } = setup();
    const remoteCreate = deferred<undefined>();
    mutations.add.mockImplementation(() => remoteCreate.promise);

    const createPromise = actions.createDeck('  TOEIC  ');

    expect(mutations.add).toHaveBeenCalledWith('owner-1', 'TOEIC');
    expect(cache.write).not.toHaveBeenCalled();

    remoteCreate.resolve(undefined);
    await createPromise;

    expect(cache.write).toHaveBeenCalledWith('owner-1', ['IELTS', 'TOEIC']);
  });

  it('rejects a failed remote creation without publishing a local success', async () => {
    const { actions, cache, mutations, ports } = setup();
    const remoteCreate = deferred<undefined>();
    mutations.add.mockImplementation(() => remoteCreate.promise);

    const createPromise = actions.createDeck('TOEIC');
    const rejection = expect(createPromise).rejects.toThrow('could not be created');
    remoteCreate.reject(new Error('offline'));

    await rejection;
    expect(cache.write).not.toHaveBeenCalled();
    expect(ports.reportError).toHaveBeenCalledWith(expect.stringContaining('could not be created'));
  });

  it('deletes a remote deck, queues the device patch and publishes the local result', async () => {
    const { actions, mutations, ports } = setup();

    await actions.deleteDeck('IELTS');

    expect(mutations.clearAssignments).toHaveBeenCalledWith('owner-1', 'IELTS');
    expect(mutations.removeProfile).toHaveBeenCalledWith('owner-1', 'IELTS');
    expect(ports.patchDeviceCards).toHaveBeenCalledWith([
      { card: { ...assignedCard, customDeck: null }, fields: { customDeck: null } },
    ], 1);
    expect(ports.publishCards).toHaveBeenCalledWith(new Set(['word-focus']), { customDeck: null });
    expect(ports.publishPractice).toHaveBeenCalledWith(new Set(['word-focus']), { customDeck: null });
    expect(ports.chooseAllDecks).toHaveBeenCalledOnce();
  });

  it('keeps the local deck and rejects when remote deletion cannot be confirmed', async () => {
    const { actions, cache, mutations, ports } = setup();
    mutations.clearAssignments.mockRejectedValue(new Error('offline'));

    await expect(actions.deleteDeck('IELTS')).rejects.toThrow('could not be deleted');

    expect(cache.write).not.toHaveBeenCalled();
    expect(ports.publishCards).not.toHaveBeenCalled();
    expect(ports.publishPractice).not.toHaveBeenCalled();
    expect(ports.reportError).toHaveBeenCalledWith(expect.stringContaining('could not be deleted'));
    expect(ports.recoverCloud).toHaveBeenCalledOnce();
  });
});

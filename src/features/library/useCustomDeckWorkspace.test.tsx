import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
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

const setup = () => {
  let storedDecks = ['IELTS'];
  let storedOwner: string | null = 'owner-1';
  const cache: CustomDeckCachePort = {
    readDecks: () => storedDecks,
    writeDecks: vi.fn(decks => { storedDecks = [...decks]; }),
    readOwner: () => storedOwner,
    writeOwner: vi.fn(owner => { storedOwner = owner; }),
    clearOwner: vi.fn(() => { storedOwner = null; }),
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
    confirmDelete: vi.fn(() => true),
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
  it('publishes a compact vendor-free model and action contract', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useCustomDeckWorkspace.ts', import.meta.url)),
      'utf8',
    );
    const { actions } = setup();

    expect(source).not.toMatch(/firebase|firestore|Dispatch|SetStateAction/i);
    expect(Object.keys(actions)).toEqual(['changeNewDeckInput', 'assignDeck', 'createDeck', 'deleteDeck']);
  });

  it('creates a normalized deck locally and publishes it through the owner mutation port', async () => {
    const { actions, cache, mutations } = setup();

    await actions.createDeck('  TOEIC  ');

    expect(cache.writeDecks).toHaveBeenCalledWith(['IELTS', 'TOEIC']);
    expect(mutations.add).toHaveBeenCalledWith('owner-1', 'TOEIC');
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
});

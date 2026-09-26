import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { OwnerLibrarySessionAdapter } from './ownerLibrarySessionController';
import {
  createLibrarySessionPortsBinding,
  type LibrarySessionPortPublications,
} from './useLibrarySessionPorts';

const card: CardData = {
  id: 'word-port', word: 'port', translation: 'cổng', explanation: '', phonetic: '',
  emoji: '🚪', category: 'General', audioUrl: null, imageUrl: null,
};

const ownerAdapter: OwnerLibrarySessionAdapter = {
  available: false,
  subscribeDeckProfile: () => () => undefined,
  getLegacyMigrationProgress: async () => ({ scanned: 0, complete: true }),
  migrateLegacyCards: async () => ({ migrated: 0, scanned: 0, complete: true as const }),
};

const publications = () => ({
  cloud: {
    total: vi.fn(), stats: vi.fn(), facets: vi.fn(), hasNextPage: vi.fn(),
    unavailable: vi.fn(), refresh: vi.fn(),
  },
  navigation: { resetPage: vi.fn(), previousPage: vi.fn() },
  promotedCards: vi.fn(() => [card]),
}) satisfies LibrarySessionPortPublications;

describe('library session ports binding', () => {
  it('keeps the public hook free of vendor and React setter types', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useLibrarySessionPorts.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/firebase|firestore|Repository/);
    expect(source).not.toMatch(/Dispatch|SetStateAction/);
  });

  it('exposes the owner adapter and promoted cards through the session port', () => {
    const publish = publications();
    const binding = createLibrarySessionPortsBinding({ ownerAdapter, publications: publish });

    expect(binding.ports.session.ownerAdapter).toBe(ownerAdapter);
    expect(binding.ports.session.getPromotedCards()).toEqual([card]);
  });

  it('owns cloud reset/refresh/unavailable glue', () => {
    const publish = publications();
    const binding = createLibrarySessionPortsBinding({ ownerAdapter, publications: publish });

    binding.actions.resetCloudState(true);
    binding.actions.markCloudUnavailable(true);
    binding.actions.refreshCloud();

    expect(publish.cloud.total).toHaveBeenCalledWith(0);
    expect(publish.cloud.stats).toHaveBeenCalledWith({
      total: 0, reviewed: 0, easy: 0, good: 0, hard: 0, unrated: 0,
      bookmarked: 0, due: 0, legacyUnindexed: 0,
    });
    expect(publish.cloud.facets).toHaveBeenCalledWith({}, true);
    expect(publish.cloud.hasNextPage).toHaveBeenCalledWith(false);
    expect(publish.cloud.unavailable).toHaveBeenCalledWith(true);
    expect(publish.cloud.refresh).toHaveBeenCalledOnce();
  });

  it('keeps stable ports while forwarding actions to replacement publications', () => {
    const first = publications();
    const second = publications();
    const binding = createLibrarySessionPortsBinding({ ownerAdapter, publications: first });
    const ports = binding.ports;

    binding.replace({ ownerAdapter, publications: second });
    binding.actions.refreshCloud();

    expect(binding.ports).toBe(ports);
    expect(first.cloud.refresh).not.toHaveBeenCalled();
    expect(second.cloud.refresh).toHaveBeenCalledOnce();
  });
});

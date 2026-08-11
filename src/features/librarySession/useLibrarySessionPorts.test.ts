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
  queueCardMigration: async () => undefined,
  seedDeckProfile: async () => undefined,
  subscribeDeckProfile: () => () => undefined,
  getLegacyMigrationProgress: async () => ({ scanned: 0, complete: true }),
  migrateLegacyCards: async () => ({ migrated: 0, scanned: 0, complete: true as const }),
};

const publications = () => ({
  library: { replace: vi.fn(), advance: vi.fn(), remove: vi.fn() },
  practice: { find: vi.fn(() => undefined), advance: vi.fn(), remove: vi.fn() },
  cloud: {
    total: vi.fn(), stats: vi.fn(), facets: vi.fn(), hasNextPage: vi.fn(),
    unavailable: vi.fn(), refresh: vi.fn(),
  },
  navigation: { resetPage: vi.fn(), previousPage: vi.fn() },
  feedback: { error: vi.fn(), notice: vi.fn() },
  promotedCards: vi.fn(() => [card]),
}) satisfies LibrarySessionPortPublications;

describe('library session ports binding', () => {
  it('keeps the public hook free of vendor and React setter types', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useLibrarySessionPorts.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/deviceEvents/);
    expect(source).toMatch(/connectVerifiedEpoch/);
    expect(source).not.toMatch(/firebase|firestore|Repository/);
    expect(source).not.toMatch(/Dispatch|SetStateAction/);
  });

  it('publishes local card pages and feedback through compact device events', () => {
    const publish = publications();
    const binding = createLibrarySessionPortsBinding({ ownerAdapter, publications: publish });

    binding.ports.session.deviceEvents.publishDeviceCards([card]);
    binding.ports.session.deviceEvents.publishDevicePage([card], 8, true);
    const advance = (value: CardData) => ({ ...value, bookmarked: true });
    binding.ports.session.deviceEvents.advanceCard(card.id, advance);
    binding.ports.session.deviceEvents.advancePracticeCard(card.id, advance);
    binding.ports.session.deviceEvents.removeCard(card.id);
    binding.ports.session.deviceEvents.removePracticeCard(card.id);
    binding.ports.session.deviceEvents.setCloudAvailable(false);
    binding.ports.session.deviceEvents.resetPage();
    binding.ports.session.deviceEvents.reportError('failed');
    binding.ports.session.deviceEvents.notify('saved');
    binding.ports.session.deviceEvents.previousPage();

    expect(publish.library.replace).toHaveBeenNthCalledWith(1, [card]);
    expect(publish.library.replace).toHaveBeenNthCalledWith(2, [card]);
    expect(publish.cloud.total).toHaveBeenCalledWith(8);
    expect(publish.cloud.hasNextPage).toHaveBeenCalledWith(true);
    expect(publish.library.advance).toHaveBeenCalledWith(card.id, advance);
    expect(publish.practice.advance).toHaveBeenCalledWith(card.id, advance);
    expect(publish.library.remove).toHaveBeenCalledWith(card.id);
    expect(publish.practice.remove).toHaveBeenCalledWith(card.id);
    expect(publish.cloud.unavailable).toHaveBeenCalledWith(true);
    expect(publish.navigation.resetPage).toHaveBeenCalledOnce();
    expect(publish.feedback.error).toHaveBeenCalledWith('failed');
    expect(publish.feedback.notice).toHaveBeenCalledWith('saved');
    expect(publish.navigation.previousPage).toHaveBeenCalledOnce();
    expect(binding.ports.session.getPromotedCards()).toEqual([card]);
  });

  it('owns cloud reset/refresh glue and verified epoch bridging', () => {
    const publish = publications();
    const binding = createLibrarySessionPortsBinding({ ownerAdapter, publications: publish });
    const acceptEpoch = vi.fn(() => true);

    binding.ports.session.deviceEvents.verifyEpoch({ userId: 'owner-a', value: 4 });
    expect(acceptEpoch).not.toHaveBeenCalled();
    binding.actions.connectVerifiedEpoch(acceptEpoch);
    binding.ports.session.deviceEvents.verifyEpoch({ userId: 'owner-a', value: 4 });
    binding.actions.resetCloudState(true);
    binding.actions.markCloudUnavailable(true);
    binding.actions.refreshCloud();

    expect(acceptEpoch).toHaveBeenCalledWith('owner-a', 4);
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

  it('keeps stable ports while forwarding to replacement publications', () => {
    const first = publications();
    const second = publications();
    const binding = createLibrarySessionPortsBinding({ ownerAdapter, publications: first });
    const ports = binding.ports;

    binding.replace({ ownerAdapter, publications: second });
    ports.session.deviceEvents.publishDeviceCards([card]);

    expect(binding.ports).toBe(ports);
    expect(first.library.replace).not.toHaveBeenCalled();
    expect(second.library.replace).toHaveBeenCalledWith([card]);
  });
});

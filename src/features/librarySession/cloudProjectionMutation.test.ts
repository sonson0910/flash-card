import { describe, expect, it, vi } from 'vitest';
import { createLibraryCloudProjectionController, type LibraryCloudProjectionInput } from './useLibraryCloudProjection';
import { EMPTY_LIBRARY_STATS } from './cloudLibraryPageController';

const card = { id: 'audit-card', word: 'audit', normalizedWord: 'audit', translation: 'kiểm tra', explanation: '', phonetic: '', emoji: '', category: 'Test', audioUrl: null, imageUrl: null, revision: 1, libraryEpoch: 1, bookmarked: false };
const session: LibraryCloudProjectionInput['session'] = {
  identity: { status: 'authenticated', owner: { id: 'audit-owner', displayName: null, email: null, photoUrl: null }, ownerEpoch: { ownerId: 'audit-owner', value: 1 }, canPublishMutations: true, isSigningIn: false, isSigningOut: false, error: null },
  owner: { ownerId: 'audit-owner', cards: [card], decks: [], legacyPending: 0, legacyIssue: null, isMigratingLegacy: false, status: 'ready', error: null },
  sync: { isSyncing: false, pendingCount: 0, error: null },
  cloud: { ownerId: 'audit-owner', queryKey: 'all', page: 1, items: [card], total: 1, hasNext: false, isLoading: false, cloudUnavailable: false, canRetryAutomatically: false, error: null, stats: EMPTY_LIBRARY_STATS, isStatsLoading: false, facets: {}, facetsComplete: false },
};
function setup() {
  const publication = { presentCards: vi.fn(), presentCloud: vi.fn(), resetCloud: vi.fn(), resetPage: vi.fn(), previousPage: vi.fn(), reportError: vi.fn(), clearError: vi.fn(), notify: vi.fn() };
  const controller = createLibraryCloudProjectionController({ cache: { readAnonymous: () => ({ ownerId: null, cards: [] }), writeAnonymous: () => {}, loadDeviceBackup: async () => null }, publication });
  return { controller, publication };
}
describe('audit: local mutation vs unchanged cloud projection', () => {
  it('does not overwrite an acknowledged revision 2 edit with unchanged revision 1 cloud snapshot', async () => {
    const { controller, publication } = setup();
    await controller.update({ session, cards: [card], page: 1 });
    const updated = { ...card, revision: 2, bookmarked: true };
    publication.presentCards.mockClear();
    await controller.update({ session: { ...session }, cards: [updated], page: 1 });
    const republished = publication.presentCards.mock.calls.at(-1)?.[0] ?? [updated];
    expect(republished[0]).toMatchObject({ revision: 2, bookmarked: true });
  });
  it('keeps an offline delete hidden until a newer cloud snapshot reconciles it', async () => {
    const { controller, publication } = setup();
    await controller.update({ session, cards: [card], page: 1 });
    publication.presentCards.mockClear();
    await controller.update({ session: { ...session, sync: { isSyncing: false, pendingCount: 1, error: null } }, cards: [], page: 1 });
    const republished = publication.presentCards.mock.calls.at(-1)?.[0] ?? [];
    expect(republished).toHaveLength(0);
  });
});

import { getLibraryHeading } from './LibraryCardGrid';
import { ALL_PRACTICE_DECK_SCOPE } from '../../lib/practiceScope';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { i18n } from '@lingui/core';
import { buildBulkBookmarkPatches, buildBulkDeckAssignPatches, getLegacyUpgradePresentation } from './LibraryCardGrid';
import { getRelativeReviewDays } from './libraryPresentation';

beforeEach(() => {
  i18n.load('en', {
    'library.upgrade.paused-title': 'Library upgrade paused',
    'library.upgrade.help-title': 'Library upgrade needs administrator help',
    'library.upgrade.upgrading': 'Upgrading…',
    'library.upgrade.retry': 'Retry upgrade',
    'library.upgrade.pending-title': '{count, plural, one {# older card needs} other {# older cards need}} a one-time library upgrade',
    'library.upgrade.pending-description': 'Securely upgrades the library in resumable batches while preserving study progress.',
    'library.upgrade.start': 'Upgrade library',
    'library.upgrade.trusted-migration-description': 'Some older cards need a secure one-time migration. Your cards are safe; an administrator must complete this repair.',
    'library.upgrade.sign-in-description': 'Sign in again, then retry the library upgrade. Your cards remain safe.',
    'library.upgrade.cloud-access-description': 'Cloud access for this library upgrade needs administrator help. Your cards remain safe.',
    'library.upgrade.temporary-description': 'The library upgrade is temporarily unavailable. Your cards remain safe; check your connection and retry.',
  });
  i18n.activate('en');
});

describe('legacy library upgrade presentation', () => {
  it('uses product language and offers one secure resumable upgrade action', () => {
    expect(getLegacyUpgradePresentation({
      pending: 12,
      migrating: false,
      issue: null,
    })).toEqual({
      title: '12 older cards need a one-time library upgrade',
      message: 'Securely upgrades the library in resumable batches while preserving study progress.',
      actionLabel: 'Upgrade library',
    });
  });

  it('formats the pending card count through the localized ICU message', () => {
    expect(getLegacyUpgradePresentation({
      pending: 1,
      migrating: false,
      issue: null,
    })?.title).toBe('1 older card needs a one-time library upgrade');
  });

  it('does not offer a retry when the browser cannot safely repair the batch', () => {
    expect(getLegacyUpgradePresentation({
      pending: 1,
      migrating: false,
      issue: {
        kind: 'trusted-migration',
        retryable: false,
        message: 'Some older cards need a secure one-time migration.',
      },
    })).toEqual({
      title: 'Library upgrade needs administrator help',
      message: 'Some older cards need a secure one-time migration. Your cards are safe; an administrator must complete this repair.',
      actionLabel: null,
    });
  });

  it('turns a recoverable cloud failure into an explicit retry', () => {
    expect(getLegacyUpgradePresentation({
      pending: 12,
      migrating: false,
      issue: {
        kind: 'cloud-access',
        retryable: true,
        message: 'Cloud access was rejected.',
      },
    })).toMatchObject({
      title: 'Library upgrade paused',
      message: 'Sign in again, then retry the library upgrade. Your cards remain safe.',
      actionLabel: 'Retry upgrade',
    });
  });

  it('does not render an English controller diagnostic in Vietnamese', () => {
    i18n.load('vi', {
      'library.upgrade.paused-title': 'Nâng cấp thư viện đang tạm dừng',
      'library.upgrade.retry': 'Thử lại nâng cấp',
      'library.upgrade.sign-in-description': 'Hãy đăng nhập lại, rồi thử nâng cấp thư viện. Thẻ của bạn vẫn an toàn.',
    });
    i18n.activate('vi');

    const presentation = getLegacyUpgradePresentation({
      pending: 1,
      migrating: false,
      issue: { kind: 'cloud-access', retryable: true, message: 'Sign in again to continue this library upgrade.' },
    });

    expect(presentation).toMatchObject({
      title: 'Nâng cấp thư viện đang tạm dừng',
      message: 'Hãy đăng nhập lại, rồi thử nâng cấp thư viện. Thẻ của bạn vẫn an toàn.',
      actionLabel: 'Thử lại nâng cấp',
    });
  });
});

describe('library collection hierarchy', () => {
  it('keeps utility chrome flatter than the card collection', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryCardGrid.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('data-library-card-collection="true"');
    expect(source).toContain('getLibraryGridLoadingLabel');
    expect(source).toContain('library-canvas-card-grid');
    expect(source).toContain('formatNumber(currentPage)');
    expect(source).not.toMatch(/liquid-glass lg:hidden/);
    expect(source).not.toMatch(/liquid-glass mx-auto mt-10/);
  });

  it('names the active deck space in the collection heading', () => {
    expect(getLibraryHeading('All', { kind: 'deck', name: 'IELTS' })).toBe('IELTS deck');
    expect(getLibraryHeading('Study', ALL_PRACTICE_DECK_SCOPE)).toBe('Study');
  });
});

describe('library card review metadata', () => {
  it('uses the scheduled review date for a whole-day relative label without rounding a future review down to today', () => {
    const now = Date.parse('2026-09-28T10:00:00.000Z');

    expect(getRelativeReviewDays('2026-09-29T09:00:00.000Z', now)).toBe(1);
    expect(getRelativeReviewDays('2026-09-30T10:00:00.000Z', now)).toBe(2);
  });

  it('leaves absent, invalid, and due dates for the grid to label as unseen or due now', () => {
    const now = Date.parse('2026-09-28T10:00:00.000Z');

    expect(getRelativeReviewDays(undefined, now)).toBeNull();
    expect(getRelativeReviewDays('not-a-date', now)).toBeNull();
    expect(getRelativeReviewDays('2026-09-28T10:00:00.000Z', now)).toBeNull();
  });
});

describe('bulk patch construction', () => {
  it('builds one patch per selected card, all targeting the chosen deck', () => {
    const patches = buildBulkDeckAssignPatches(
      [{ id: 'card-a' }, { id: 'card-b' }, { id: 'card-c' }],
      'Deck A',
    );

    expect(patches).toEqual([
      { cardId: 'card-a', fields: { customDeck: 'Deck A' } },
      { cardId: 'card-b', fields: { customDeck: 'Deck A' } },
      { cardId: 'card-c', fields: { customDeck: 'Deck A' } },
    ]);
  });

  it('clears the deck assignment when the unassigned target is chosen', () => {
    expect(buildBulkDeckAssignPatches([{ id: 'card-a' }], null)).toEqual([
      { cardId: 'card-a', fields: { customDeck: null } },
    ]);
  });

  it('computes each card\'s explicit bookmark target instead of one shared value', () => {
    const patches = buildBulkBookmarkPatches([
      { id: 'card-a', bookmarked: false },
      { id: 'card-b', bookmarked: true },
    ]);

    expect(patches).toEqual([
      { cardId: 'card-a', fields: { bookmarked: true } },
      { cardId: 'card-b', fields: { bookmarked: false } },
    ]);
  });

  it('returns no patches for an empty selection', () => {
    expect(buildBulkDeckAssignPatches([], 'Deck A')).toEqual([]);
    expect(buildBulkBookmarkPatches([])).toEqual([]);
  });
});

describe('bulk actions call the batched callable once per action', () => {
  it('replaced the per-card Promise.all fan-out with a single bulkPatchCards call', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryCardGrid.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('await bulkPatchCards(buildBulkDeckAssignPatches(selectedCards, target));');
    expect(source).toContain('await bulkPatchCards(buildBulkBookmarkPatches(selectedCards));');
    expect(source).not.toMatch(/Promise\.all\(selectedCards\.map/);
  });
});

describe('compact card detail access', () => {
  it('keeps the complete Flashcard interaction surface behind each compact card', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryCardGrid.tsx', import.meta.url)), 'utf8');

    expect(source).toContain("import('../../components/Flashcard')");
    expect(source).toContain('onAssignDeck={(id, deck) => void assignDeck(id, deck)}');
    expect(source).toContain('onUpdateCard={updateCard}');
    expect(source).toContain('onToggleBookmark={id => void toggleBookmark(id)}');
    expect(source).toContain('onDelete={async id => { if (await afterDelete(id)) setDetailCardId(null); }}');
    expect(source).toContain('onEditDelete={afterDelete}');
  });
});

describe('card detail dialog follows the live card, not just its id', () => {
  it('keys the dialog open state off the resolved card so a card leaving `cards` (unbookmark under a filter, a page change, a live query update) closes the dialog instead of showing it empty', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryCardGrid.tsx', import.meta.url)), 'utf8');

    // `open` must track the *resolved* card, not the id alone — otherwise the
    // dialog stays open with nothing to show once the card disappears.
    expect(source).toContain('<Dialog.Root open={Boolean(detailCard)}');
    expect(source).not.toContain('<Dialog.Root open={Boolean(detailCardId)}');
  });

  it('clears the stale id once its card is gone, so the card popping back into `cards` later does not reopen the dialog on its own', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryCardGrid.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('if (!detailCardId || detailCard) return;');
    expect(source).toContain('setDetailCardId(null);');
  });

  it('restores focus to the open trigger, falling back to the library heading when the trigger node is no longer in the document', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryCardGrid.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('if (trigger && trigger.isConnected) trigger.focus();');
    expect(source).toContain('else libraryHeadingRef.current?.focus({ preventScroll: true });');
  });
});

describe('library edit deletion', () => {
  it('gates a rendered editor and in-flight deletion cleanup by its captured owner', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryCardGrid.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('onDelete={afterDelete}');
    expect(source).toContain('const activeEditingCard = editingCard?.ownerId === ownerId ? editingCard.card : null;');
    expect(source).toContain('const activeDeletingCard = deletingCard?.ownerId === ownerId ? deletingCard.card : null;');
    expect(source).toContain('setEditingCard({ card, ownerId });');
    expect(source).toContain('setDeletingCard({ card, ownerId });');
    expect(source).toContain('{activeEditingCard && <Suspense');
    expect(source).toContain('open={Boolean(activeDeletingCard)}');
    expect(source).toContain('const requestOwnerId = activeOwnerRef.current;');
    expect(source).toContain('deleted && activeOwnerRef.current === requestOwnerId');
    expect(source).toContain('const deleted = (await deleteCard(id)) === true;');
    expect(source).toContain('setDetailCardId(current => current === id ? null : current);');
    expect(source).toContain('setSelectedIds(new Set());');
  });
});

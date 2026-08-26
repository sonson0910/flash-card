import type { CardData } from '../../types/card';
import { withTimeout } from '../../lib/async';
import { getProtectedFunctionUserMessage } from '../../lib/protectedFunctionsCapability';

const MAX_SHARED_CARDS = 100;
const MAX_SHARE_ID_LENGTH = 128;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHARED_DECK_OPERATION_TIMEOUT_MS = 20_000;
const INVALID_SHARED_CARD_BATCH_MESSAGE = 'This shared deck contains invalid vocabulary cards. No changes were made; ask the sender to create a new link.';
const EMPTY_SHARED_CARD_BATCH_MESSAGE = 'This shared deck contains no usable vocabulary cards. No changes were made; ask the sender to create a new link.';

class InvalidSharedCardBatchError extends Error {}

export interface SharedDeckAdapter {
  load(shareId: string): Promise<unknown>;
  create(request: { ownerId: string; category: string; cards: readonly CardData[] }): Promise<{
    shareId: string;
    expiresAt: string;
  }>;
  revoke(shareId: string, ownerId: string): Promise<void>;
}

type SharedDeckAdoptionResult =
  | { status: 'busy' }
  | { status: 'failed'; error: unknown }
  | {
    status: 'completed';
    candidateCount: number;
    createdCount: number;
    reusedCount: number;
  };

export interface SharedDeckIntakePort {
  adoptShared(request: { cards: readonly unknown[] }): Promise<SharedDeckAdoptionResult>;
}

export interface SharedDeckBrowser {
  getCurrentUrl(): string;
  replaceLocation(location: string): void;
}

export interface SharedDeckCardBatch {
  cards: readonly CardData[];
  total: number;
  hasNext: boolean;
}

export interface SharedDeckIncomingPreview {
  shareId: string;
  category: string;
  cardCount: number;
  sampleWords: readonly string[];
}

export interface SharedDeckSessionSnapshot {
  isLoading: boolean;
  isShareDialogOpen: boolean;
  activeShareId: string | null;
  shareLink: string | null;
  shareWarning: string | null;
  incomingPreview: SharedDeckIncomingPreview | null;
  expiresAt: string | null;
  notice: string | null;
  error: string | null;
}

export interface SharedDeckSessionActions {
  createShare(request: { category: string } & SharedDeckCardBatch): Promise<
    | { status: 'created'; shareId: string; shareLink: string; expiresAt: string }
    | { status: 'invalid' | 'busy' | 'unavailable' | 'failed' | 'stale' }
  >;
  acceptShared(): Promise<{ status: 'accepted' | 'missing' | 'busy' | 'failed' | 'stale' }>;
  cancelShared(): void;
  revokeShare(): Promise<{ status: 'revoked' | 'missing' | 'busy' | 'failed' | 'stale' }>;
  dismissShareLink(): void;
  showShareDialog(): void;
  clearNotice(): void;
  clearError(): void;
}

interface SharedDeckSessionOptions {
  adapter: SharedDeckAdapter;
  intake: SharedDeckIntakePort;
  browser: SharedDeckBrowser;
}

const validShareId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const shareId = value.trim();
  return shareId.length > 0
    && shareId.length <= MAX_SHARE_ID_LENGTH
    && SHARE_ID_PATTERN.test(shareId)
    ? shareId
    : null;
};

const readShareId = (location: string): { present: boolean; shareId: string | null } => {
  const value = new URL(location, 'https://sonflash.invalid').searchParams.get('share');
  return { present: value !== null, shareId: validShareId(value) };
};

const sharedPayload = (payload: unknown, shareId: string): {
  cards: readonly unknown[];
  preview: SharedDeckIncomingPreview;
} | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as { cards?: unknown; category?: unknown };
  if (!Array.isArray(record.cards) || record.cards.length === 0) return null;
  const cards = record.cards.slice(0, MAX_SHARED_CARDS);
  const hasOnlyValidCards = cards.every(card => {
    if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
    const { word, translation } = card as { word?: unknown; translation?: unknown };
    return typeof word === 'string'
      && word.trim().length > 0
      && typeof translation === 'string'
      && translation.trim().length > 0;
  });
  if (!hasOnlyValidCards) throw new InvalidSharedCardBatchError();
  const category = typeof record.category === 'string'
    ? record.category.trim().slice(0, 128) || 'Shared deck'
    : 'Shared deck';
  const sampleWords = cards.flatMap(card => {
    if (!card || typeof card !== 'object' || Array.isArray(card)) return [];
    const word = (card as { word?: unknown }).word;
    return typeof word === 'string' && word.trim()
      ? [word.trim().slice(0, 80)]
      : [];
  }).slice(0, 4);
  return {
    cards,
    preview: { shareId, category, cardCount: cards.length, sampleWords },
  };
};

const removeConsumedShare = (browser: SharedDeckBrowser): void => {
  const url = new URL(browser.getCurrentUrl(), 'https://sonflash.invalid');
  url.searchParams.delete('share');
  browser.replaceLocation(`${url.pathname}${url.search}${url.hash}`);
};

const buildShareLink = (currentLocation: string, shareId: string): string => {
  const url = new URL(currentLocation, 'https://sonflash.invalid');
  url.search = '';
  url.hash = '';
  url.searchParams.set('share', shareId);
  return url.href;
};

const adoptionNotice = (createdCount: number, reusedCount: number): string => {
  const createdLabel = `Added ${createdCount} new card${createdCount === 1 ? '' : 's'} from the shared link`;
  return reusedCount > 0
    ? `${createdLabel}; reused ${reusedCount} already in your library.`
    : `${createdLabel}.`;
};

export function createSharedDeckSessionController({
  adapter,
  intake,
  browser,
}: SharedDeckSessionOptions) {
  let snapshot: SharedDeckSessionSnapshot = {
    isLoading: false,
    isShareDialogOpen: false,
    activeShareId: null,
    shareLink: null,
    shareWarning: null,
    incomingPreview: null,
    expiresAt: null,
    notice: null,
    error: null,
  };
  let activeOwner: string | null = null;
  let hasActivated = false;
  let lifecycle = 0;
  let activeOperation = false;
  let pendingSharedDeck: {
    lifecycle: number;
    owner: string | null;
    cards: readonly unknown[];
  } | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<SharedDeckSessionSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener());
  };

  const isCurrent = (operationLifecycle: number, owner: string | null) =>
    !disposed && lifecycle === operationLifecycle && activeOwner === owner;

  const activate = async (owner: string | null): Promise<void> => {
    if (disposed) return;
    if (hasActivated && owner === activeOwner) return;
    const ownerChanged = hasActivated && owner !== activeOwner;
    hasActivated = true;
    activeOwner = owner;
    const operationLifecycle = ++lifecycle;
    activeOperation = false;
    if (ownerChanged) {
      pendingSharedDeck = null;
      publish({
        isShareDialogOpen: false,
        activeShareId: null,
        shareLink: null,
        shareWarning: null,
        incomingPreview: null,
        expiresAt: null,
        notice: null,
        error: null,
      });
    }
    const requested = readShareId(browser.getCurrentUrl());
    if (!requested.present) {
      publish({ isLoading: false });
      return;
    }
    if (!requested.shareId) {
      publish({ isLoading: false, error: 'This shared deck link is invalid.' });
      return;
    }

    activeOperation = true;
    publish({ isLoading: true, error: null, notice: null });
    try {
      const payload = await withTimeout(
        adapter.load(requested.shareId),
        SHARED_DECK_OPERATION_TIMEOUT_MS,
      );
      if (!isCurrent(operationLifecycle, owner)) return;
      const loaded = sharedPayload(payload, requested.shareId);
      if (!loaded) throw new Error('Invalid shared deck payload.');
      pendingSharedDeck = {
        lifecycle: operationLifecycle,
        owner,
        cards: loaded.cards,
      };
      publish({
        incomingPreview: loaded.preview,
        isShareDialogOpen: true,
        notice: null,
        error: null,
      });
    } catch (error) {
      if (!isCurrent(operationLifecycle, owner)) return;
      publish({
        error: error instanceof InvalidSharedCardBatchError
          ? INVALID_SHARED_CARD_BATCH_MESSAGE
          : 'Could not load this shared deck safely. No cards were added.',
      });
    } finally {
      if (isCurrent(operationLifecycle, owner)) {
        activeOperation = false;
        publish({ isLoading: false });
      }
    }
  };

  const actions: SharedDeckSessionActions = {
    async createShare({ category, cards, total, hasNext }) {
      if (!activeOwner) {
        publish({ error: 'Sign in before sharing a deck.' });
        return { status: 'unavailable' };
      }
      if (activeOperation || pendingSharedDeck) return { status: 'busy' };
      if (cards.length === 0) return { status: 'invalid' };
      const owner = activeOwner;
      const operationLifecycle = lifecycle;
      const sharedCards = cards.slice(0, MAX_SHARED_CARDS);
      const knownTotal = Number.isSafeInteger(total) && total >= 0
        ? Math.max(total, cards.length)
        : cards.length;
      const isTruncated = hasNext || knownTotal > sharedCards.length;
      const shareWarning = isTruncated
        ? `This link includes the first ${sharedCards.length} of ${knownTotal} cards. Split this category into smaller decks to share the rest.`
        : null;
      activeOperation = true;
      publish({ isLoading: true, error: null, notice: null, shareWarning: null });
      try {
        const result = await withTimeout(
          adapter.create({
            ownerId: owner,
            category: category.trim().slice(0, 128) || 'Shared',
            cards: sharedCards,
          }),
          SHARED_DECK_OPERATION_TIMEOUT_MS,
        );
        if (!isCurrent(operationLifecycle, owner)) return { status: 'stale' };
        const shareId = validShareId(result.shareId);
        if (!shareId || !Number.isFinite(Date.parse(result.expiresAt))) {
          throw new Error('Invalid create-share response.');
        }
        const shareLink = buildShareLink(browser.getCurrentUrl(), shareId);
        publish({
          activeShareId: shareId,
          shareLink,
          shareWarning,
          isShareDialogOpen: true,
          expiresAt: result.expiresAt,
          notice: isTruncated
            ? `Shared the first ${sharedCards.length} of ${knownTotal} cards. Create smaller categories to share the rest.`
            : null,
        });
        return { status: 'created', shareId, shareLink, expiresAt: result.expiresAt };
      } catch (error) {
        if (!isCurrent(operationLifecycle, owner)) return { status: 'stale' };
        publish({
          error: getProtectedFunctionUserMessage(error)
            ?? 'Could not create a share link right now. Please try again.',
        });
        return { status: 'failed' };
      } finally {
        if (isCurrent(operationLifecycle, owner)) {
          activeOperation = false;
          publish({ isLoading: false });
        }
      }
    },
    async acceptShared() {
      if (!pendingSharedDeck) return { status: 'missing' };
      if (activeOperation) return { status: 'busy' };
      const pending = pendingSharedDeck;
      const owner = activeOwner;
      const operationLifecycle = lifecycle;
      if (pending.lifecycle !== operationLifecycle || pending.owner !== owner) {
        return { status: 'stale' };
      }
      activeOperation = true;
      publish({ isLoading: true, error: null, notice: null });
      try {
        const adoption = await withTimeout(
          intake.adoptShared({ cards: pending.cards }),
          SHARED_DECK_OPERATION_TIMEOUT_MS,
        );
        if (!isCurrent(operationLifecycle, owner) || pendingSharedDeck !== pending) {
          return { status: 'stale' };
        }
        if (adoption.status === 'busy') {
          publish({
            error: 'Another card operation is already running. Please try the shared link again.',
          });
          return { status: 'busy' };
        }
        if (adoption.status === 'failed') throw adoption.error;
        if (!Number.isSafeInteger(adoption.candidateCount) || adoption.candidateCount <= 0) {
          publish({ error: EMPTY_SHARED_CARD_BATCH_MESSAGE });
          return { status: 'failed' };
        }
        removeConsumedShare(browser);
        pendingSharedDeck = null;
        publish({
          incomingPreview: null,
          isShareDialogOpen: false,
          notice: adoptionNotice(adoption.createdCount, adoption.reusedCount),
          error: null,
        });
        return { status: 'accepted' };
      } catch (error) {
        if (!isCurrent(operationLifecycle, owner) || pendingSharedDeck !== pending) {
          return { status: 'stale' };
        }
        publish({
          error: getProtectedFunctionUserMessage(error)
            ?? 'Could not add this shared deck safely. Please try again.',
        });
        return { status: 'failed' };
      } finally {
        if (isCurrent(operationLifecycle, owner)) {
          activeOperation = false;
          publish({ isLoading: false });
        }
      }
    },
    cancelShared() {
      if (!pendingSharedDeck || activeOperation) return;
      pendingSharedDeck = null;
      removeConsumedShare(browser);
      publish({ incomingPreview: null, isShareDialogOpen: false, error: null });
    },
    async revokeShare() {
      if (!snapshot.activeShareId) return { status: 'missing' };
      if (activeOperation) return { status: 'busy' };
      const shareId = snapshot.activeShareId;
      const owner = activeOwner;
      if (!owner) {
        publish({ error: 'Sign in before revoking a shared deck.' });
        return { status: 'failed' };
      }
      const operationLifecycle = lifecycle;
      activeOperation = true;
      publish({ isLoading: true, error: null, notice: null });
      try {
        await withTimeout(
          adapter.revoke(shareId, owner),
          SHARED_DECK_OPERATION_TIMEOUT_MS,
        );
        if (!isCurrent(operationLifecycle, owner)) return { status: 'stale' };
        publish({
          activeShareId: null,
          shareLink: null,
          shareWarning: null,
          isShareDialogOpen: false,
          expiresAt: null,
          notice: 'The shared deck link has been revoked.',
        });
        return { status: 'revoked' };
      } catch (error) {
        if (!isCurrent(operationLifecycle, owner)) return { status: 'stale' };
        publish({
          error: getProtectedFunctionUserMessage(error)
            ?? 'Could not revoke this share link right now. Please try again.',
        });
        return { status: 'failed' };
      } finally {
        if (isCurrent(operationLifecycle, owner)) {
          activeOperation = false;
          publish({ isLoading: false });
        }
      }
    },
    dismissShareLink: () => {
      if (!snapshot.incomingPreview) publish({ isShareDialogOpen: false });
    },
    showShareDialog: () => {
      if (snapshot.shareLink || snapshot.incomingPreview) {
        publish({ isShareDialogOpen: true });
      }
    },
    clearNotice: () => publish({ notice: null }),
    clearError: () => publish({ error: null }),
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activate,
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycle += 1;
      activeOperation = false;
      listeners.clear();
    },
    actions,
  };
}

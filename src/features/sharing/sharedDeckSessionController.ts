import type { CardData } from '../../types/card';

const MAX_SHARED_CARDS = 100;
const MAX_SHARE_ID_LENGTH = 128;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface SharedDeckAdapter {
  load(shareId: string): Promise<unknown>;
  create(request: { category: string; cards: readonly CardData[] }): Promise<{
    shareId: string;
    expiresAt: string;
  }>;
  revoke(shareId: string): Promise<void>;
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

export interface SharedDeckSessionSnapshot {
  isLoading: boolean;
  activeShareId: string | null;
  shareLink: string | null;
  expiresAt: string | null;
  notice: string | null;
  error: string | null;
}

export interface SharedDeckSessionActions {
  createShare(request: { category: string; cards: readonly CardData[] }): Promise<
    | { status: 'created'; shareId: string; shareLink: string; expiresAt: string }
    | { status: 'invalid' | 'busy' | 'unavailable' | 'failed' | 'stale' }
  >;
  revokeShare(): Promise<{ status: 'revoked' | 'missing' | 'busy' | 'failed' | 'stale' }>;
  dismissShareLink(): void;
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

const sharedPayloadCards = (payload: unknown): readonly unknown[] | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const cards = (payload as { cards?: unknown }).cards;
  return Array.isArray(cards) ? cards.slice(0, MAX_SHARED_CARDS) : null;
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
    activeShareId: null,
    shareLink: null,
    expiresAt: null,
    notice: null,
    error: null,
  };
  let activeOwner: string | null = null;
  let hasActivated = false;
  let lifecycle = 0;
  let activeOperation = false;
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
      publish({
        activeShareId: null,
        shareLink: null,
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
      const payload = await adapter.load(requested.shareId);
      if (!isCurrent(operationLifecycle, owner)) return;
      const cards = sharedPayloadCards(payload);
      if (!cards) throw new Error('Invalid shared deck payload.');
      const adoption = await intake.adoptShared({ cards });
      if (!isCurrent(operationLifecycle, owner)) return;
      if (adoption.status === 'busy') {
        publish({ error: 'Another card operation is already running. Please try the shared link again.' });
        return;
      }
      if (adoption.status === 'failed') throw adoption.error;
      removeConsumedShare(browser);
      publish({
        notice: adoptionNotice(adoption.createdCount, adoption.reusedCount),
        error: null,
      });
    } catch {
      if (!isCurrent(operationLifecycle, owner)) return;
      publish({
        error: 'Could not verify the complete library for this shared deck, so no cards were created.',
      });
    } finally {
      if (isCurrent(operationLifecycle, owner)) {
        activeOperation = false;
        publish({ isLoading: false });
      }
    }
  };

  const actions: SharedDeckSessionActions = {
    async createShare({ category, cards }) {
      if (!activeOwner) {
        publish({ error: 'Sign in before sharing a deck.' });
        return { status: 'unavailable' };
      }
      if (activeOperation) return { status: 'busy' };
      if (cards.length === 0) return { status: 'invalid' };
      const owner = activeOwner;
      const operationLifecycle = lifecycle;
      activeOperation = true;
      publish({ isLoading: true, error: null, notice: null });
      try {
        const result = await adapter.create({
          category: category.trim().slice(0, 128) || 'Shared',
          cards: cards.slice(0, MAX_SHARED_CARDS),
        });
        if (!isCurrent(operationLifecycle, owner)) return { status: 'stale' };
        const shareId = validShareId(result.shareId);
        if (!shareId || !Number.isFinite(Date.parse(result.expiresAt))) {
          throw new Error('Invalid create-share response.');
        }
        const shareLink = buildShareLink(browser.getCurrentUrl(), shareId);
        publish({ activeShareId: shareId, shareLink, expiresAt: result.expiresAt });
        return { status: 'created', shareId, shareLink, expiresAt: result.expiresAt };
      } catch {
        if (!isCurrent(operationLifecycle, owner)) return { status: 'stale' };
        publish({ error: 'Could not create a share link right now. Please try again.' });
        return { status: 'failed' };
      } finally {
        if (isCurrent(operationLifecycle, owner)) {
          activeOperation = false;
          publish({ isLoading: false });
        }
      }
    },
    async revokeShare() {
      if (!snapshot.activeShareId) return { status: 'missing' };
      if (activeOperation) return { status: 'busy' };
      const shareId = snapshot.activeShareId;
      const owner = activeOwner;
      const operationLifecycle = lifecycle;
      activeOperation = true;
      publish({ isLoading: true, error: null, notice: null });
      try {
        await adapter.revoke(shareId);
        if (!isCurrent(operationLifecycle, owner)) return { status: 'stale' };
        publish({
          activeShareId: null,
          shareLink: null,
          expiresAt: null,
          notice: 'The shared deck link has been revoked.',
        });
        return { status: 'revoked' };
      } catch {
        if (!isCurrent(operationLifecycle, owner)) return { status: 'stale' };
        publish({ error: 'Could not revoke this share link right now. Please try again.' });
        return { status: 'failed' };
      } finally {
        if (isCurrent(operationLifecycle, owner)) {
          activeOperation = false;
          publish({ isLoading: false });
        }
      }
    },
    dismissShareLink: () => publish({ shareLink: null }),
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

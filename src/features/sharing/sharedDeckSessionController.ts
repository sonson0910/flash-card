import type { CardData } from '../../types/card';
import { withTimeout } from '../../lib/async';
import { getProtectedFunctionUserMessage } from '../../lib/protectedFunctionsCapability';
import { createLexemeId } from '../multilingual/lexemeIdentity';

const MAX_SHARED_CARDS = 100;
const MAX_SHARE_ID_LENGTH = 128;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHARED_DECK_OPERATION_TIMEOUT_MS = 20_000;
// Shared intake confirms one write at a time against the owner's rate-limit budget.
const SHARED_DECK_INTAKE_BATCH_SIZE = 1;
const SHARED_DECK_INTAKE_WRITE_TIMEOUT_MS = 8_000;
const SHARED_DECK_OPERATION_STORAGE_KEY = 'lingoflash_shared_deck_operation_v1';
const SHARED_DECK_OPERATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_PENDING_SHARED_DECK_OPERATIONS = 20;
const INVALID_SHARED_CARD_BATCH_MESSAGE = 'This shared deck contains invalid vocabulary cards. No changes were made; ask the sender to create a new link.';
const EMPTY_SHARED_CARD_BATCH_MESSAGE = 'This shared deck contains no usable vocabulary cards. No changes were made; ask the sender to create a new link.';

class InvalidSharedCardBatchError extends Error {}

export interface SharedDeckAdapter {
  load(shareId: string): Promise<unknown>;
  create(request: {
    ownerId: string;
    category: string;
    cards: readonly CardData[];
    opId: string;
    operationCreatedAt: string;
  }): Promise<{
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
  sampleWords: readonly SharedDeckSampleWord[];
  languagePairs?: readonly SharedDeckLanguagePair[];
  createdAt: string | null;
  expiresAt: string | null;
  containsAiGeneratedCards: boolean;
}

export interface SharedDeckSampleWord {
  value: string;
  language: string | null;
  translation: string;
  translationLanguage: string | null;
  origin: 'ai' | 'manual' | null;
}

export interface SharedDeckLanguagePair {
  targetLanguage: string | null;
  translationLanguage: string | null;
}

export interface SharedDeckOutgoingPreview {
  category: string;
  cardCount: number;
  languagePairs: readonly SharedDeckLanguagePair[];
  expiresAt: string | null;
  containsAiGeneratedCards: boolean;
}

export interface SharedDeckTruncation {
  sharedCardCount: number;
  totalCardCount: number;
}

export interface SharedDeckSessionSnapshot {
  isLoading: boolean;
  isShareDialogOpen: boolean;
  activeShareId: string | null;
  shareLink: string | null;
  shareWarning: SharedDeckTruncation | null;
  outgoingPreview?: SharedDeckOutgoingPreview | null;
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

/** The optional dependency `shareCourseMatching.ts` implements. Kept as a structural type here to avoid a cyclic import. */
export interface SharedDeckCoursePort {
  ensureCourseForIncomingShare(preview: SharedDeckIncomingPreview): Promise<void>;
}

interface SharedDeckSessionOptions {
  adapter: SharedDeckAdapter;
  intake: SharedDeckIntakePort;
  browser: SharedDeckBrowser;
  storage?: SharedDeckOperationStorage | null;
  /**
   * Optional and additive: omitting it (every existing caller and test does)
   * keeps `acceptShared()` byte-for-byte identical to before this field
   * existed. When supplied, it only ever runs before the import call and
   * never blocks it, so a course-matching failure cannot turn into a
   * half-imported deck.
   */
  coursePort?: SharedDeckCoursePort | null;
}

export interface SharedDeckOperationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type PendingSharedDeckOperation = {
  ownerId: string;
  fingerprint: string;
  opId: string;
  operationCreatedAt: string;
};

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

const isCanonicalLanguageCode = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length <= 16
  && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(value)
);

const languagePair = (
  card: { language?: unknown; translationLanguage?: unknown },
): SharedDeckLanguagePair => ({
  targetLanguage: isCanonicalLanguageCode(card.language) ? card.language : null,
  translationLanguage: isCanonicalLanguageCode(card.translationLanguage) ? card.translationLanguage : null,
});

const languagePairs = (cards: readonly unknown[]): readonly SharedDeckLanguagePair[] => {
  const pairs = new Map<string, SharedDeckLanguagePair>();
  for (const card of cards) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) continue;
    const pair = languagePair(card as { language?: unknown; translationLanguage?: unknown });
    pairs.set(`${pair.targetLanguage ?? ''}\u0000${pair.translationLanguage ?? ''}`, pair);
  }
  return [...pairs.values()];
};

const deckLanguagePair = (cards: readonly CardData[]): { targetLanguage: string; nativeLanguage: string } | null => {
  const pairs = languagePairs(cards);
  return pairs.length === 1 && pairs[0].targetLanguage && pairs[0].translationLanguage
    ? { targetLanguage: pairs[0].targetLanguage, nativeLanguage: pairs[0].translationLanguage }
    : null;
};

const incomingLanguagePairs = (
  cards: readonly unknown[],
  deckPair: { targetLanguage: string; nativeLanguage: string } | null,
): readonly SharedDeckLanguagePair[] => {
  if (deckPair) {
    return [{ targetLanguage: deckPair.targetLanguage, translationLanguage: deckPair.nativeLanguage }];
  }
  const pairs = new Map<string, SharedDeckLanguagePair>();
  for (const rawCard of cards) {
    if (!rawCard || typeof rawCard !== 'object' || Array.isArray(rawCard)) continue;
    const card = rawCard as Record<string, unknown>;
    const language = canonicalCardLanguage(card);
    const pair = { targetLanguage: language, translationLanguage: null };
    pairs.set(`${language ?? ''}\u0000`, pair);
  }
  return [...pairs.values()];
};

const canonicalCardLanguage = (card: Record<string, unknown>): string | null => {
  const language = card.language;
  const lexemeId = card.lexemeId;
  const normalizedLemma = typeof card.normalizedLemma === 'string' ? card.normalizedLemma : card.word;
  const partOfSpeech = card.partOfSpeech;
  const senseKey = card.senseKey;
  if (!isCanonicalLanguageCode(language)
    || typeof lexemeId !== 'string' || !lexemeId
    || typeof normalizedLemma !== 'string' || !normalizedLemma.trim()
    || typeof partOfSpeech !== 'string' || !partOfSpeech.trim()
    || typeof senseKey !== 'string' || !senseKey.trim()) return null;
  try {
    return createLexemeId({ language, normalizedLemma, partOfSpeech, senseKey }) === lexemeId
      ? language
      : null;
  } catch {
    return null;
  }
};

const agreesWithDeckTarget = (
  cards: readonly unknown[],
  targetLanguage: string,
): boolean => cards.every(card => {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
  const language = canonicalCardLanguage(card as Record<string, unknown>);
  return language === null || language === targetLanguage;
});

const deckPairFrom = (record: Record<string, unknown>): {
  targetLanguage: string;
  nativeLanguage: string;
} | null => {
  if (!isCanonicalLanguageCode(record.targetLanguage) || !isCanonicalLanguageCode(record.nativeLanguage)) return null;
  return { targetLanguage: record.targetLanguage, nativeLanguage: record.nativeLanguage };
};

const isoDate = (value: unknown): string | null => {
  const asIso = (date: Date): string | null => Number.isFinite(date.getTime())
    ? date.toISOString()
    : null;
  if (value instanceof Date) return asIso(value);
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? asIso(new Date(millis)) : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const timestamp = value as { toDate?: unknown; seconds?: unknown; nanoseconds?: unknown };
  if (typeof timestamp.toDate === 'function') {
    try {
      const date = timestamp.toDate.call(value);
      return date instanceof Date ? asIso(date) : null;
    } catch {
      return null;
    }
  }
  if (typeof timestamp.seconds === 'number' && Number.isFinite(timestamp.seconds)) {
    const nanos = typeof timestamp.nanoseconds === 'number' && Number.isFinite(timestamp.nanoseconds)
      ? timestamp.nanoseconds
      : 0;
    return asIso(new Date(timestamp.seconds * 1_000 + nanos / 1_000_000));
  }
  return null;
};

const sharedPayload = (payload: unknown, shareId: string): {
  cards: readonly unknown[];
  preview: SharedDeckIncomingPreview;
} | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const recordCards = record.cards;
  if (!Array.isArray(recordCards) || recordCards.length === 0) return null;
  const cards = recordCards.slice(0, MAX_SHARED_CARDS);
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
  const proposedDeckPair = deckPairFrom(record);
  const deckPair = proposedDeckPair && agreesWithDeckTarget(cards, proposedDeckPair.targetLanguage)
    ? proposedDeckPair
    : null;
  const sampleWords = cards.flatMap(card => {
    if (!card || typeof card !== 'object' || Array.isArray(card)) return [];
    const source = card as Record<string, unknown>;
    const { word, translation } = source;
    const origin: SharedDeckSampleWord['origin'] = source.origin === 'ai' || source.origin === 'manual'
      ? source.origin
      : null;
    return typeof word === 'string' && word.trim() && typeof translation === 'string'
      ? [{
        value: word.trim().slice(0, 80),
        language: canonicalCardLanguage(source) ?? deckPair?.targetLanguage ?? null,
        translation: translation.trim().slice(0, 256),
        translationLanguage: deckPair?.nativeLanguage ?? null,
        origin,
      }]
      : [];
  }).slice(0, 5);
  return {
    cards,
    preview: {
      shareId, category, cardCount: cards.length, sampleWords,
      languagePairs: incomingLanguagePairs(cards, deckPair),
      createdAt: isoDate(record.createdAt),
      expiresAt: isoDate(record.expiresAt),
      containsAiGeneratedCards: recordCards.some(card => (
        !!card && typeof card === 'object' && !Array.isArray(card)
        && (card as Record<string, unknown>).origin === 'ai'
      )),
    },
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

const browserStorage = (): SharedDeckOperationStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const operationId = (createdAt: number): string => {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `share-v2:${createdAt}:${random}`;
};

const fingerprint = (value: unknown): string => {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const requestFingerprint = (category: string, cards: readonly CardData[]): string => fingerprint({
    category,
    ...(deckLanguagePair(cards) ?? {}),
    cards: cards.map(card => ({
      ...(card.lexemeId ? {
        lexemeId: card.lexemeId,
        language: card.language || '',
        senseKey: card.senseKey || '',
        normalizedLemma: card.normalizedLemma || card.normalizedWord || card.word,
      } : {}),
      word: card.word,
      translation: card.translation,
      explanation: card.explanation || '',
      explanationTranslation: card.explanationTranslation || '',
      phonetic: card.phonetic || '',
      category: card.category || '',
      partOfSpeech: card.partOfSpeech || '',
      cefrLevel: card.cefrLevel || '',
      exampleSentence: card.exampleSentence || '',
      exampleTranslation: card.exampleTranslation || '',
      collocations: card.collocations || [],
      synonyms: card.synonyms || [],
      antonyms: card.antonyms || [],
      register: card.register || '',
      commonMistake: card.commonMistake || '',
      imageSearchQuery: card.imageSearchQuery || '',
      emoji: card.emoji || '',
      audioUrl: card.audioUrl || null,
      imageUrl: card.imageUrl || null,
      ...(card.origin === 'ai' || card.origin === 'manual' ? { origin: card.origin } : {}),
      ...(card.mnemonic?.trim() ? { mnemonic: card.mnemonic.trim().slice(0, 2_048) } : {}),
      ...(card.wordFamily ? { wordFamily: card.wordFamily } : {}),
    })),
});

const validPendingOperation = (value: unknown, now: number): PendingSharedDeckOperation | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const opId = typeof record.opId === 'string' ? record.opId : null;
  const operationIdMatch = opId
    ? /^share-v2:(\d{13}):[A-Za-z0-9_-]{1,96}$/.exec(opId)
    : null;
  if (typeof record.ownerId !== 'string' || record.ownerId.length === 0 || record.ownerId.length > 128
    || typeof record.fingerprint !== 'string' || !/^v1-[a-f0-9]{8}$/.test(record.fingerprint)
    || !operationIdMatch || !opId || typeof record.operationCreatedAt !== 'string') return null;
  if (opId.length > 128) return null;
  const createdAt = Date.parse(record.operationCreatedAt);
  if (!Number.isFinite(createdAt) || Number(operationIdMatch[1]) !== createdAt
    || createdAt > now || now - createdAt >= SHARED_DECK_OPERATION_MAX_AGE_MS) return null;
  return {
    ownerId: record.ownerId,
    fingerprint: record.fingerprint,
    opId,
    operationCreatedAt: record.operationCreatedAt,
  };
};

export function createSharedDeckSessionController({
  adapter,
  intake,
  browser,
  storage: suppliedStorage,
  coursePort,
}: SharedDeckSessionOptions) {
  const storage = suppliedStorage === undefined ? browserStorage() : suppliedStorage;
  let snapshot: SharedDeckSessionSnapshot = {
    isLoading: false,
    isShareDialogOpen: false,
    activeShareId: null,
    shareLink: null,
    shareWarning: null,
    outgoingPreview: null,
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
  let pendingCreates: PendingSharedDeckOperation[] = [];
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<SharedDeckSessionSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener());
  };

  const isCurrent = (operationLifecycle: number, owner: string | null) =>
    !disposed && lifecycle === operationLifecycle && activeOwner === owner;

  const normalizePendingCreates = (value: unknown): PendingSharedDeckOperation[] => {
    const records = Array.isArray(value)
      ? value
      : value && typeof value === 'object' && Array.isArray((value as { operations?: unknown }).operations)
        ? (value as { operations: unknown[] }).operations
        : [value];
    const unique = new Map<string, PendingSharedDeckOperation>();
    for (const record of records) {
      const operation = validPendingOperation(record, Date.now());
      if (!operation) continue;
      const key = `${operation.ownerId}:${operation.fingerprint}`;
      const existing = unique.get(key);
      if (!existing || operation.operationCreatedAt > existing.operationCreatedAt
        || (operation.operationCreatedAt === existing.operationCreatedAt && operation.opId > existing.opId)) {
        unique.set(key, operation);
      }
    }
    return [...unique.values()]
      .sort((left, right) => right.operationCreatedAt.localeCompare(left.operationCreatedAt)
        || right.opId.localeCompare(left.opId));
  };

  const persistPendingCreates = (operations: PendingSharedDeckOperation[]): void => {
    pendingCreates = operations;
    try {
      if (operations.length > 0) {
        storage?.setItem(SHARED_DECK_OPERATION_STORAGE_KEY, JSON.stringify({ operations }));
      } else {
        storage?.removeItem(SHARED_DECK_OPERATION_STORAGE_KEY);
      }
    } catch { /* storage is optional */ }
  };

  const readPendingCreates = (): PendingSharedDeckOperation[] => {
    try {
      const raw = storage?.getItem(SHARED_DECK_OPERATION_STORAGE_KEY);
      if (raw === null || raw === undefined) return pendingCreates;
      const operations = normalizePendingCreates(JSON.parse(raw));
      if (operations.length > 0) {
        pendingCreates = operations;
        return operations;
      }
      storage?.removeItem(SHARED_DECK_OPERATION_STORAGE_KEY);
    } catch {
      try { storage?.removeItem(SHARED_DECK_OPERATION_STORAGE_KEY); } catch { /* storage is optional */ }
    }
    return pendingCreates;
  };

  const writePendingCreate = (operation: PendingSharedDeckOperation): boolean => {
    const pending = readPendingCreates();
    const existing = pending.some(candidate => (
      candidate.ownerId === operation.ownerId && candidate.fingerprint === operation.fingerprint
    ));
    const operations = pending.filter(candidate => (
      candidate.ownerId !== operation.ownerId || candidate.fingerprint !== operation.fingerprint
    ));
    if (!existing && operations.length >= MAX_PENDING_SHARED_DECK_OPERATIONS) return false;
    persistPendingCreates(normalizePendingCreates([...operations, operation]));
    return true;
  };

  const clearPendingCreate = (operation: PendingSharedDeckOperation): void => {
    persistPendingCreates(readPendingCreates().filter(candidate => candidate.opId !== operation.opId));
  };

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
        outgoingPreview: null,
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
      const normalizedCategory = category.trim().slice(0, 128) || 'Shared';
      const currentFingerprint = requestFingerprint(normalizedCategory, sharedCards);
      const storedOperation = readPendingCreates().find(candidate => (
        candidate.ownerId === owner && candidate.fingerprint === currentFingerprint
      ));
      const operation = storedOperation
        ? storedOperation
        : (() => {
          const createdAt = new Date();
          return {
            ownerId: owner,
            fingerprint: currentFingerprint,
            opId: operationId(createdAt.getTime()),
            operationCreatedAt: createdAt.toISOString(),
          };
        })();
      if (!writePendingCreate(operation)) {
        publish({ error: 'Too many share requests are pending. Retry an earlier request or wait for one to expire.' });
        return { status: 'failed' };
      }
      const knownTotal = Number.isSafeInteger(total) && total >= 0
        ? Math.max(total, cards.length)
        : cards.length;
      const isTruncated = hasNext || knownTotal > sharedCards.length;
      const shareWarning = isTruncated
        ? { sharedCardCount: sharedCards.length, totalCardCount: knownTotal }
        : null;
      const outgoingPreview: SharedDeckOutgoingPreview = {
        category: normalizedCategory,
        cardCount: sharedCards.length,
        languagePairs: languagePairs(sharedCards),
        expiresAt: null,
        containsAiGeneratedCards: sharedCards.some(card => card.origin === 'ai'),
      };
      activeOperation = true;
      publish({ isLoading: true, error: null, notice: null, shareWarning: null, outgoingPreview: null });
      try {
        const result = await withTimeout(
          adapter.create({
            ownerId: owner,
            category: normalizedCategory,
            cards: sharedCards,
            opId: operation.opId,
            operationCreatedAt: operation.operationCreatedAt,
          }),
          SHARED_DECK_OPERATION_TIMEOUT_MS,
        );
        if (!isCurrent(operationLifecycle, owner)) return { status: 'stale' };
        const shareId = validShareId(result.shareId);
        if (!shareId || !Number.isFinite(Date.parse(result.expiresAt))) {
          throw new Error('Invalid create-share response.');
        }
        clearPendingCreate(operation);
        const shareLink = buildShareLink(browser.getCurrentUrl(), shareId);
        const completedPreview = { ...outgoingPreview, expiresAt: isoDate(result.expiresAt) };
        publish({
          activeShareId: shareId,
          shareLink,
          shareWarning,
          outgoingPreview: completedPreview,
          isShareDialogOpen: true,
          expiresAt: result.expiresAt,
          notice: null,
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
        if (coursePort && snapshot.incomingPreview) {
          await coursePort.ensureCourseForIncomingShare(snapshot.incomingPreview);
          if (!isCurrent(operationLifecycle, owner) || pendingSharedDeck !== pending) return { status: 'stale' };
        }
        const adoption = await withTimeout(
          intake.adoptShared({ cards: pending.cards }),
          SHARED_DECK_OPERATION_TIMEOUT_MS
            + Math.ceil(pending.cards.length / SHARED_DECK_INTAKE_BATCH_SIZE) * SHARED_DECK_INTAKE_WRITE_TIMEOUT_MS,
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
          outgoingPreview: null,
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

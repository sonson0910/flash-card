import { createHash, createHmac } from 'node:crypto';
import {
  parseCreateSharedDeckRequest,
} from './inputValidation.js';

export const LEGACY_SHARED_DECK_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_SHARED_DECKS = 100;
export const MAX_SHARED_DECK_BYTES = 25_000_000;
export const MAX_SHARED_DECK_PAYLOAD_BYTES = 750_000;
export const MAX_PAGE_DOCUMENTS = 10;
export const MAX_PAGE_BYTES = 64 * 1024 * 1024;
export const MAX_SEALED_CHUNK_ENTRIES = 100;
export const MAX_ISSUE_DETAIL = 100;
export const MAX_PAYLOAD_SAMPLE_KEYS = 2;

export type LegacyShareDisposition =
  | 'keep-current'
  | 'migrate-owner-free-legacy'
  | 'migrate-transitional'
  | 'upgrade-private-v1'
  | 'quarantine-candidate'
  | 'block';

export type LegacyShareReasonCode =
  | 'current'
  | 'owner-free-legacy'
  | 'transitional-v1'
  | 'private-v1-upgrade'
  | 'private-v2-current'
  | 'orphan-private'
  | 'orphan-private-active'
  | 'private-missing'
  | 'owner-mismatch'
  | 'timestamp-mismatch'
  | 'payload-mismatch'
  | 'private-conflict'
  | 'malformed-public'
  | 'malformed-private'
  | 'empty-public'
  | 'unsupported-value'
  | 'owner-assertion-invalid'
  | 'invalid-share-id'
  | 'page-invalid'
  | 'page-too-large';

type TimestampCanonical = { seconds: string; nanoseconds: number };
type DataRecord = Record<string, unknown>;

export type LegacySharedDeckRecord = {
  shareId?: string;
  id?: string;
  publicData?: unknown;
  privateData?: unknown;
  public?: unknown;
  private?: unknown;
  ownership?: unknown;
  data?: unknown;
  [key: string]: unknown;
};

export type LegacySharedDeckDocument = {
  readonly id: string;
  readonly data: DataRecord;
};

export type LegacySharedDeckStreamPage = {
  readonly documents: readonly LegacySharedDeckDocument[];
  readonly cursor: string | null;
  readonly terminal: boolean;
};

export type LegacySharedDeckInventoryStore = {
  readonly readPage: (request: {
    readonly source: 'public' | 'private';
    readonly after: string | null;
    readonly limit: number;
  }) => Promise<LegacySharedDeckStreamPage>;
};

export type LegacyShareClassification = {
  readonly shareId: string;
  readonly action: 'keep' | 'migrate' | 'quarantine' | 'block';
  readonly disposition: LegacyShareDisposition;
  readonly reasonCode: LegacyShareReasonCode;
  readonly ownerUid: string;
  readonly preserveShareId: true;
  readonly publicDigest: string | null;
  readonly privateDigest: string | null;
  readonly payloadDigest: string | null;
  readonly payloadBytes: number | null;
  readonly payloadEquivalent: boolean;
  readonly existingExpiresAt: TimestampCanonical | null;
  readonly proposedExpiresAt: string | null;
  readonly expired: boolean;
  readonly issue: string | null;
};

export type LegacySharedDeckInventoryEntry = LegacyShareClassification & {
  readonly publicSourceDigest: string | null;
  readonly privateSourceDigest: string | null;
};

export type LegacySharedDeckInventoryOptions = {
  readonly store: LegacySharedDeckInventoryStore;
  readonly ownerUid: string;
  readonly runId: string;
  readonly revision: string;
  readonly target: string;
  readonly scanStartedAt: string;
  readonly previousDigest?: string;
  readonly resume?: LegacySharedDeckCheckpoint;
  readonly maxPageBytes?: number;
  /** Keep bounded unit-test evidence; the production operator leaves this false. */
  readonly collectEntries?: boolean;
  readonly collectChunks?: boolean;
  readonly onChunk?: (chunk: LegacySharedDeckSealedChunk) => void | Promise<void>;
};

export type LegacySharedDeckCheckpoint = {
  readonly ownerKey: string;
  readonly runId: string;
  readonly revision: string;
  readonly target: string;
  readonly scanStartedAt: string;
  readonly previousDigest: string;
  readonly publicCursor: string | null;
  readonly privateCursor: string | null;
  readonly publicTerminal: boolean;
  readonly privateTerminal: boolean;
  readonly chunkIndex: number;
  readonly beforePublicCursor: string | null;
  readonly beforePrivateCursor: string | null;
  readonly afterPublicCursor: string | null;
  readonly afterPrivateCursor: string | null;
};

export type LegacySharedDeckSealedChunk = {
  readonly index: number;
  readonly previousDigest: string;
  readonly digest: string;
  readonly publicCursor: string | null;
  readonly privateCursor: string | null;
  readonly publicTerminal: boolean;
  readonly privateTerminal: boolean;
  readonly beforePublicCursor: string | null;
  readonly beforePrivateCursor: string | null;
  readonly entries: readonly LegacySharedDeckInventoryEntry[];
};

export type LegacySharedDeckInventory = {
  readonly ownerUid: string;
  readonly runId: string;
  readonly revision: string;
  readonly target: string;
  readonly scanStartedAt: string;
  readonly consistency: 'unfrozen';
  readonly applyEligible: false;
  readonly entries: readonly LegacySharedDeckInventoryEntry[];
  readonly chunks: readonly LegacySharedDeckSealedChunk[];
  readonly publicCursor: string | null;
  readonly privateCursor: string | null;
  readonly publicTerminal: boolean;
  readonly privateTerminal: boolean;
  readonly checkpoint: LegacySharedDeckCheckpoint;
  readonly chainHead: string;
  readonly totalPublicBytes: number;
  readonly totalPrivateBytes: number;
  readonly totalPayloadBytes: number;
  readonly counts: Readonly<Record<LegacyShareDisposition, number>>;
  readonly reasons: Readonly<Record<string, number>>;
  readonly quota: LegacySharedDeckQuota;
  readonly activeOwner: LegacySharedDeckActiveOwner;
  readonly evidence: LegacySharedDeckEvidence;
};

export type LegacySharedDeckEvidence = {
  readonly shareKeys: readonly string[];
  readonly issues: readonly LegacySharedDeckEvidenceIssue[];
  readonly shareKeysOmittedCount: number;
  readonly issuesOmittedCount: number;
  readonly equivalentPayloads: readonly LegacySharedDeckEquivalentPayloadEvidence[];
  readonly equivalentPayloadsOmittedCount: number;
};

export type LegacySharedDeckEvidenceIssue = {
  readonly shareKey: string;
  readonly reasonCode: LegacyShareReasonCode;
};

export type LegacySharedDeckEquivalentPayloadEvidence = {
  readonly equivalenceKey: string;
  readonly count: number;
  readonly shareKeys: readonly string[];
  readonly shareKeysOmittedCount: number;
};

export type LegacySharedDeckQuota = {
  readonly activeCount: number;
  readonly activeBytes: number;
  readonly maximumCount: number;
  readonly maximumBytes: number;
  readonly overCount: boolean;
  readonly overBytes: boolean;
  readonly overCap: boolean;
};

export type LegacySharedDeckActiveOwner = {
  readonly ownerKey: string;
  readonly activeCount: number;
  readonly activeBytes: number;
  readonly expiredCount: number;
};

export class LegacySharedDeckInventoryError extends Error {
  constructor(reasonCode: LegacyShareReasonCode, detail = reasonCode) {
    super(`${reasonCode}: ${detail.slice(0, MAX_ISSUE_DETAIL)}`);
    this.name = 'LegacySharedDeckInventoryError';
    this.reasonCode = reasonCode;
  }

  readonly reasonCode: LegacyShareReasonCode;
}

export class LegacySharedDeckResumeError extends Error {
  constructor() {
    super('Inventory resume context does not match the persisted scan.');
    this.name = 'LegacySharedDeckResumeError';
  }
}

const isRecord = (value: unknown): value is DataRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const hasOwn = (value: DataRecord, key: string): boolean => Object.hasOwn(value, key);

const exactKeys = (value: DataRecord, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => hasOwn(value, key));
};

const utf8Compare = (left: string, right: string): number => {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
};

const timestampFields = (value: unknown): { seconds: unknown; nanoseconds: unknown } | null => {
  if (!isRecord(value)) return null;
  if (exactKeys(value, ['seconds', 'nanoseconds'])) {
    return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (exactKeys(value, ['_seconds', '_nanoseconds'])) {
    return { seconds: value._seconds, nanoseconds: value._nanoseconds };
  }
  return null;
};

const isTimestampLike = (value: unknown): value is TimestampCanonical => {
  const fields = timestampFields(value);
  if (!fields) return false;
  const seconds = fields.seconds;
  const nanoseconds = fields.nanoseconds;
  const validSeconds = (typeof seconds === 'number'
    && Number.isSafeInteger(seconds))
    || (typeof seconds === 'string' && /^-?(?:0|[1-9][0-9]*)$/.test(seconds));
  return validSeconds
    && typeof nanoseconds === 'number'
    && Number.isSafeInteger(nanoseconds)
    && nanoseconds >= 0
    && nanoseconds <= 999_999_999;
};

const timestampCanonical = (value: unknown): TimestampCanonical | null => {
  if (!isTimestampLike(value)) return null;
  const fields = timestampFields(value) as { seconds: unknown; nanoseconds: number };
  return {
    seconds: String(fields.seconds),
    nanoseconds: fields.nanoseconds,
  };
};

const firestoreTimestampCanonical = (value: unknown): TimestampCanonical | null => {
  if (!isRecord(value) || !exactKeys(value, ['_seconds', '_nanoseconds'])) return null;
  return timestampCanonical(value);
};

const canonicalize = (value: unknown, seen = new Set<object>()): string => {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new LegacySharedDeckInventoryError('unsupported-value');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new LegacySharedDeckInventoryError('unsupported-value');
  if (seen.has(value)) throw new LegacySharedDeckInventoryError('unsupported-value');
  seen.add(value);
  try {
    const timestamp = firestoreTimestampCanonical(value);
    if (timestamp) {
      return `{"$timestamp":{"seconds":${JSON.stringify(timestamp.seconds)},"nanoseconds":${timestamp.nanoseconds}}}`;
    }
    if (Array.isArray(value)) return `[${value.map(item => canonicalize(item, seen)).join(',')}]`;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new LegacySharedDeckInventoryError('unsupported-value');
    }
    const record = value as DataRecord;
    const keys = Object.keys(record).sort(utf8Compare);
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(record[key], seen)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
};

export const canonicalUtf8Bytes = (value: unknown): Uint8Array => (
  new TextEncoder().encode(canonicalize(value))
);

export const digestCanonicalValue = (value: unknown): string => (
  createHash('sha256').update(canonicalUtf8Bytes(value)).digest('hex')
);

export const hashShareKey = (shareId: string): string => (
  createHash('sha256').update(`lingoflash:shared-deck:share:${shareId}`, 'utf8').digest('hex')
);

export const hashOwnerKey = (ownerUid: string): string => (
  createHash('sha256').update(`lingoflash:shared-deck:owner:${ownerUid}`, 'utf8').digest('hex')
);

type LegacySharedDeckChainContext = {
  readonly ownerKey: string;
  readonly runId: string;
  readonly revision: string;
  readonly target: string;
  readonly scanStartedAt: string;
};

const equivalenceKey = (
  payloadDigest: string,
  ownerUid: string,
  context: LegacySharedDeckChainContext,
): string => createHmac('sha256', ownerUid)
  .update(JSON.stringify({
    domain: 'lingoflash:shared-deck:equivalence:v1',
    context,
    payloadDigest,
  }), 'utf8')
  .digest('hex');

const validBoundedString = (value: unknown, maximum: number, minimum = 0): value is string => (
  typeof value === 'string' && value.length >= minimum && value.length <= maximum
);

const validShareId = (value: unknown): value is string => (
  validBoundedString(value, 128, 1) && !value.includes('/')
);

const validCards = (value: unknown): value is readonly unknown[] => (
  Array.isArray(value)
  && value.length > 0
  && value.length <= MAX_SHARED_DECKS
  && value.every(card => isRecord(card))
);

const validCategory = (value: unknown): value is string => (
  validBoundedString(value, 128, 1) && value === value.trim()
);

const validExactText = (value: unknown, maximum: number, required = false): value is string => (
  typeof value === 'string'
  && value === value.trim()
  && value.length <= maximum
  && (!required || value.length > 0)
);

const validTrustedUrl = (
  value: unknown,
  hosts: ReadonlySet<string>,
): value is string | null => {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.has(url.hostname) && url.toString() === value;
  } catch {
    return false;
  }
};

const SHARED_IMAGE_HOSTS = new Set([
  'images.pexels.com',
  'images.unsplash.com',
  'upload.wikimedia.org',
]);
const SHARED_AUDIO_HOSTS = new Set([
  'api.dictionaryapi.dev',
  'ssl.gstatic.com',
]);

const LEGACY_CARD_KEYS = [
  'word', 'translation', 'explanation', 'phonetic', 'category', 'partOfSpeech', 'emoji', 'audioUrl', 'imageUrl',
] as const;

const CURRENT_CARD_KEYS = [
  'word', 'translation', 'explanation', 'explanationTranslation', 'phonetic', 'category', 'partOfSpeech',
  'cefrLevel', 'exampleSentence', 'exampleTranslation', 'collocations', 'synonyms', 'antonyms', 'register',
  'commonMistake', 'imageSearchQuery', 'emoji', 'audioUrl', 'imageUrl',
] as const;

const validTextList = (value: unknown, maximum: number): value is string[] => (
  Array.isArray(value)
  && value.length <= 4
  && value.every(item => validExactText(item, maximum, true))
);

const validWordFamily = (value: unknown): value is Record<string, string> => {
  if (!isRecord(value)) return false;
  const allowed = new Set(['noun', 'verb', 'adj', 'adv']);
  return Object.keys(value).every(key => allowed.has(key)
    && validExactText(value[key], 100, true));
};

const validLegacyCard = (value: unknown): value is DataRecord => {
  if (!isRecord(value) || !exactKeys(value, LEGACY_CARD_KEYS)) return false;
  return validExactText(value.word, 256, true)
    && validExactText(value.translation, 256, true)
    && validExactText(value.explanation, 2_048)
    && validExactText(value.phonetic, 256)
    && validExactText(value.category, 128)
    && validExactText(value.partOfSpeech, 64)
    && validExactText(value.emoji, 64)
    && validTrustedUrl(value.audioUrl, SHARED_AUDIO_HOSTS)
    && validTrustedUrl(value.imageUrl, SHARED_IMAGE_HOSTS);
};

const validCurrentCard = (value: unknown): value is DataRecord => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every(key => CURRENT_CARD_KEYS.includes(key as typeof CURRENT_CARD_KEYS[number])
    || key === 'mnemonic' || key === 'wordFamily')) return false;
  if (!CURRENT_CARD_KEYS.every(key => hasOwn(value, key))) return false;
  return validExactText(value.word, 256, true)
    && validExactText(value.translation, 256, true)
    && validExactText(value.explanation, 2_048)
    && validExactText(value.explanationTranslation, 2_048)
    && validExactText(value.phonetic, 256)
    && validExactText(value.category, 128)
    && validExactText(value.partOfSpeech, 64)
    && validExactText(value.cefrLevel, 8)
    && validExactText(value.exampleSentence, 2_048)
    && validExactText(value.exampleTranslation, 2_048)
    && validTextList(value.collocations, 100)
    && validTextList(value.synonyms, 100)
    && validTextList(value.antonyms, 100)
    && validExactText(value.register, 64)
    && validExactText(value.commonMistake, 2_048)
    && validExactText(value.imageSearchQuery, 120)
    && validExactText(value.emoji, 64)
    && validTrustedUrl(value.audioUrl, SHARED_AUDIO_HOSTS)
    && validTrustedUrl(value.imageUrl, SHARED_IMAGE_HOSTS)
    && (!hasOwn(value, 'mnemonic') || validExactText(value.mnemonic, 2_048, true))
    && (!hasOwn(value, 'wordFamily') || validWordFamily(value.wordFamily));
};

const validLegacyCreatedAt = (value: unknown): value is string => (
  validBoundedString(value, 128, 1) && value === value.trim() && Number.isFinite(Date.parse(value))
);

const validOwner = (value: unknown): value is string => validBoundedString(value, 128, 1);

const timestampEqual = (left: unknown, right: unknown): boolean => {
  const a = timestampCanonical(left);
  const b = timestampCanonical(right);
  return a !== null && b !== null && a.seconds === b.seconds && a.nanoseconds === b.nanoseconds;
};

const makeProposal = (scanStartedAt: string | undefined): string | null => {
  if (!scanStartedAt) return null;
  const millis = Date.parse(scanStartedAt);
  return Number.isFinite(millis)
    ? new Date(millis + LEGACY_SHARED_DECK_TTL_MS).toISOString()
    : null;
};

const millisFromTimestamp = (value: TimestampCanonical | null): number | null => {
  if (!value) return null;
  const seconds = Number(value.seconds);
  return Number.isSafeInteger(seconds)
    ? seconds * 1_000 + Math.floor(value.nanoseconds / 1_000_000)
    : null;
};

const extractRecord = (input: LegacySharedDeckRecord): {
  shareId: unknown;
  publicData: unknown;
  privateData: unknown;
} => {
  const source = input as DataRecord;
  const shareId = source.shareId ?? source.id;
  const publicData = hasOwn(source, 'publicData')
    ? source.publicData
    : hasOwn(source, 'public')
      ? source.public
      : hasOwn(source, 'data')
        ? source.data
        : Object.fromEntries(Object.entries(source).filter(([key]) => (
          !['shareId', 'id', 'privateData', 'private', 'ownership'].includes(key)
        )));
  const privateData = hasOwn(source, 'privateData')
    ? source.privateData
    : hasOwn(source, 'private')
      ? source.private
      : source.ownership;
  const directData = isRecord(publicData) && Object.keys(publicData).length === 0
    && privateData !== undefined ? undefined : publicData;
  return { shareId, publicData: directData, privateData };
};

const sourceDigest = (value: unknown): string | null => {
  try {
    return digestCanonicalValue(value);
  } catch {
    return null;
  }
};

type PublicShape =
  | { kind: 'legacy'; data: DataRecord; payloadDigest: string; payloadBytes: number }
  | { kind: 'transitional'; data: DataRecord; payloadDigest: string; payloadBytes: number }
  | { kind: 'current'; data: DataRecord; payloadDigest: string; payloadBytes: number };

const publicShape = (value: unknown): { shape: PublicShape | null; reasonCode: LegacyShareReasonCode } => {
  if (!isRecord(value)) return { shape: null, reasonCode: 'malformed-public' };
  const keys = Object.keys(value);
  let kind: PublicShape['kind'] | null = null;
  if (exactKeys(value, ['category', 'cards', 'createdAt'])) kind = 'legacy';
  else if (exactKeys(value, ['authorUid', 'category', 'cards', 'createdAt', 'expiresAt', 'schemaVersion'])) kind = 'transitional';
  else if (exactKeys(value, ['category', 'cards', 'createdAt', 'expiresAt', 'schemaVersion'])) kind = 'current';
  else if (keys.includes('cards') && Array.isArray(value.cards) && value.cards.length === 0) {
    return { shape: null, reasonCode: 'empty-public' };
  } else return { shape: null, reasonCode: 'malformed-public' };
  if (!validCategory(value.category) || !Array.isArray(value.cards) || value.cards.length > MAX_SHARED_DECKS) {
    return { shape: null, reasonCode: 'malformed-public' };
  }
  if (!Array.isArray(value.cards) || value.cards.length === 0) return { shape: null, reasonCode: 'empty-public' };
  if (!validCards(value.cards)) return { shape: null, reasonCode: 'malformed-public' };
  if (kind === 'legacy' && !validLegacyCreatedAt(value.createdAt)) {
    return { shape: null, reasonCode: 'malformed-public' };
  }
  if (kind === 'transitional' && (
    !validOwner(value.authorUid)
    || value.schemaVersion !== 1
    || !isTimestampLike(value.createdAt)
    || !isTimestampLike(value.expiresAt)
  )) return { shape: null, reasonCode: 'malformed-public' };
  if (kind === 'current' && (
    value.schemaVersion !== 2
    || !isTimestampLike(value.createdAt)
    || !isTimestampLike(value.expiresAt)
  )) return { shape: null, reasonCode: 'malformed-public' };
  const payload = exactPayload(value);
  if ('reasonCode' in payload) return { shape: null, reasonCode: payload.reasonCode };
  try {
    return {
      shape: { kind, data: value, payloadDigest: payload.digest, payloadBytes: payload.bytes },
      reasonCode: kind === 'legacy' ? 'owner-free-legacy' : kind === 'transitional' ? 'transitional-v1' : 'current',
    };
  } catch (error) {
    if (error instanceof LegacySharedDeckInventoryError && error.reasonCode === 'unsupported-value') {
      return { shape: null, reasonCode: 'unsupported-value' };
    }
    return {
      shape: null,
      reasonCode: error instanceof LegacySharedDeckInventoryError
        ? error.reasonCode
        : 'unsupported-value',
    };
  }
};

type PrivateShape = { version: 1 | 2; data: DataRecord; payloadBytes: number | null };

const privateShape = (value: unknown): { shape: PrivateShape | null; reasonCode: LegacyShareReasonCode } => {
  if (!isRecord(value)) return { shape: null, reasonCode: 'malformed-private' };
  if (exactKeys(value, ['ownerUid', 'createdAt', 'expiresAt', 'schemaVersion']) && value.schemaVersion === 1) {
    return validOwner(value.ownerUid) && isTimestampLike(value.createdAt) && isTimestampLike(value.expiresAt)
      ? { shape: { version: 1, data: value, payloadBytes: null }, reasonCode: 'private-v1-upgrade' }
      : { shape: null, reasonCode: 'malformed-private' };
  }
  if (exactKeys(value, ['ownerUid', 'createdAt', 'expiresAt', 'payloadBytes', 'schemaVersion']) && value.schemaVersion === 2) {
    const payloadBytes = value.payloadBytes;
    return validOwner(value.ownerUid)
      && isTimestampLike(value.createdAt)
      && isTimestampLike(value.expiresAt)
      && typeof payloadBytes === 'number'
      && Number.isSafeInteger(payloadBytes)
      && payloadBytes > 0
      && payloadBytes <= MAX_SHARED_DECK_PAYLOAD_BYTES
      ? { shape: { version: 2, data: value, payloadBytes }, reasonCode: 'private-v2-current' }
      : { shape: null, reasonCode: 'malformed-private' };
  }
  return { shape: null, reasonCode: 'malformed-private' };
};

const exactPayload = (
  value: DataRecord,
): { bytes: number; digest: string } | { reasonCode: LegacyShareReasonCode } => {
  if (!validCategory(value.category) || !validCards(value.cards)) return { reasonCode: 'malformed-public' };
  const cards = value.cards;
  const legacyCards = cards.every(validLegacyCard);
  const currentCards = cards.every(validCurrentCard);
  if (!legacyCards && !currentCards) return { reasonCode: 'malformed-public' };
  const payload = { category: value.category, cards };
  try {
    if (currentCards) {
      const parsed = parseCreateSharedDeckRequest(payload);
      if (canonicalize(payload) !== canonicalize({ category: parsed.category, cards: parsed.cards })) {
        return { reasonCode: 'malformed-public' };
      }
    }
    const serialized = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > MAX_SHARED_DECK_PAYLOAD_BYTES) return { reasonCode: 'malformed-public' };
    return {
      bytes,
      digest: createHash('sha256').update(serialized, 'utf8').digest('hex'),
    };
  } catch (error) {
    if (error instanceof LegacySharedDeckInventoryError && error.reasonCode === 'unsupported-value') {
      return { reasonCode: 'unsupported-value' };
    }
    return {
      reasonCode: error instanceof LegacySharedDeckInventoryError
        ? error.reasonCode
        : 'malformed-public',
    };
  }
};

const issueFor = (reasonCode: LegacyShareReasonCode): string | null => (
  reasonCode === 'current' || reasonCode === 'owner-free-legacy' || reasonCode === 'transitional-v1'
    || reasonCode === 'private-v1-upgrade' || reasonCode === 'private-v2-current' ? null : reasonCode
);

export const classifyLegacyShare = (
  input: LegacySharedDeckRecord,
  ownerUid: string,
  options: { readonly scanStartedAt?: string } = {},
): LegacyShareClassification => {
  const extracted = extractRecord(input);
  const shareId = typeof extracted.shareId === 'string' ? extracted.shareId : '';
  const publicDigest = sourceDigest(extracted.publicData);
  const privateDigest = extracted.privateData === undefined ? null : sourceDigest(extracted.privateData);
  const empty = {
    shareId,
    ownerUid,
    preserveShareId: true as const,
    publicDigest,
    privateDigest,
    payloadDigest: null,
    payloadBytes: null,
    payloadEquivalent: false,
    existingExpiresAt: null,
    proposedExpiresAt: null,
    expired: false,
  };
  if (!validOwner(ownerUid)) return {
    ...empty, action: 'block', disposition: 'block', reasonCode: 'owner-assertion-invalid', issue: issueFor('owner-assertion-invalid'),
  };
  if (!validShareId(shareId)) return {
    ...empty, action: 'block', disposition: 'block', reasonCode: 'invalid-share-id', issue: issueFor('invalid-share-id'),
  };
  const publicResult = publicShape(extracted.publicData);
  const privateResult = extracted.privateData === undefined
    ? { shape: null, reasonCode: null as LegacyShareReasonCode | null }
    : privateShape(extracted.privateData);
  if (extracted.publicData !== undefined && publicDigest === null) return {
    ...empty,
    action: 'block',
    disposition: 'block',
    reasonCode: 'unsupported-value',
    issue: issueFor('unsupported-value'),
  };
  if (!publicResult.shape) {
    if (extracted.publicData === undefined && privateResult.shape) {
      if (privateResult.shape.data.ownerUid !== ownerUid) return {
        ...empty, action: 'block', disposition: 'block', reasonCode: 'owner-mismatch', issue: issueFor('owner-mismatch'),
      };
      const orphanExpiresAt = timestampCanonical(privateResult.shape.data.expiresAt);
      const orphanExpired = options.scanStartedAt !== undefined
        && (millisFromTimestamp(orphanExpiresAt) ?? Number.POSITIVE_INFINITY) <= Date.parse(options.scanStartedAt);
      if (!orphanExpired) return {
        ...empty,
        action: 'block',
        disposition: 'block',
        reasonCode: 'orphan-private-active',
        existingExpiresAt: orphanExpiresAt,
        expired: false,
        issue: issueFor('orphan-private-active'),
      };
      return {
        ...empty,
        action: 'quarantine',
        disposition: 'quarantine-candidate',
        reasonCode: 'orphan-private',
        privateDigest,
        existingExpiresAt: orphanExpiresAt,
        expired: true,
        issue: issueFor('orphan-private'),
      };
    }
    if (extracted.publicData === undefined && privateResult.reasonCode === 'malformed-private') {
      const reasonCode = privateDigest === null ? 'unsupported-value' : 'malformed-private';
      return { ...empty, action: 'block', disposition: 'block', reasonCode, issue: issueFor(reasonCode) };
    }
    const reasonCode = publicResult.reasonCode;
    return { ...empty, action: 'block', disposition: 'block', reasonCode, issue: issueFor(reasonCode) };
  }
  if (publicDigest === null) return {
    ...empty,
    action: 'block',
    disposition: 'block',
    reasonCode: 'unsupported-value',
    issue: issueFor('unsupported-value'),
  };
  if (extracted.privateData !== undefined && privateDigest === null) return {
    ...empty,
    action: 'block',
    disposition: 'block',
    reasonCode: 'unsupported-value',
    issue: issueFor('unsupported-value'),
  };
  const shape = publicResult.shape;
  const payload = {
    ...empty,
    payloadDigest: shape.payloadDigest,
    payloadBytes: shape.payloadBytes,
    proposedExpiresAt: shape.kind === 'legacy' ? makeProposal(options.scanStartedAt) : null,
  };
  const existingExpiresAt = shape.kind === 'legacy' ? null : timestampCanonical(shape.data.expiresAt);
  const expiryMillis = millisFromTimestamp(existingExpiresAt)
    ?? (payload.proposedExpiresAt ? Date.parse(payload.proposedExpiresAt) : null);
  const base = {
    ...payload,
    existingExpiresAt,
    expired: expiryMillis !== null && options.scanStartedAt !== undefined
      ? expiryMillis <= Date.parse(options.scanStartedAt)
      : false,
  };
  if (privateResult.reasonCode === 'malformed-private') return {
    ...base, action: 'block', disposition: 'block', reasonCode: 'malformed-private', issue: issueFor('malformed-private'),
  };
  if (shape.kind === 'legacy') {
    if (privateResult.shape) {
      if (privateResult.shape.data.ownerUid !== ownerUid) return {
        ...base, action: 'block', disposition: 'block', reasonCode: 'owner-mismatch', issue: issueFor('owner-mismatch'),
      };
      if (privateResult.shape.version !== 1) return {
        ...base, action: 'block', disposition: 'block', reasonCode: 'private-conflict', issue: issueFor('private-conflict'),
      };
      const createdAtMillis = Date.parse(shape.data.createdAt as string);
      const privateCreatedAtMillis = millisFromTimestamp(timestampCanonical(privateResult.shape.data.createdAt));
      if (privateCreatedAtMillis === null || createdAtMillis !== privateCreatedAtMillis) return {
        ...base, action: 'block', disposition: 'block', reasonCode: 'timestamp-mismatch', issue: issueFor('timestamp-mismatch'),
      };
      const privateExpiresAt = timestampCanonical(privateResult.shape.data.expiresAt);
      const privateExpiryMillis = millisFromTimestamp(privateExpiresAt);
      return {
        ...base,
        action: 'migrate',
        disposition: 'migrate-owner-free-legacy',
        reasonCode: 'owner-free-legacy',
        existingExpiresAt: privateExpiresAt,
        proposedExpiresAt: null,
        expired: privateExpiryMillis !== null && options.scanStartedAt !== undefined
          ? privateExpiryMillis <= Date.parse(options.scanStartedAt)
          : false,
        issue: null,
      };
    }
    return { ...base, action: 'migrate', disposition: 'migrate-owner-free-legacy', reasonCode: 'owner-free-legacy', issue: null };
  }
  if (shape.kind === 'transitional' && shape.data.authorUid !== ownerUid) return {
    ...base, action: 'block', disposition: 'block', reasonCode: 'owner-mismatch', issue: issueFor('owner-mismatch'),
  };
  if (!privateResult.shape) {
    return shape.kind === 'transitional'
      ? { ...base, action: 'migrate', disposition: 'migrate-transitional', reasonCode: 'transitional-v1', issue: null }
      : { ...base, action: 'block', disposition: 'block', reasonCode: 'private-missing', issue: issueFor('private-missing') };
  }
  const privateRecord = privateResult.shape.data;
  if (privateRecord.ownerUid !== ownerUid) return {
    ...base, action: 'block', disposition: 'block', reasonCode: 'owner-mismatch', issue: issueFor('owner-mismatch'),
  };
  if (!timestampEqual(shape.data.createdAt, privateRecord.createdAt)
    || !timestampEqual(shape.data.expiresAt, privateRecord.expiresAt)) return {
    ...base, action: 'block', disposition: 'block', reasonCode: 'timestamp-mismatch', issue: issueFor('timestamp-mismatch'),
  };
  if (shape.kind === 'transitional' && privateResult.shape.version === 2) return {
    ...base, action: 'block', disposition: 'block', reasonCode: 'private-conflict', issue: issueFor('private-conflict'),
  };
  if (privateResult.shape.version === 2 && privateResult.shape.payloadBytes !== shape.payloadBytes) return {
    ...base, action: 'block', disposition: 'block', reasonCode: 'payload-mismatch', issue: issueFor('payload-mismatch'),
  };
  if (shape.kind === 'transitional') return {
    ...base, action: 'migrate', disposition: 'migrate-transitional', reasonCode: 'transitional-v1', issue: null,
  };
  if (privateResult.shape.version === 1) return {
    ...base, action: 'migrate', disposition: 'upgrade-private-v1', reasonCode: 'private-v1-upgrade', issue: null,
  };
  return {
    ...base, action: 'keep', disposition: 'keep-current', reasonCode: 'current', issue: null,
  };
};

const emptyCounts = (): Record<LegacyShareDisposition, number> => ({
  'keep-current': 0,
  'migrate-owner-free-legacy': 0,
  'migrate-transitional': 0,
  'upgrade-private-v1': 0,
  'quarantine-candidate': 0,
  block: 0,
});

const bump = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};

const validateRevision = (revision: string): void => {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision)) throw new LegacySharedDeckInventoryError('page-invalid');
};

const validateOptions = (options: LegacySharedDeckInventoryOptions): void => {
  if (!validOwner(options.ownerUid)) throw new LegacySharedDeckInventoryError('owner-assertion-invalid');
  if (!validBoundedString(options.runId, 128, 1) || !validBoundedString(options.target, 128, 1)) {
    throw new LegacySharedDeckInventoryError('page-invalid');
  }
  validateRevision(options.revision);
  if (!Number.isFinite(Date.parse(options.scanStartedAt))) throw new LegacySharedDeckInventoryError('page-invalid');
  if (options.maxPageBytes !== undefined && (!Number.isSafeInteger(options.maxPageBytes) || options.maxPageBytes <= 0 || options.maxPageBytes > MAX_PAGE_BYTES)) {
    throw new LegacySharedDeckInventoryError('page-invalid');
  }
};

const checkResume = (options: LegacySharedDeckInventoryOptions): LegacySharedDeckCheckpoint | null => {
  const resume = options.resume;
  if (!resume) return null;
  if (resume.ownerKey !== hashOwnerKey(options.ownerUid)
    || resume.runId !== options.runId
    || resume.revision !== options.revision
    || resume.target !== options.target
    || resume.scanStartedAt !== options.scanStartedAt
    || (options.previousDigest !== undefined && resume.previousDigest !== options.previousDigest)
    || !Number.isSafeInteger(resume.chunkIndex)
    || resume.chunkIndex < -1) {
    throw new LegacySharedDeckResumeError();
  }
  return resume;
};

const drainMergeBuffers = (
  publicBuffer: LegacySharedDeckDocument[],
  privateBuffer: LegacySharedDeckDocument[],
  publicTerminal: boolean,
  privateTerminal: boolean,
): LegacySharedDeckRecord[] => {
  const records: LegacySharedDeckRecord[] = [];
  while (publicBuffer.length > 0 || privateBuffer.length > 0) {
    const publicDocument = publicBuffer[0];
    const privateDocument = privateBuffer[0];
    if (publicDocument && privateDocument) {
      const order = utf8Compare(publicDocument.id, privateDocument.id);
      if (order === 0) {
        records.push({
          shareId: publicDocument.id,
          publicData: publicDocument.data,
          privateData: privateDocument.data,
        });
        publicBuffer.shift();
        privateBuffer.shift();
      } else if (order < 0) {
        records.push({ shareId: publicDocument.id, publicData: publicDocument.data });
        publicBuffer.shift();
      } else {
        records.push({ shareId: privateDocument.id, privateData: privateDocument.data });
        privateBuffer.shift();
      }
    } else if (publicDocument) {
      if (!privateTerminal) break;
      records.push({ shareId: publicDocument.id, publicData: publicDocument.data });
      publicBuffer.shift();
    } else if (privateDocument) {
      if (!publicTerminal) break;
      records.push({ shareId: privateDocument.id, privateData: privateDocument.data });
      privateBuffer.shift();
    }
  }
  return records;
};

const streamSourceBytes = (documents: readonly LegacySharedDeckDocument[]): number => (
  documents.reduce((total, document) => total + canonicalUtf8Bytes(document.data).byteLength, 0)
);

const appendOrderedDocuments = (
  buffer: LegacySharedDeckDocument[],
  documents: readonly LegacySharedDeckDocument[],
): void => {
  for (let index = 1; index < documents.length; index += 1) {
    if (utf8Compare(documents[index - 1].id, documents[index].id) >= 0) {
      throw new LegacySharedDeckInventoryError('page-invalid');
    }
  }
  if (buffer.at(-1) && documents[0] && utf8Compare(buffer.at(-1)!.id, documents[0].id) >= 0) {
    throw new LegacySharedDeckInventoryError('page-invalid');
  }
  buffer.push(...documents);
};

const readStreamPage = async (
  store: LegacySharedDeckInventoryStore,
  source: 'public' | 'private',
  after: string | null,
): Promise<LegacySharedDeckStreamPage> => {
  return store.readPage({ source, after, limit: MAX_PAGE_DOCUMENTS });
};

const entryFor = (
  record: LegacySharedDeckRecord,
  ownerUid: string,
  scanStartedAt: string,
): LegacySharedDeckInventoryEntry => {
  const classification = classifyLegacyShare(record, ownerUid, { scanStartedAt });
  return {
    ...classification,
    publicSourceDigest: classification.publicDigest,
    privateSourceDigest: classification.privateDigest,
  };
};

const markPayloadEquivalence = (entries: LegacySharedDeckInventoryEntry[]): LegacySharedDeckInventoryEntry[] => {
  const payloadCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.payloadDigest) payloadCounts.set(entry.payloadDigest, (payloadCounts.get(entry.payloadDigest) ?? 0) + 1);
  }
  return entries.map(entry => ({
    ...entry,
    payloadEquivalent: entry.payloadDigest !== null && (payloadCounts.get(entry.payloadDigest) ?? 0) > 1,
  }));
};

const chunkDigest = (
  index: number,
  previousDigest: string,
  context: LegacySharedDeckChainContext,
  entries: readonly LegacySharedDeckInventoryEntry[],
  beforePublicCursor: string | null,
  beforePrivateCursor: string | null,
  afterPublicCursor: string | null,
  afterPrivateCursor: string | null,
  publicTerminal: boolean,
  privateTerminal: boolean,
): string => digestCanonicalValue({
  context,
  index,
  previousDigest,
  entries: entries.map(entry => ({
    shareId: entry.shareId,
    publicDigest: entry.publicDigest,
    privateDigest: entry.privateDigest,
    payloadDigest: entry.payloadDigest,
    disposition: entry.disposition,
    reasonCode: entry.reasonCode,
    existingExpiresAt: entry.existingExpiresAt,
    proposedExpiresAt: entry.proposedExpiresAt,
  })),
  beforePublicCursor,
  beforePrivateCursor,
  afterPublicCursor,
  afterPrivateCursor,
  publicTerminal,
  privateTerminal,
});

export async function createLegacySharedDeckInventory(
  options: LegacySharedDeckInventoryOptions,
): Promise<LegacySharedDeckInventory> {
  validateOptions(options);
  const resume = checkResume(options);
  const maxPageBytes = options.maxPageBytes ?? MAX_PAGE_BYTES;
  const collectEntries = options.collectEntries ?? false;
  const collectChunks = options.collectChunks ?? false;
  let readPublicCursor = resume?.publicCursor ?? null;
  let readPrivateCursor = resume?.privateCursor ?? null;
  let sourcePublicTerminal = resume?.publicTerminal ?? false;
  let sourcePrivateTerminal = resume?.privateTerminal ?? false;
  let publicCursor = readPublicCursor;
  let privateCursor = readPrivateCursor;
  let publicTerminal = sourcePublicTerminal;
  let privateTerminal = sourcePrivateTerminal;
  const ownerKey = hashOwnerKey(options.ownerUid);
  const context = {
    ownerKey,
    runId: options.runId,
    revision: options.revision,
    target: options.target,
    scanStartedAt: options.scanStartedAt,
  };
  const contextSeed = digestCanonicalValue({
    context,
    previousDigest: options.previousDigest ?? null,
    seed: 'legacy-shared-deck-inventory',
  });
  let chainHead = resume?.previousDigest ?? contextSeed;
  let previousReadPublicCursor = readPublicCursor;
  let previousReadPrivateCursor = readPrivateCursor;
  let checkpointBeforePublicCursor = publicCursor;
  let checkpointBeforePrivateCursor = privateCursor;
  let chunkIndex = resume ? resume.chunkIndex + 1 : 0;
  const chunks: LegacySharedDeckSealedChunk[] = [];
  const publicBuffer: LegacySharedDeckDocument[] = [];
  const privateBuffer: LegacySharedDeckDocument[] = [];
  const allEntries: LegacySharedDeckInventoryEntry[] = [];
  const evidence = {
    shareKeys: [] as string[],
    issues: [] as LegacySharedDeckEvidenceIssue[],
    shareKeysOmittedCount: 0,
    issuesOmittedCount: 0,
  };
  const equivalentPayloads = new Map<string, {
    count: number;
    shareKeys: string[];
    shareKeysOmittedCount: number;
  }>();
  let totalPublicBytes = 0;
  let totalPrivateBytes = 0;
  let totalPayloadBytes = 0;
  const streamCounts = emptyCounts();
  const streamReasons: Record<string, number> = {};
  let streamActiveCount = 0;
  let streamActiveBytes = 0;
  let streamExpiredCount = 0;
  let pageCount = 0;
  while (!(sourcePublicTerminal && sourcePrivateTerminal
    && publicBuffer.length === 0 && privateBuffer.length === 0)) {
    const beforePublicCursor = publicCursor;
    const beforePrivateCursor = privateCursor;
    const beforeChainHead = chainHead;
    const beforePublicTerminal = publicTerminal;
    const beforePrivateTerminal = privateTerminal;
    const needPublicPage = publicBuffer.length === 0 && !sourcePublicTerminal;
    const needPrivatePage = privateBuffer.length === 0 && !sourcePrivateTerminal;
    let fetchedBytes = 0;
    if (needPublicPage || needPrivatePage) {
      if (needPublicPage) {
        const page = await readStreamPage(options.store, 'public', readPublicCursor);
        pageCount += 1;
        if (pageCount > 10_000 || page.documents.length > MAX_PAGE_DOCUMENTS) throw new LegacySharedDeckInventoryError('page-invalid');
        const bytes = streamSourceBytes(page.documents);
        fetchedBytes += bytes;
        if (fetchedBytes > maxPageBytes) throw new LegacySharedDeckInventoryError('page-too-large');
        if (!page.terminal && page.cursor === previousReadPublicCursor) throw new LegacySharedDeckInventoryError('page-invalid');
        appendOrderedDocuments(publicBuffer, page.documents);
        totalPublicBytes += bytes;
        readPublicCursor = page.cursor;
        sourcePublicTerminal = page.terminal;
        previousReadPublicCursor = readPublicCursor;
      }
      if (needPrivatePage) {
        const page = await readStreamPage(options.store, 'private', readPrivateCursor);
        pageCount += 1;
        if (pageCount > 10_000 || page.documents.length > MAX_PAGE_DOCUMENTS) throw new LegacySharedDeckInventoryError('page-invalid');
        const bytes = streamSourceBytes(page.documents);
        fetchedBytes += bytes;
        if (fetchedBytes > maxPageBytes) throw new LegacySharedDeckInventoryError('page-too-large');
        if (!page.terminal && page.cursor === previousReadPrivateCursor) throw new LegacySharedDeckInventoryError('page-invalid');
        appendOrderedDocuments(privateBuffer, page.documents);
        totalPrivateBytes += bytes;
        readPrivateCursor = page.cursor;
        sourcePrivateTerminal = page.terminal;
        previousReadPrivateCursor = readPrivateCursor;
      }
      if (streamSourceBytes([...publicBuffer, ...privateBuffer]) > maxPageBytes) {
        throw new LegacySharedDeckInventoryError('page-too-large');
      }
    }
    publicTerminal = sourcePublicTerminal && publicBuffer.length === 0;
    privateTerminal = sourcePrivateTerminal && privateBuffer.length === 0;
    const records = drainMergeBuffers(publicBuffer, privateBuffer, sourcePublicTerminal, sourcePrivateTerminal);
    if (records.length === 0) {
      if (!needPublicPage && !needPrivatePage) throw new LegacySharedDeckInventoryError('page-invalid');
      if (publicTerminal !== beforePublicTerminal || privateTerminal !== beforePrivateTerminal) {
        const pageDigest = chunkDigest(
          chunkIndex,
          beforeChainHead,
          context,
          [],
          beforePublicCursor,
          beforePrivateCursor,
          publicCursor,
          privateCursor,
          publicTerminal,
          privateTerminal,
        );
        chainHead = pageDigest;
        const chunk: LegacySharedDeckSealedChunk = {
          index: chunkIndex,
          previousDigest: beforeChainHead,
          digest: pageDigest,
          publicCursor,
          privateCursor,
          publicTerminal,
          privateTerminal,
          beforePublicCursor,
          beforePrivateCursor,
          entries: [],
        };
        if (collectChunks) chunks.push(chunk);
        checkpointBeforePublicCursor = beforePublicCursor;
        checkpointBeforePrivateCursor = beforePrivateCursor;
        chunkIndex += 1;
        if (options.onChunk) await options.onChunk(chunk);
      }
      continue;
    }
    if (records.length > MAX_SEALED_CHUNK_ENTRIES) throw new LegacySharedDeckInventoryError('page-invalid');
    const entries = records.map(record => entryFor(record, options.ownerUid, options.scanStartedAt));
    for (const record of records) {
      if (record.publicData !== undefined) publicCursor = record.shareId as string;
      if (record.privateData !== undefined) privateCursor = record.shareId as string;
    }
    publicTerminal = sourcePublicTerminal && publicBuffer.length === 0;
    privateTerminal = sourcePrivateTerminal && privateBuffer.length === 0;
    const pageDigest = chunkDigest(
      chunkIndex,
      beforeChainHead,
      context,
      entries,
      beforePublicCursor,
      beforePrivateCursor,
      publicCursor,
      privateCursor,
      publicTerminal,
      privateTerminal,
    );
    chainHead = pageDigest;
    for (const entry of entries) {
      if (collectEntries) allEntries.push(entry);
      if (evidence.shareKeys.length < MAX_ISSUE_DETAIL) evidence.shareKeys.push(hashShareKey(entry.shareId));
      else evidence.shareKeysOmittedCount += 1;
      if (entry.issue !== null) {
        if (evidence.issues.length < MAX_ISSUE_DETAIL) {
          evidence.issues.push({ shareKey: hashShareKey(entry.shareId), reasonCode: entry.reasonCode });
        } else {
          evidence.issuesOmittedCount += 1;
        }
      }
      if (entry.payloadDigest !== null) {
        const payloadEvidence = equivalentPayloads.get(entry.payloadDigest);
        if (payloadEvidence) {
          payloadEvidence.count += 1;
          if (payloadEvidence.shareKeys.length < MAX_PAYLOAD_SAMPLE_KEYS) {
            payloadEvidence.shareKeys.push(hashShareKey(entry.shareId));
          } else {
            payloadEvidence.shareKeysOmittedCount += 1;
          }
        } else {
          equivalentPayloads.set(entry.payloadDigest, {
            count: 1,
            shareKeys: [hashShareKey(entry.shareId)],
            shareKeysOmittedCount: 0,
          });
        }
      }
      if (entry.payloadBytes !== null) totalPayloadBytes += entry.payloadBytes;
      if (!collectEntries) {
        bump(streamCounts, entry.disposition);
        bump(streamReasons, entry.reasonCode);
        const expiryMillis = millisFromTimestamp(entry.existingExpiresAt)
          ?? (entry.proposedExpiresAt ? Date.parse(entry.proposedExpiresAt) : null);
        if (expiryMillis !== null && expiryMillis <= Date.parse(options.scanStartedAt)) streamExpiredCount += 1;
        else if (entry.disposition !== 'block' && entry.disposition !== 'quarantine-candidate') {
          streamActiveCount += 1;
          streamActiveBytes += entry.payloadBytes ?? 0;
        }
      }
    }
    const chunk: LegacySharedDeckSealedChunk = {
      index: chunkIndex,
      previousDigest: beforeChainHead,
      digest: pageDigest,
      publicCursor,
      privateCursor,
      publicTerminal,
      privateTerminal,
      beforePublicCursor,
      beforePrivateCursor,
      entries,
    };
    if (collectChunks) chunks.push(chunk);
    checkpointBeforePublicCursor = beforePublicCursor;
    checkpointBeforePrivateCursor = beforePrivateCursor;
    chunkIndex += 1;
    if (options.onChunk) await options.onChunk(chunk);
  }
  /* Each source page is bounded; merged chunks remain well below the sealed limit. */
  const equivalenceEntries = collectEntries ? markPayloadEquivalence(allEntries) : [];
  const equivalentById = new Map(equivalenceEntries.map(entry => [entry.shareId, entry]));
  const equivalentChunks = chunks.map(chunk => ({
    ...chunk,
    entries: chunk.entries.map(entry => equivalentById.get(entry.shareId) ?? entry),
  }));
  const counts = collectEntries ? emptyCounts() : streamCounts;
  const reasons = collectEntries ? {} : streamReasons;
  let activeCount = collectEntries ? 0 : streamActiveCount;
  let activeBytes = collectEntries ? 0 : streamActiveBytes;
  let expiredCount = collectEntries ? 0 : streamExpiredCount;
  if (collectEntries) for (const original of allEntries) {
    const entry = equivalentById.get(original.shareId) ?? original;
    bump(counts, entry.disposition);
    bump(reasons, entry.reasonCode);
    const expiryMillis = millisFromTimestamp(entry.existingExpiresAt)
      ?? (entry.proposedExpiresAt ? Date.parse(entry.proposedExpiresAt) : null);
    const active = expiryMillis === null || expiryMillis > Date.parse(options.scanStartedAt);
    if (!active) {
      expiredCount += 1;
      continue;
    }
    if (entry.disposition !== 'block' && entry.disposition !== 'quarantine-candidate') {
      activeCount += 1;
      activeBytes += entry.payloadBytes ?? 0;
    }
  }
  const quota: LegacySharedDeckQuota = {
    activeCount,
    activeBytes,
    maximumCount: MAX_SHARED_DECKS,
    maximumBytes: MAX_SHARED_DECK_BYTES,
    overCount: activeCount > MAX_SHARED_DECKS,
    overBytes: activeBytes > MAX_SHARED_DECK_BYTES,
    overCap: activeCount > MAX_SHARED_DECKS || activeBytes > MAX_SHARED_DECK_BYTES,
  };
  const duplicatePayloads = [...equivalentPayloads.entries()]
    .filter(([, payloadEvidence]) => payloadEvidence.count > 1);
  const equivalentPayloadEvidence = duplicatePayloads
    .slice(0, MAX_ISSUE_DETAIL)
    .map(([payloadDigest, payloadEvidence]) => ({
      equivalenceKey: equivalenceKey(payloadDigest, options.ownerUid, context),
      count: payloadEvidence.count,
      shareKeys: payloadEvidence.shareKeys,
      shareKeysOmittedCount: payloadEvidence.shareKeysOmittedCount,
    }));
  return {
    ownerUid: options.ownerUid,
    runId: options.runId,
    revision: options.revision,
    target: options.target,
    scanStartedAt: options.scanStartedAt,
    consistency: 'unfrozen',
    applyEligible: false,
    entries: equivalenceEntries,
    chunks: collectChunks ? equivalentChunks : [],
    publicCursor,
    privateCursor,
    publicTerminal,
    privateTerminal,
    checkpoint: {
      ownerKey,
      runId: options.runId,
      revision: options.revision,
      target: options.target,
      scanStartedAt: options.scanStartedAt,
      previousDigest: chainHead,
      publicCursor,
      privateCursor,
      publicTerminal,
      privateTerminal,
      chunkIndex: chunkIndex === 0 ? -1 : chunkIndex - 1,
      beforePublicCursor: checkpointBeforePublicCursor,
      beforePrivateCursor: checkpointBeforePrivateCursor,
      afterPublicCursor: publicCursor,
      afterPrivateCursor: privateCursor,
    },
    chainHead,
    totalPublicBytes,
    totalPrivateBytes,
    totalPayloadBytes,
    counts,
    reasons,
    quota,
    activeOwner: {
      ownerKey,
      activeCount,
      activeBytes,
      expiredCount,
    },
    evidence: {
      ...evidence,
      equivalentPayloads: equivalentPayloadEvidence,
      equivalentPayloadsOmittedCount: Math.max(0, duplicatePayloads.length - MAX_ISSUE_DETAIL),
    },
  };
}

export const buildRedactedInventoryReport = (
  inventory: LegacySharedDeckInventory,
): Record<string, unknown> => ({
  schemaVersion: 1,
  ownerKey: inventory.activeOwner.ownerKey,
  shareKeys: inventory.evidence.shareKeys,
  issues: inventory.evidence.issues,
  shareKeysOmittedCount: inventory.evidence.shareKeysOmittedCount,
  issuesOmittedCount: inventory.evidence.issuesOmittedCount,
  equivalentPayloads: inventory.evidence.equivalentPayloads,
  equivalentPayloadsOmittedCount: inventory.evidence.equivalentPayloadsOmittedCount,
  counts: inventory.counts,
  reasons: inventory.reasons,
  bytes: {
    publicSource: inventory.totalPublicBytes,
    privateSource: inventory.totalPrivateBytes,
    payload: inventory.totalPayloadBytes,
  },
  quota: inventory.quota,
  consistency: inventory.consistency,
  applyEligible: inventory.applyEligible,
  publicTerminal: inventory.publicTerminal,
  privateTerminal: inventory.privateTerminal,
  chainHead: inventory.chainHead,
});

export const buildInventoryReport = (inventory: LegacySharedDeckInventory): string => (
  JSON.stringify(buildRedactedInventoryReport(inventory))
);

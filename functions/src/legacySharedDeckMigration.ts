import { createHash, createHmac, verify as verifySignature, type KeyObject } from 'node:crypto';
import { Timestamp, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
import {
  parseCreateSharedDeckRequest,
} from './inputValidation.js';

export const LEGACY_SHARED_DECK_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const APPLY_SHARED_DECK_CONFIRMATION = 'APPLY_SHARED_DECK_V2';
export const SUPERSEDE_SHARED_DECK_CONFIRMATION = 'SUPERSEDE_SHARED_DECK_V2';
export const MAX_SHARED_DECKS = 100;
export const MAX_SHARED_DECK_BYTES = 25_000_000;
export const MAX_SHARED_DECK_PAYLOAD_BYTES = 750_000;
export const MAX_PAGE_DOCUMENTS = 10;
export const MAX_PAGE_BYTES = 64 * 1024 * 1024;
export const MAX_SEALED_CHUNK_ENTRIES = 100;
export const MAX_SEALED_MANIFEST_CHUNK_BYTES = 512 * 1024;
export const MAX_SEALED_MANIFEST_CHUNK_ENTRIES = 50;
/** Keep quarantine documents comfortably below Firestore's 1 MiB limit. */
export const MAX_QUARANTINE_DOCUMENT_BYTES = 900 * 1024;
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
  | 'timestamp-out-of-range'
  | 'timestamp-mismatch'
  | 'payload-mismatch'
  | 'private-conflict'
  | 'malformed-public'
  | 'malformed-private'
  | 'empty-public'
  | 'unsupported-value'
  | 'quarantine-too-large'
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
  readonly beginFreeze?: (request: {
    readonly ownerUid: string;
    readonly revision: string;
    readonly target: string;
    readonly scanStartedAt: string;
  }) => Promise<{ readonly scanStartedAt: string } | void>;
  readonly sealFreeze?: (request: {
    readonly ownerUid: string;
    readonly revision: string;
    readonly target: string;
    readonly inventoryDigest: string;
    readonly manifest: LegacySharedDeckSealedManifest;
    readonly chunks: readonly LegacySharedDeckManifestChunk[];
  }) => Promise<void>;
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
  readonly publicSourceBytes: number | null;
  readonly privateSourceBytes: number | null;
  readonly publicSourceStorageBytes: number | null;
  readonly privateSourceStorageBytes: number | null;
  readonly publicCreatedAt: TimestampCanonical | null;
  readonly privateCreatedAt: TimestampCanonical | null;
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
  /** Fresh scans always start at both null cursors and cannot resume. */
  readonly fresh?: boolean;
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
  readonly consistency: 'unfrozen' | 'frozen';
  readonly applyEligible: boolean;
  readonly entries: readonly LegacySharedDeckInventoryEntry[];
  readonly chunks: readonly LegacySharedDeckSealedChunk[];
  readonly publicCursor: string | null;
  readonly privateCursor: string | null;
  readonly publicTerminal: boolean;
  readonly privateTerminal: boolean;
  readonly checkpoint: LegacySharedDeckCheckpoint;
  readonly chainHead: string;
  readonly inventoryDigest: string;
  readonly sealedManifest: LegacySharedDeckSealedManifest | null;
  readonly sealedChunks: readonly LegacySharedDeckManifestChunk[];
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
  constructor(reasonCode: LegacyShareReasonCode, detail: string = reasonCode) {
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

export type LegacySharedDeckSealedManifest = {
  readonly schemaVersion: 2;
  readonly ownerUid: string;
  readonly target: string;
  readonly revision: string;
  readonly scanStartedAt: string;
  readonly inventoryDigest: string;
  /** Immutable namespace prevents a later revision from reusing old chunks. */
  readonly chunkNamespace: string;
  readonly entryCount: number;
  readonly chunkCount: number;
  readonly seedDigest: string;
  readonly lastChunkDigest: string;
  readonly rootDigest: string;
  readonly counts: Readonly<Record<LegacyShareDisposition, number>>;
  readonly quota: LegacySharedDeckQuota;
  readonly applyEligible: boolean;
};

export type LegacySharedDeckManifestChunk = {
  readonly schemaVersion: 2;
  readonly ownerUid: string;
  readonly target: string;
  readonly revision: string;
  readonly chunkNamespace: string;
  readonly index: number;
  readonly previousDigest: string;
  readonly digest: string;
  readonly entries: readonly LegacySharedDeckInventoryEntry[];
};

export type LegacySharedDeckBackupManifestUnsigned = {
  readonly schemaVersion: 2;
  readonly backupObjectId: string;
  readonly backupGeneration: string;
  readonly backupDigest: string;
  readonly inventoryDigest: string;
  readonly target: string;
  readonly revision: string;
  readonly ownerUid: string;
  readonly verifiedAt: string;
};

export type LegacySharedDeckBackupManifest = LegacySharedDeckBackupManifestUnsigned & {
  readonly signature: string;
};

export const canonicalLegacySharedDeckBackupManifest = (
  manifest: LegacySharedDeckBackupManifestUnsigned,
): Buffer => Buffer.from(canonicalUtf8Bytes(manifest));

export const verifyLegacySharedDeckBackupManifest = (
  manifest: unknown,
  expected: { readonly digest: string; readonly target: string; readonly revision: string; readonly ownerUid: string },
  publicKey: KeyObject | string | Buffer,
  now = Date.now(),
): manifest is LegacySharedDeckBackupManifest => {
  if (!isRecord(manifest)
    || !exactKeys(manifest, [
      'schemaVersion', 'backupObjectId', 'backupGeneration', 'backupDigest',
      'inventoryDigest', 'target', 'revision', 'ownerUid', 'verifiedAt', 'signature',
    ])
    || manifest.schemaVersion !== 2
    || typeof manifest.backupObjectId !== 'string'
    || !validBoundedString(manifest.backupObjectId, 512, 1)
    || /^placeholder|test$/i.test(manifest.backupObjectId)
    || typeof manifest.backupGeneration !== 'string'
    || !/^[1-9][0-9]{0,39}$/.test(manifest.backupGeneration)
    || typeof manifest.backupDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(manifest.backupDigest)
    || /^0+$/.test(manifest.backupDigest)
    || typeof manifest.inventoryDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(manifest.inventoryDigest)
    || /^0+$/.test(manifest.inventoryDigest)
    || manifest.inventoryDigest !== expected.digest
    || manifest.target !== expected.target
    || manifest.revision !== expected.revision
    || manifest.ownerUid !== expected.ownerUid
    || typeof manifest.verifiedAt !== 'string'
    || !Number.isFinite(Date.parse(manifest.verifiedAt))
    || Math.abs(Date.parse(manifest.verifiedAt) - now) > 24 * 60 * 60 * 1_000
    || typeof manifest.signature !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(manifest.signature)) {
    throw new LegacySharedDeckInventoryError('page-invalid', 'backup manifest binding is invalid');
  }
  const unsigned = { ...manifest } as Record<string, unknown>;
  delete unsigned.signature;
  if (!verifySignature(
    null,
    canonicalLegacySharedDeckBackupManifest(unsigned as unknown as LegacySharedDeckBackupManifestUnsigned),
    publicKey,
    Buffer.from(manifest.signature, 'base64'),
  )) {
    throw new LegacySharedDeckInventoryError('page-invalid', 'backup manifest signature is invalid');
  }
  return true;
};

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

// Firestore Timestamp accepts instants from year 0001 through the end of
// year 9999. Keep the check explicit so inventory cannot seal a value which
// the apply path cannot represent, while still accepting valid pre-epoch
// instants.
const FIRESTORE_TIMESTAMP_MIN_SECONDS = -62_135_596_800;
const FIRESTORE_TIMESTAMP_MAX_SECONDS = 253_402_300_799;

const isFirestoreTimestampRange = (value: TimestampCanonical): boolean => {
  const seconds = Number(value.seconds);
  return Number.isSafeInteger(seconds)
    && seconds >= FIRESTORE_TIMESTAMP_MIN_SECONDS
    && seconds <= FIRESTORE_TIMESTAMP_MAX_SECONDS
    && Number.isSafeInteger(value.nanoseconds)
    && value.nanoseconds >= 0
    && value.nanoseconds <= 999_999_999;
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
  if (!(value instanceof Timestamp)) return null;
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

/**
 * Conservative Firestore document-size estimate. Firestore encodes field
 * names, scalar type/value tags, nested map/array members, and a document
 * envelope; this intentionally overestimates each component and leaves a
 * fixed margin for the document name and request metadata.
 */
const FIRESTORE_DOCUMENT_ENVELOPE_BYTES = 1_024;
const firestoreUtf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

const estimateFirestoreValueBytes = (value: unknown, seen = new Set<object>()): number => {
  if (value === null) return 1;
  if (typeof value === 'string') return firestoreUtf8Bytes(value) + 1;
  if (typeof value === 'boolean') return 2;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new LegacySharedDeckInventoryError('unsupported-value');
    return 9;
  }
  if (value instanceof Uint8Array) return value.byteLength + 1;
  // Only the Admin SDK Timestamp wire value has the compact timestamp
  // representation. Plain seconds/nanoseconds objects are ordinary maps in
  // Firestore and must include their field/map overhead.
  if (value instanceof Timestamp) return 8;
  if (typeof value !== 'object' || seen.has(value)) {
    throw new LegacySharedDeckInventoryError('unsupported-value');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return 1 + value.reduce((total, item) => total + estimateFirestoreValueBytes(item, seen) + 1, 0);
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new LegacySharedDeckInventoryError('unsupported-value');
    }
    // Firestore sizes every map like a document, including its 32-byte map
    // envelope; omitting this makes arrays of small maps look artificially tiny.
    return 32 + Object.entries(value as DataRecord).reduce(
      (total, [key, item]) => total + firestoreUtf8Bytes(key) + 1 + estimateFirestoreValueBytes(item, seen),
      0,
    );
  } finally {
    seen.delete(value);
  }
};

export const estimateFirestoreDocumentBytes = (value: unknown, documentName = ''): number => (
  estimateFirestoreValueBytes(value)
  + firestoreUtf8Bytes(documentName) + 1
  + FIRESTORE_DOCUMENT_ENVELOPE_BYTES
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

const sourceBytes = (value: unknown): number | null => {
  try {
    return canonicalUtf8Bytes(value).byteLength;
  } catch {
    return null;
  }
};

const sourceCreatedAtCanonical = (value: unknown): TimestampCanonical | null => {
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) return null;
    const seconds = Math.floor(millis / 1_000);
    const canonical = {
      seconds: String(seconds),
      nanoseconds: (millis - seconds * 1_000) * 1_000_000,
    };
    return isFirestoreTimestampRange(canonical) ? canonical : null;
  }
  const canonical = timestampCanonical(value);
  return canonical !== null && isFirestoreTimestampRange(canonical) ? canonical : null;
};

const timestampValueInFirestoreRange = (value: unknown): boolean => {
  const canonical = timestampCanonical(value);
  return canonical !== null && isFirestoreTimestampRange(canonical);
};

const quarantineEnvelopeBytes = (
  ownerUid: string,
  shareId: string,
  reasonCode: LegacyShareReasonCode,
  publicData: unknown,
  privateData: unknown,
): number | null => {
  const envelope = {
  schemaVersion: 2,
  ownerUid,
  revision: '0'.repeat(64),
  shareId,
  reasonCode,
  publicData: publicData ?? null,
  privateData: privateData ?? null,
  publicSourceDigest: sourceDigest(publicData),
  privateSourceDigest: sourceDigest(privateData),
  };
  try {
    return estimateFirestoreDocumentBytes(envelope, `admin_shared_deck_migration_quarantine/${shareId}`);
  } catch {
    return null;
  }
};

const quarantineFitsDocumentBound = (
  ownerUid: string,
  shareId: string,
  reasonCode: LegacyShareReasonCode,
  publicData: unknown,
  privateData: unknown,
): boolean => {
  const bytes = quarantineEnvelopeBytes(ownerUid, shareId, reasonCode, publicData, privateData);
  return bytes !== null && bytes <= MAX_QUARANTINE_DOCUMENT_BYTES;
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
  const publicCreatedAt = isRecord(extracted.publicData)
    ? sourceCreatedAtCanonical(extracted.publicData.createdAt) : null;
  const privateCreatedAt = isRecord(extracted.privateData)
    ? sourceCreatedAtCanonical(extracted.privateData.createdAt) : null;
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
    publicCreatedAt,
    privateCreatedAt,
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
  // A present createdAt which cannot be canonicalized is an attribution/data
  // integrity ambiguity, not a safely copyable malformed record. Block it
  // before any quarantine or apply write; this includes out-of-range
  // Firestore seconds and invalid legacy strings.
  if ((isRecord(extracted.publicData) && hasOwn(extracted.publicData, 'createdAt') && publicCreatedAt === null)
    || (isRecord(extracted.privateData) && hasOwn(extracted.privateData, 'createdAt') && privateCreatedAt === null)) {
    return {
      ...empty,
      action: 'block',
      disposition: 'block',
      reasonCode: 'timestamp-out-of-range',
      issue: issueFor('timestamp-out-of-range'),
    };
  }
  if ((isRecord(extracted.publicData)
    && hasOwn(extracted.publicData, 'expiresAt')
    && !timestampValueInFirestoreRange(extracted.publicData.expiresAt))
    || (isRecord(extracted.privateData)
      && hasOwn(extracted.privateData, 'expiresAt')
      && !timestampValueInFirestoreRange(extracted.privateData.expiresAt))) {
    return {
      ...empty,
      action: 'block',
      disposition: 'block',
      reasonCode: 'timestamp-out-of-range',
      issue: issueFor('timestamp-out-of-range'),
    };
  }
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
      if (!quarantineFitsDocumentBound(ownerUid, shareId, 'orphan-private', extracted.publicData, extracted.privateData)) return {
        ...empty,
        action: 'block',
        disposition: 'block',
        reasonCode: 'quarantine-too-large',
        issue: issueFor('quarantine-too-large'),
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
    // A digestable public record with no private sidecar can be copied into
    // server-only quarantine.  Ownership/timestamp/private ambiguity stays a
    // hard block; unsupported values have no trustworthy source digest.
    if (extracted.publicData !== undefined
      && extracted.privateData === undefined
      && publicDigest !== null
      && (reasonCode === 'empty-public' || reasonCode === 'malformed-public')) {
      if (!quarantineFitsDocumentBound(ownerUid, shareId, reasonCode, extracted.publicData, extracted.privateData)) return {
        ...empty,
        action: 'block',
        disposition: 'block',
        reasonCode: 'quarantine-too-large',
        issue: issueFor('quarantine-too-large'),
      };
      return {
        ...empty,
        action: 'quarantine',
        disposition: 'quarantine-candidate',
        reasonCode,
        issue: issueFor(reasonCode),
      };
    }
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
  if (shape.kind === 'legacy' && options.scanStartedAt !== undefined
    && (!payload.proposedExpiresAt || !timestampValueInFirestoreRange(
      sourceCreatedAtCanonical(payload.proposedExpiresAt),
    ))) {
    return {
      ...base,
      action: 'block',
      disposition: 'block',
      reasonCode: 'timestamp-out-of-range',
      issue: issueFor('timestamp-out-of-range'),
    };
  }
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
  if (!Number.isFinite(Date.parse(options.scanStartedAt))
    || sourceCreatedAtCanonical(options.scanStartedAt) === null) {
    throw new LegacySharedDeckInventoryError('page-invalid');
  }
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
  const extracted = extractRecord(record);
  const classification = classifyLegacyShare(record, ownerUid, { scanStartedAt });
  return {
    ...classification,
    publicSourceDigest: classification.publicDigest,
    privateSourceDigest: classification.privateDigest,
    publicSourceBytes: sourceBytes(extracted.publicData),
    privateSourceBytes: sourceBytes(extracted.privateData),
    publicSourceStorageBytes: extracted.publicData === undefined ? null
      : (() => { try { return estimateFirestoreDocumentBytes(extracted.publicData, `shared_decks/${classification.shareId}`); } catch { return null; } })(),
    privateSourceStorageBytes: extracted.privateData === undefined ? null
      : (() => { try { return estimateFirestoreDocumentBytes(extracted.privateData, `shared_deck_owners/${classification.shareId}`); } catch { return null; } })(),
    publicCreatedAt: isRecord(extracted.publicData)
      ? sourceCreatedAtCanonical(extracted.publicData.createdAt) : null,
    privateCreatedAt: isRecord(extracted.privateData)
      ? sourceCreatedAtCanonical(extracted.privateData.createdAt) : null,
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
  if (options.fresh && options.resume) throw new LegacySharedDeckResumeError();
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
    inventoryDigest: chainHead,
    sealedManifest: null,
    sealedChunks: [],
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

const sealedManifestSeedDigest = (context: {
  readonly ownerUid: string;
  readonly target: string;
  readonly revision: string;
  readonly scanStartedAt: string;
  readonly inventoryDigest: string;
}): string => digestCanonicalValue({ domain: 'legacy-shared-deck-sealed-manifest-v2', ...context });

const sealedManifestChunkNamespace = (context: {
  readonly ownerUid: string;
  readonly target: string;
  readonly revision: string;
  readonly inventoryDigest: string;
}): string => digestCanonicalValue({
  domain: 'legacy-shared-deck-sealed-manifest-chunks-v2',
  ownerUid: context.ownerUid,
  target: context.target,
  revision: context.revision,
  inventoryDigest: context.inventoryDigest,
});

const sealedManifestRootDigest = (
  manifest: Omit<LegacySharedDeckSealedManifest, 'rootDigest'>,
): string => digestCanonicalValue(manifest);

const buildSealedManifest = (
  inventory: LegacySharedDeckInventory,
  applyEligible = inventory.applyEligible,
): { manifest: LegacySharedDeckSealedManifest; chunks: LegacySharedDeckManifestChunk[] } => {
  const context = {
    ownerUid: inventory.ownerUid,
    target: inventory.target,
    revision: inventory.revision,
    scanStartedAt: inventory.scanStartedAt,
    inventoryDigest: inventory.inventoryDigest,
  };
  const chunkNamespace = sealedManifestChunkNamespace(context);
  const seedDigest = sealedManifestSeedDigest(context);
  const chunks: LegacySharedDeckManifestChunk[] = [];
  let entries: LegacySharedDeckInventoryEntry[] = [];
  let bytes = 0;
  let previousDigest = seedDigest;
  const pushChunk = (): void => {
    if (entries.length === 0) return;
    const index = chunks.length;
    const digest = digestCanonicalValue({ chunkNamespace, index, previousDigest, entries });
    const chunk: LegacySharedDeckManifestChunk = {
      schemaVersion: 2,
      ownerUid: inventory.ownerUid,
      target: inventory.target,
      revision: inventory.revision,
      chunkNamespace,
      index,
      previousDigest,
      digest,
      entries,
    };
    chunks.push(chunk);
    previousDigest = digest;
    entries = [];
    bytes = 0;
  };
  for (const entry of inventory.entries) {
    const entryBytes = canonicalUtf8Bytes(entry).byteLength + 1_024;
    if (entryBytes > MAX_SEALED_MANIFEST_CHUNK_BYTES) {
      throw new LegacySharedDeckApplyError('A sealed inventory entry exceeds the manifest chunk bound.');
    }
    if (entries.length > 0 && (entries.length >= MAX_SEALED_MANIFEST_CHUNK_ENTRIES
      || bytes + entryBytes > MAX_SEALED_MANIFEST_CHUNK_BYTES)) pushChunk();
    entries.push(entry);
    bytes += entryBytes;
  }
  pushChunk();
  const manifestWithoutRoot: Omit<LegacySharedDeckSealedManifest, 'rootDigest'> = {
    schemaVersion: 2,
    ...context,
    chunkNamespace,
    entryCount: inventory.entries.length,
    chunkCount: chunks.length,
    seedDigest,
    lastChunkDigest: previousDigest,
    counts: inventory.counts,
    quota: inventory.quota,
    applyEligible,
  };
  return {
    manifest: { ...manifestWithoutRoot, rootDigest: sealedManifestRootDigest(manifestWithoutRoot) },
    chunks,
  };
};

/**
 * Scan both legacy collections from null cursors while keeping the owner fence
 * closed. The source store owns the durable fence; the in-memory test store
 * may omit those hooks and still exercises the same fresh-scan contract.
 */
export async function createFrozenLegacySharedDeckInventory(
  options: LegacySharedDeckInventoryOptions,
): Promise<LegacySharedDeckInventory> {
  if (options.resume || options.previousDigest !== undefined) throw new LegacySharedDeckResumeError();
  validateOptions(options);
  let persistedScanStartedAt = options.scanStartedAt;
  if (options.store.beginFreeze) {
    const frozenContext = await options.store.beginFreeze({
      ownerUid: options.ownerUid,
      revision: options.revision,
      target: options.target,
      scanStartedAt: options.scanStartedAt,
    });
    if (frozenContext !== undefined) persistedScanStartedAt = frozenContext.scanStartedAt;
  }
  try {
    const inventory = await createLegacySharedDeckInventory({
      ...options,
      scanStartedAt: persistedScanStartedAt,
      fresh: true,
      collectEntries: options.collectEntries ?? true,
      collectChunks: options.collectChunks ?? true,
    });
    const eligible = !inventory.quota.overCap
      && inventory.counts.block === 0
      && inventory.entries.every(entry => entry.action !== 'block');
    const sealed = buildSealedManifest(inventory, eligible);
    const frozen = {
      ...inventory,
      consistency: 'frozen' as const,
      applyEligible: eligible,
      sealedManifest: sealed.manifest,
      sealedChunks: sealed.chunks,
    };
    if (options.store.sealFreeze) {
      await options.store.sealFreeze({
        ownerUid: options.ownerUid,
        revision: options.revision,
        target: options.target,
        inventoryDigest: inventory.inventoryDigest,
        manifest: frozen.sealedManifest,
        chunks: frozen.sealedChunks,
      });
    }
    return frozen;
  } catch (error) {
    // Leave the durable fence active on every scan error.
    throw error;
  }
}

export class LegacySharedDeckApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacySharedDeckApplyError';
  }
}

export type LegacySharedDeckApplyOptions = {
  readonly ownerUid: string;
  readonly revision: string;
  readonly target: string;
  readonly confirmation: string;
  readonly backupManifest: unknown;
  readonly backupPublicKey: KeyObject | string | Buffer;
  /** Protected workflow evidence that the candidate index config was prepared. */
  readonly indexPreparation: LegacySharedDeckIndexPreparationEvidence;
  readonly now?: Timestamp;
};

export type LegacySharedDeckSupersedeOptions = {
  readonly ownerUid: string;
  readonly revision: string;
  readonly target: string;
  readonly inventoryDigest: string;
  readonly rootDigest: string;
  readonly confirmation: string;
  readonly now?: Timestamp;
};

export const supersedeLegacySharedDeckMigration = async (
  database: Firestore,
  options: LegacySharedDeckSupersedeOptions,
): Promise<{ readonly superseded: true; readonly historyPath: string }> => {
  if (options.confirmation !== SUPERSEDE_SHARED_DECK_CONFIRMATION) {
    throw new LegacySharedDeckApplyError('Exact supersede confirmation is required.');
  }
  if (!/^[a-f0-9]{64}$/.test(options.inventoryDigest) || !/^[a-f0-9]{64}$/.test(options.rootDigest)) {
    throw new LegacySharedDeckApplyError('Supersede digests are malformed.');
  }
  const stateRef = migrationStateReference(database);
  const historyRef = database.collection('admin_shared_deck_migration_history')
    .doc(`${options.revision}-${options.inventoryDigest}`);
  await database.runTransaction(async transaction => {
    const stateSnapshot = await transaction.get(stateRef);
    const state = stateSnapshot.data();
    const historySnapshot = await transaction.get(historyRef);
    const historyMatches = (history: unknown): boolean => (
      isRecord(history)
        && history.schemaVersion === 1
        && history.action === 'superseded'
        && history.ownerUid === options.ownerUid
        && history.target === options.target
        && history.revision === options.revision
        && history.inventoryDigest === options.inventoryDigest
        && history.rootDigest === options.rootDigest
        && validSealedManifestRoot(history.manifest, {
          ownerUid: options.ownerUid,
          target: options.target,
          revision: options.revision,
          inventoryDigest: options.inventoryDigest,
        })
        && isRecord(history.stateSnapshot)
        && isRecord(history.stateSnapshot.manifest)
        && digestCanonicalValue(history.stateSnapshot.manifest) === digestCanonicalValue(history.manifest)
        && Boolean(history.supersededAt)
    );
    if (isRecord(state) && state.phase === 'superseded') {
      if (state.ownerUid === options.ownerUid
        && state.target === options.target
        && state.revision === options.revision
        && state.inventoryDigest === options.inventoryDigest
        && isRecord(state.manifest)
        && state.manifest.rootDigest === options.rootDigest
        && historyMatches(historySnapshot.data())) return;
      throw new LegacySharedDeckApplyError('Superseded migration state is mismatched.');
    }
    if (!isRecord(state)
      || state.phase !== 'sealed'
      || state.ownerUid !== options.ownerUid
      || state.target !== options.target
      || state.revision !== options.revision
      || state.inventoryDigest !== options.inventoryDigest
      || !validSealedManifestRoot(state.manifest, {
        ownerUid: options.ownerUid,
        target: options.target,
        revision: options.revision,
        inventoryDigest: options.inventoryDigest,
      })
      || state.manifest.rootDigest !== options.rootDigest
      || (isRecord(state.progress) && state.progress.nextEntry !== 0)
      || (isRecord(state.verificationProgress) && state.verificationProgress.active === true)) {
      throw new LegacySharedDeckApplyError('Only a sealed migration with zero progress may be superseded.');
    }
    if (historySnapshot.exists) {
      if (!historyMatches(historySnapshot.data())) {
        throw new LegacySharedDeckApplyError('Supersede history is immutable and mismatched.');
      }
    } else {
      transaction.create(historyRef, {
        schemaVersion: 1,
        action: 'superseded',
        ownerUid: options.ownerUid,
        target: options.target,
        revision: options.revision,
        inventoryDigest: options.inventoryDigest,
        rootDigest: options.rootDigest,
        manifest: state.manifest,
        stateSnapshot: state,
        supersededAt: options.now ?? Timestamp.now(),
      });
    }
    transaction.set(stateRef, {
      ...state,
      phase: 'superseded',
      ledgerReady: false,
      supersededAt: options.now ?? Timestamp.now(),
    });
  });
  return { superseded: true, historyPath: historyRef.path };
};

export type LegacySharedDeckIndexPreparationReport = {
  readonly schemaVersion: 1;
  readonly indexDigest: string;
  readonly target: string;
  readonly revision: string;
  readonly active: true;
  readonly completedAt: string;
  readonly operationIds: readonly string[];
};

export type LegacySharedDeckIndexPreparationEvidence = {
  readonly workflowRunId: string;
  readonly reportSha256: string;
  readonly report: LegacySharedDeckIndexPreparationReport;
};

const verifyIndexPreparationEvidence = (
  evidence: unknown,
  expected: { readonly target: string; readonly revision: string },
): evidence is LegacySharedDeckIndexPreparationEvidence => {
  if (!isRecord(evidence)
    || !exactKeys(evidence, ['workflowRunId', 'reportSha256', 'report'])
    || typeof evidence.workflowRunId !== 'string'
    || !/^[1-9][0-9]{0,19}$/.test(evidence.workflowRunId)
    || typeof evidence.reportSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(evidence.reportSha256)
    || !isRecord(evidence.report)
    || !exactKeys(evidence.report, [
      'schemaVersion', 'indexDigest', 'target', 'revision', 'active', 'completedAt', 'operationIds',
    ])
    || evidence.report.schemaVersion !== 1
    || typeof evidence.report.indexDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(evidence.report.indexDigest)
    || evidence.report.target !== expected.target
    || evidence.report.revision !== expected.revision
    || evidence.report.active !== true
    || typeof evidence.report.completedAt !== 'string'
    || !Number.isFinite(Date.parse(evidence.report.completedAt))
    || Date.parse(evidence.report.completedAt) > Date.now() + 5 * 60 * 1_000
    || Date.now() - Date.parse(evidence.report.completedAt) > 24 * 60 * 60 * 1_000
    || !Array.isArray(evidence.report.operationIds)
    || evidence.report.operationIds.length > 100
    || evidence.report.operationIds.some(operationId => typeof operationId !== 'string' || !/^[A-Za-z0-9._/-]{1,256}$/.test(operationId))) return false;
  return digestCanonicalValue(evidence.report) === evidence.reportSha256;
};

export type LegacySharedDeckApplyReport = {
  readonly ownerUid: string;
  readonly revision: string;
  readonly inventoryDigest: string;
  readonly migratedShareIds: readonly string[];
  readonly quarantinedShareIds: readonly string[];
  readonly ledger: {
    readonly schemaVersion: 1;
    readonly shares: Readonly<Record<string, { payloadBytes: number; expiresAt: Timestamp }>>;
    readonly activeCount: number;
    readonly activeBytes: number;
  };
};

const SHARED_DECK_MIGRATION_STATE_COLLECTION = 'admin_shared_deck_migration_jobs';
const SHARED_DECK_MIGRATION_STATE = 'shared_deck_v2';
const SHARED_DECK_USAGE = 'shared_deck_usage';
const SHARED_DECK_QUARANTINE = 'admin_shared_deck_migration_quarantine';
const MAX_APPLY_BATCH_BYTES = 8 * 1024 * 1024;
const MAX_APPLY_BATCH_WRITES = 400;
/** One sealed source per transaction removes index-amplification coupling. */
export const MAX_APPLY_BATCH_DOCUMENTS = 1;
const MAX_VERIFY_ENTRIES_PER_TRANSACTION = 2;

const canonicalTimestampToFirestore = (value: TimestampCanonical | null): Timestamp | null => {
  if (!value) return null;
  const seconds = Number(value.seconds);
  if (!isFirestoreTimestampRange(value) || !Number.isSafeInteger(seconds)) return null;
  return new Timestamp(seconds, value.nanoseconds);
};

const sourceCreatedAt = (value: unknown): Timestamp | null => (
  canonicalTimestampToFirestore(sourceCreatedAtCanonical(value))
);

const sourceExpiresAt = (
  entry: LegacySharedDeckInventoryEntry,
  scanStartedAt?: string,
): Timestamp | null => {
  const candidate = canonicalTimestampToFirestore(entry.existingExpiresAt)
    ?? (entry.proposedExpiresAt && Number.isFinite(Date.parse(entry.proposedExpiresAt))
      ? Timestamp.fromMillis(Date.parse(entry.proposedExpiresAt))
      : null);
  if (!candidate || !scanStartedAt || !Number.isFinite(Date.parse(scanStartedAt))) return candidate;
  return Timestamp.fromMillis(Math.min(
    candidate.toMillis(),
    Date.parse(scanStartedAt) + LEGACY_SHARED_DECK_TTL_MS,
  ));
};

const isAppliedPair = (
  entry: LegacySharedDeckInventoryEntry,
  publicData: unknown,
  privateData: unknown,
  ownerUid: string,
  scanStartedAt: string,
): boolean => {
  if (!isRecord(publicData) || !isRecord(privateData)
    || !exactKeys(publicData, ['category', 'cards', 'createdAt', 'expiresAt', 'schemaVersion'])
    || !exactKeys(privateData, ['ownerUid', 'createdAt', 'expiresAt', 'payloadBytes', 'schemaVersion'])
    || publicData.schemaVersion !== 2
    || privateData.schemaVersion !== 2
    || privateData.ownerUid !== ownerUid
    || entry.payloadDigest === null
    || entry.payloadBytes === null
    || privateData.payloadBytes !== entry.payloadBytes) return false;
  const payloadCheck = exactPayload({ category: publicData.category, cards: publicData.cards });
  const expiresAt = sourceExpiresAt(entry, scanStartedAt);
  const publicCreatedAt = sourceCreatedAtCanonical(publicData.createdAt);
  const privateCreatedAt = sourceCreatedAtCanonical(privateData.createdAt);
  const expectedPrivateCreatedAt = entry.privateCreatedAt ?? entry.publicCreatedAt;
  const millis = (value: unknown): number | null => (
    value instanceof Timestamp ? value.toMillis() : millisFromTimestamp(timestampCanonical(value))
  );
  return !('reasonCode' in payloadCheck)
    && payloadCheck.digest === entry.payloadDigest
    && payloadCheck.bytes === entry.payloadBytes
    && entry.publicCreatedAt !== null
    && publicCreatedAt !== null
    && timestampEqual(publicCreatedAt, entry.publicCreatedAt)
    && expectedPrivateCreatedAt !== null
    && privateCreatedAt !== null
    && timestampEqual(privateCreatedAt, expectedPrivateCreatedAt)
    && expiresAt !== null
    && millis(privateData.expiresAt) === expiresAt.toMillis()
    && millis(publicData.expiresAt) === expiresAt.toMillis();
};

const migrationStateReference = (database: Firestore) => (
  database.collection(SHARED_DECK_MIGRATION_STATE_COLLECTION).doc(SHARED_DECK_MIGRATION_STATE)
);

const usageReference = (database: Firestore, ownerUid: string) => (
  database.collection('users').doc(ownerUid).collection('profile').doc(SHARED_DECK_USAGE)
);

const quarantineReference = (database: Firestore, shareId: string) => (
  database.collection(SHARED_DECK_QUARANTINE).doc(shareId)
);

const sealedManifestChunkReference = (database: Firestore, namespace: string, index: number) => (
  migrationStateReference(database).collection('sealed_manifest_chunks').doc(`${namespace}-${index}`)
);

const sealedManifestRootWithoutDigest = (manifest: LegacySharedDeckSealedManifest) => {
  const { rootDigest: _rootDigest, ...withoutRootDigest } = manifest;
  return withoutRootDigest;
};

const validSealedManifestRoot = (
  value: unknown,
  expected: { readonly ownerUid: string; readonly revision: string; readonly target: string; readonly inventoryDigest: string },
): value is LegacySharedDeckSealedManifest => {
  if (!isRecord(value)
    || !exactKeys(value, [
      'schemaVersion', 'ownerUid', 'target', 'revision', 'scanStartedAt', 'inventoryDigest',
      'chunkNamespace', 'entryCount', 'chunkCount', 'seedDigest', 'lastChunkDigest', 'rootDigest', 'counts', 'quota', 'applyEligible',
    ])
    || value.schemaVersion !== 2
    || value.ownerUid !== expected.ownerUid
    || value.target !== expected.target
    || value.revision !== expected.revision
    || value.inventoryDigest !== expected.inventoryDigest
    || typeof value.chunkNamespace !== 'string' || !/^[a-f0-9]{64}$/.test(value.chunkNamespace)
    || !Number.isFinite(Date.parse(String(value.scanStartedAt)))
    || typeof value.seedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.seedDigest)
    || typeof value.lastChunkDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.lastChunkDigest)
    || typeof value.rootDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.rootDigest)
    || !isRecord(value.counts) || !isRecord(value.quota) || typeof value.applyEligible !== 'boolean') return false;
  const countKeys: LegacyShareDisposition[] = [
    'keep-current', 'migrate-owner-free-legacy', 'migrate-transitional', 'upgrade-private-v1',
    'quarantine-candidate', 'block',
  ];
  const counts = value.counts as DataRecord;
  const quota = value.quota as DataRecord;
  const entryCount = value.entryCount as number;
  const chunkCount = value.chunkCount as number;
  if (!Number.isSafeInteger(entryCount) || entryCount < 0
    || !Number.isSafeInteger(chunkCount) || chunkCount < 0
    || !exactKeys(counts, countKeys)
    || countKeys.some(key => !Number.isSafeInteger(counts[key]) || (counts[key] as number) < 0)
    || !exactKeys(quota, ['activeCount', 'activeBytes', 'maximumCount', 'maximumBytes', 'overCount', 'overBytes', 'overCap'])
    || !Number.isSafeInteger(quota.activeCount) || (quota.activeCount as number) < 0
    || !Number.isSafeInteger(quota.activeBytes) || (quota.activeBytes as number) < 0
    || !Number.isSafeInteger(quota.maximumCount) || (quota.maximumCount as number) < 0
    || !Number.isSafeInteger(quota.maximumBytes) || (quota.maximumBytes as number) < 0
    || typeof quota.overCount !== 'boolean' || typeof quota.overBytes !== 'boolean'
    || typeof quota.overCap !== 'boolean') return false;
  const manifest = value as unknown as LegacySharedDeckSealedManifest;
  return manifest.seedDigest === sealedManifestSeedDigest({
    ownerUid: manifest.ownerUid,
    target: manifest.target,
    revision: manifest.revision,
    scanStartedAt: manifest.scanStartedAt,
    inventoryDigest: manifest.inventoryDigest,
  })
    && manifest.chunkNamespace === sealedManifestChunkNamespace({
      ownerUid: manifest.ownerUid,
      target: manifest.target,
      revision: manifest.revision,
      inventoryDigest: manifest.inventoryDigest,
    })
    && manifest.rootDigest === sealedManifestRootDigest(sealedManifestRootWithoutDigest(manifest));
};

const validSealedManifestChunk = (
  value: unknown,
  expected: { readonly ownerUid: string; readonly revision: string; readonly target: string; readonly chunkNamespace: string; readonly index: number; readonly previousDigest: string },
): value is LegacySharedDeckManifestChunk => {
  if (!isRecord(value)
    || !exactKeys(value, ['schemaVersion', 'ownerUid', 'target', 'revision', 'chunkNamespace', 'index', 'previousDigest', 'digest', 'entries'])
    || value.schemaVersion !== 2 || value.ownerUid !== expected.ownerUid || value.target !== expected.target
    || value.revision !== expected.revision || value.chunkNamespace !== expected.chunkNamespace
    || value.index !== expected.index
    || value.previousDigest !== expected.previousDigest || typeof value.digest !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.digest) || !Array.isArray(value.entries)) return false;
  const entries = value.entries as unknown[];
  if (entries.length > MAX_SEALED_MANIFEST_CHUNK_ENTRIES
    || canonicalUtf8Bytes(value).byteLength > MAX_SEALED_MANIFEST_CHUNK_BYTES) return false;
  return value.digest === digestCanonicalValue({ chunkNamespace: value.chunkNamespace, index: value.index, previousDigest: value.previousDigest, entries });
};

/** Rehydrate only the sealed, server-owned scan context; never rescan on apply. */
export async function readSealedLegacySharedDeckInventory(
  database: Firestore,
  expected: { readonly ownerUid: string; readonly revision: string; readonly target: string },
): Promise<LegacySharedDeckInventory> {
  const snapshot = await migrationStateReference(database).get();
  const state = snapshot.data();
  if (!snapshot.exists || !isRecord(state)
    || (state.phase !== 'sealed' && state.phase !== 'applying' && state.phase !== 'applied' && state.phase !== 'verified')
    || state.ownerUid !== expected.ownerUid
    || state.revision !== expected.revision
    || state.target !== expected.target
    || typeof state.inventoryDigest !== 'string'
    || !isRecord(state.manifest)) {
    throw new LegacySharedDeckApplyError('A matching sealed migration context is required.');
  }
  const manifest = state.manifest as unknown as LegacySharedDeckSealedManifest;
  if (!validSealedManifestRoot(manifest, {
    ownerUid: expected.ownerUid,
    revision: expected.revision,
    target: expected.target,
    inventoryDigest: state.inventoryDigest,
  })) {
    throw new LegacySharedDeckApplyError('The sealed migration context is malformed or mismatched.');
  }
  const chunks: LegacySharedDeckManifestChunk[] = [];
  const entries: LegacySharedDeckInventoryEntry[] = [];
  let previousDigest = manifest.seedDigest;
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    const chunkSnapshot = await sealedManifestChunkReference(database, manifest.chunkNamespace, index).get();
    const chunk = chunkSnapshot.data();
    if (!chunkSnapshot.exists || !validSealedManifestChunk(chunk, {
      ownerUid: expected.ownerUid,
      revision: expected.revision,
      chunkNamespace: manifest.chunkNamespace,
      target: expected.target,
      index,
      previousDigest,
    })) throw new LegacySharedDeckApplyError('The sealed migration chunk is missing or mismatched.');
    chunks.push(chunk);
    entries.push(...chunk.entries);
    previousDigest = chunk.digest;
  }
  if (entries.length !== manifest.entryCount || previousDigest !== manifest.lastChunkDigest) {
    throw new LegacySharedDeckApplyError('The sealed migration chunk chain is incomplete.');
  }
  const counts = emptyCounts();
  const reasons: Record<string, number> = {};
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.shareId !== 'string' || typeof entry.action !== 'string'
      || typeof entry.disposition !== 'string' || typeof entry.reasonCode !== 'string'
      || !['keep', 'migrate', 'quarantine', 'block'].includes(entry.action)
      || !['keep-current', 'migrate-owner-free-legacy', 'migrate-transitional', 'upgrade-private-v1', 'quarantine-candidate', 'block'].includes(entry.disposition)
      || entry.ownerUid !== expected.ownerUid || entry.preserveShareId !== true
      || !validShareId(entry.shareId)
      || !exactKeys(entry, [
        'shareId', 'action', 'disposition', 'reasonCode', 'ownerUid', 'preserveShareId',
        'publicDigest', 'privateDigest', 'payloadDigest', 'payloadBytes', 'payloadEquivalent',
        'existingExpiresAt', 'proposedExpiresAt', 'expired', 'issue',
        'publicSourceDigest', 'privateSourceDigest',
        'publicSourceBytes', 'privateSourceBytes', 'publicSourceStorageBytes', 'privateSourceStorageBytes',
        'publicCreatedAt', 'privateCreatedAt',
      ])) {
      throw new LegacySharedDeckApplyError('The sealed migration manifest contains a malformed entry.');
    }
    if ((entry.publicSourceBytes !== null
      && (!Number.isSafeInteger(entry.publicSourceBytes) || entry.publicSourceBytes < 0))
      || (entry.privateSourceBytes !== null
        && (!Number.isSafeInteger(entry.privateSourceBytes) || entry.privateSourceBytes < 0))
      || (entry.publicSourceStorageBytes !== null
        && (!Number.isSafeInteger(entry.publicSourceStorageBytes) || entry.publicSourceStorageBytes < 0))
      || (entry.privateSourceStorageBytes !== null
        && (!Number.isSafeInteger(entry.privateSourceStorageBytes) || entry.privateSourceStorageBytes < 0))
      || (entry.publicCreatedAt !== null && !isRecord(entry.publicCreatedAt))
      || (entry.privateCreatedAt !== null && !isRecord(entry.privateCreatedAt))) {
      throw new LegacySharedDeckApplyError('The sealed migration source measurements are malformed.');
    }
    bump(counts, entry.disposition);
    bump(reasons, entry.reasonCode);
  }
  if (digestCanonicalValue(counts) !== digestCanonicalValue(manifest.counts)) {
    throw new LegacySharedDeckApplyError('The sealed migration decision counts changed.');
  }
  const persistedQuota = manifest.quota;
  const checkpoint: LegacySharedDeckCheckpoint = {
    ownerKey: hashOwnerKey(expected.ownerUid), runId: expected.revision, revision: expected.revision,
    target: expected.target, scanStartedAt: manifest.scanStartedAt, previousDigest: state.inventoryDigest,
    publicCursor: null, privateCursor: null, publicTerminal: true, privateTerminal: true, chunkIndex: -1,
    beforePublicCursor: null, beforePrivateCursor: null, afterPublicCursor: null, afterPrivateCursor: null,
  };
  return {
    ownerUid: expected.ownerUid,
    runId: expected.revision,
    revision: expected.revision,
    target: expected.target,
    scanStartedAt: manifest.scanStartedAt,
    consistency: 'frozen',
    applyEligible: manifest.applyEligible,
    entries,
    chunks: [],
    publicCursor: null,
    privateCursor: null,
    publicTerminal: true,
    privateTerminal: true,
    checkpoint,
    chainHead: state.inventoryDigest,
    inventoryDigest: state.inventoryDigest,
    sealedManifest: manifest,
    sealedChunks: chunks,
    totalPublicBytes: 0,
    totalPrivateBytes: 0,
    totalPayloadBytes: persistedQuota.activeBytes,
    counts: manifest.counts,
    reasons,
    quota: persistedQuota,
    activeOwner: {
      ownerKey: hashOwnerKey(expected.ownerUid),
      activeCount: persistedQuota.activeCount,
      activeBytes: persistedQuota.activeBytes,
      expiredCount: 0,
    },
    evidence: {
      shareKeys: [], issues: [], shareKeysOmittedCount: 0, issuesOmittedCount: 0,
      equivalentPayloads: [], equivalentPayloadsOmittedCount: 0,
    },
  };
}

const validateSealedInventory = (inventory: LegacySharedDeckInventory): void => {
  const manifest = inventory.sealedManifest;
  if (!manifest || !validSealedManifestRoot(manifest, {
    ownerUid: inventory.ownerUid,
    revision: inventory.revision,
    target: inventory.target,
    inventoryDigest: inventory.inventoryDigest,
  })) {
    throw new LegacySharedDeckApplyError('The sealed inventory root is missing or mismatched.');
  }
  if (inventory.sealedChunks.length !== manifest.chunkCount) {
    throw new LegacySharedDeckApplyError('The sealed inventory chunk count changed.');
  }
  let previousDigest = manifest.seedDigest;
  let entryCount = 0;
  for (const [index, chunk] of inventory.sealedChunks.entries()) {
    if (!validSealedManifestChunk(chunk, {
      ownerUid: inventory.ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      chunkNamespace: manifest.chunkNamespace,
      index,
      previousDigest,
    })) throw new LegacySharedDeckApplyError('The sealed inventory chunk chain changed.');
    entryCount += chunk.entries.length;
    previousDigest = chunk.digest;
  }
  if (entryCount !== manifest.entryCount || previousDigest !== manifest.lastChunkDigest
    || digestCanonicalValue(inventory.entries) !== digestCanonicalValue(
      inventory.sealedChunks.flatMap(chunk => chunk.entries),
    )) throw new LegacySharedDeckApplyError('The sealed inventory entries changed.');
  if (sourceCreatedAtCanonical(manifest.scanStartedAt) === null) {
    throw new LegacySharedDeckApplyError('The sealed scan timestamp is outside Firestore range.');
  }
  for (const entry of inventory.entries) {
    for (const timestamp of [entry.publicCreatedAt, entry.privateCreatedAt, entry.existingExpiresAt]) {
      if (timestamp !== null && !isFirestoreTimestampRange(timestamp)) {
        throw new LegacySharedDeckApplyError('The sealed inventory contains an out-of-range timestamp.');
      }
    }
    if (entry.proposedExpiresAt !== null
      && sourceCreatedAtCanonical(entry.proposedExpiresAt) === null) {
      throw new LegacySharedDeckApplyError('The sealed inventory contains an out-of-range proposed expiry.');
    }
    const copyable = entry.action !== 'block'
      && entry.action !== 'quarantine';
    if (copyable) {
      if (entry.publicCreatedAt === null
        || (entry.existingExpiresAt === null && entry.proposedExpiresAt === null)) {
        throw new LegacySharedDeckApplyError('The sealed inventory is missing a copyable timestamp.');
      }
    }
  }
};

const applyBatches = (entries: readonly LegacySharedDeckInventoryEntry[]): LegacySharedDeckInventoryEntry[][] => {
  const batches: LegacySharedDeckInventoryEntry[][] = [];
  let batch: LegacySharedDeckInventoryEntry[] = [];
  let bytes = 0;
  let writes = 0;
  for (const entry of entries) {
    // Count raw source reads, target writes, quarantine envelope/copy and
    // index/request headroom. The conservative bound keeps each transaction
    // well below Firestore's 10 MiB request limit.
    const rawSourceBytes = (entry.publicSourceStorageBytes ?? entry.publicSourceBytes ?? 0)
      + (entry.privateSourceStorageBytes ?? entry.privateSourceBytes ?? 0);
    const sealedEntryBytes = canonicalUtf8Bytes(entry).byteLength;
    // One copy is read, one copy is retained in the quarantine envelope, and
    // the remaining headroom covers Firestore index/request amplification.
    const quarantineEnvelopeEstimate = rawSourceBytes + 16_384;
    const indexHeadroom = (rawSourceBytes + sealedEntryBytes) * 2 + 16_384;
    const estimate = rawSourceBytes + quarantineEnvelopeEstimate + sealedEntryBytes + indexHeadroom;
    const entryWrites = entry.action === 'quarantine' ? 1 : 2;
    if (estimate > MAX_APPLY_BATCH_BYTES) throw new LegacySharedDeckApplyError('Apply entry exceeds transaction byte bound.');
    if (batch.length >= MAX_APPLY_BATCH_DOCUMENTS
      || bytes + estimate > MAX_APPLY_BATCH_BYTES || writes + entryWrites > MAX_APPLY_BATCH_WRITES) {
      batches.push(batch);
      batch = [];
      bytes = 0;
      writes = 0;
    }
    batch.push(entry);
    bytes += estimate;
    writes += entryWrites;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
};

const quarantineMatchesSource = (value: unknown, entry: LegacySharedDeckInventoryEntry): boolean => (
  isRecord(value)
    && value.shareId === entry.shareId
    && value.publicSourceDigest === entry.publicSourceDigest
    && value.privateSourceDigest === entry.privateSourceDigest
    && value.publicData !== undefined
    && value.privateData !== undefined
    && (value.publicData === null ? null : sourceDigest(value.publicData)) === entry.publicSourceDigest
    && (value.privateData === null ? null : sourceDigest(value.privateData)) === entry.privateSourceDigest
);

const expectedUsage = (
  entries: readonly LegacySharedDeckInventoryEntry[],
  scanStartedAt: string,
): LegacySharedDeckApplyReport['ledger'] => {
  const shares: Record<string, { payloadBytes: number; expiresAt: Timestamp }> = {};
  const scanMillis = Date.parse(scanStartedAt);
  for (const entry of entries) {
    if (entry.action === 'quarantine' || entry.action === 'block' || entry.payloadBytes === null) continue;
    const expiresAt = sourceExpiresAt(entry, scanStartedAt);
    if (!expiresAt || expiresAt.toMillis() <= scanMillis) continue;
    shares[entry.shareId] = { payloadBytes: entry.payloadBytes, expiresAt };
  }
  const activeBytes = Object.values(shares).reduce((total, entry) => total + entry.payloadBytes, 0);
  return { schemaVersion: 1, shares, activeCount: Object.keys(shares).length, activeBytes };
};

const usageComparable = (value: unknown): unknown => {
  if (!isRecord(value) || !isRecord(value.shares)) return value;
  return {
    schemaVersion: value.schemaVersion,
    shares: Object.fromEntries(Object.entries(value.shares)
      .sort(([left], [right]) => utf8Compare(left, right))
      .map(([shareId, entry]) => [shareId, isRecord(entry)
        ? { payloadBytes: entry.payloadBytes, expiresAt: timestampCanonical(entry.expiresAt) }
        : entry])),
    activeCount: value.activeCount,
    activeBytes: value.activeBytes,
  };
};

const usageEqual = (left: unknown, right: LegacySharedDeckApplyReport['ledger']): boolean => (
  JSON.stringify(usageComparable(left)) === JSON.stringify(usageComparable(right))
);

/**
 * Apply one owner in one Firestore transaction. Valid source documents are
 * rewritten in place, preserving IDs and payloads; invalid records are copied
 * to quarantine and left untouched.
 */
export async function applyLegacySharedDeckMigration(
  database: Firestore,
  inventory: LegacySharedDeckInventory,
  options: LegacySharedDeckApplyOptions,
): Promise<LegacySharedDeckApplyReport> {
  if (options.confirmation !== 'APPLY_SHARED_DECK_V2') {
    throw new LegacySharedDeckApplyError('Exact APPLY_SHARED_DECK_V2 confirmation is required.');
  }
  validateSealedInventory(inventory);
  if (inventory.applyEligible !== inventory.sealedManifest!.applyEligible
    || digestCanonicalValue(inventory.quota) !== digestCanonicalValue(inventory.sealedManifest!.quota)) {
    throw new LegacySharedDeckApplyError('The sealed quota decision changed.');
  }
  if (inventory.consistency !== 'frozen' || !inventory.applyEligible
    || inventory.ownerUid !== options.ownerUid
    || inventory.revision !== options.revision
    || inventory.target !== options.target) {
    throw new LegacySharedDeckApplyError('Fresh frozen inventory binding is invalid.');
  }
  verifyLegacySharedDeckBackupManifest(options.backupManifest, {
    digest: inventory.inventoryDigest,
    target: options.target,
    revision: options.revision,
    ownerUid: options.ownerUid,
  }, options.backupPublicKey, options.now?.toMillis() ?? Date.now());
  if (!verifyIndexPreparationEvidence(options.indexPreparation, {
    target: options.target,
    revision: options.revision,
  })) {
    throw new LegacySharedDeckApplyError('A successful immutable index-preparation report is required.');
  }
  if (inventory.quota.overCap) {
    throw new LegacySharedDeckApplyError('Shared-deck owner is over the migration cap.');
  }
  const ledger = expectedUsage(inventory.entries, inventory.scanStartedAt);
  const batches = applyBatches(inventory.entries);
  const migratedShareIds = new Set<string>();
  const quarantinedShareIds = new Set<string>();
  const stateRef = migrationStateReference(database);
  const usageRef = usageReference(database, options.ownerUid);
  const assertState = (state: unknown): DataRecord => {
    if (!isRecord(state)
      || state.ownerUid !== options.ownerUid
      || state.revision !== options.revision
      || state.inventoryDigest !== inventory.inventoryDigest
      || !validSealedManifestRoot(state.manifest, {
        ownerUid: options.ownerUid,
        revision: options.revision,
        target: options.target,
        inventoryDigest: inventory.inventoryDigest,
      })
      || digestCanonicalValue(state.manifest) !== digestCanonicalValue(inventory.sealedManifest)
      // A crash during verification leaves an active durable cursor.  For an
      // already-applied/verified phase apply is validation-only and must be
      // allowed to run so the operator can reach the verifier again; an
      // active verifier on a pre-apply phase remains a hard conflict.
      || (isRecord(state.verificationProgress)
        && state.verificationProgress.active === true
        && state.phase !== 'applied'
        && state.phase !== 'verified')
      || (state.phase !== 'sealed' && state.phase !== 'applying' && state.phase !== 'applied' && state.phase !== 'verified')) {
      throw new LegacySharedDeckApplyError('Frozen migration state does not match inventory.');
    }
    return state;
  };
  let state: DataRecord | undefined;
  // Establish a read-only CAS fence before the first state mutation.  This
  // keeps a stale sealed inventory from even advancing migration progress;
  // the batch transactions repeat the check for races after this preflight.
  await database.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef);
    state = assertState(snapshot.data());
    const usageSnapshot = await transaction.get(usageRef);
    if (usageSnapshot.exists && !usageEqual(usageSnapshot.data(), ledger)) {
      throw new LegacySharedDeckApplyError('Existing shared-deck ledger does not match inventory.');
    }
  });
  // Source CAS is also read in the same conservative batches as the writes;
  // a large valid inventory must not create a single >10 MiB read request.
  for (const batch of batches) await database.runTransaction(async transaction => {
    const currentState = assertState((await transaction.get(stateRef)).data());
    const validationOnly = currentState.phase === 'applied' || currentState.phase === 'verified';
    for (const entry of batch) {
      const publicSnapshot = await transaction.get(database.collection('shared_decks').doc(entry.shareId));
      const privateSnapshot = await transaction.get(database.collection('shared_deck_owners').doc(entry.shareId));
      const quarantineSnapshot = await transaction.get(quarantineReference(database, entry.shareId));
      const publicData = publicSnapshot.data();
      const privateData = privateSnapshot.data();
      const publicDigest = publicData === undefined ? null : sourceDigest(publicData);
      const privateDigest = privateData === undefined ? null : sourceDigest(privateData);
      const quarantine = entry.action === 'quarantine';
      if (quarantine) {
        if (publicDigest !== entry.publicSourceDigest || privateDigest !== entry.privateSourceDigest) {
          throw new LegacySharedDeckApplyError(`Quarantined source changed for ${entry.shareId}.`);
        }
        if (!quarantineFitsDocumentBound(options.ownerUid, entry.shareId, entry.reasonCode, publicData, privateData)) {
          throw new LegacySharedDeckApplyError(`Quarantine envelope exceeds the safe document bound for ${entry.shareId}.`);
        }
        if (quarantineMatchesSource(quarantineSnapshot.data(), entry)) continue;
        if (validationOnly) {
          throw new LegacySharedDeckApplyError(`Quarantined source changed for ${entry.shareId}.`);
        }
        continue;
      }
      if (isAppliedPair(entry, publicData, privateData, options.ownerUid, inventory.scanStartedAt)) continue;
      if (validationOnly || publicDigest !== entry.publicSourceDigest
        || privateDigest !== entry.privateSourceDigest) {
        throw new LegacySharedDeckApplyError(`Source digest changed for ${entry.shareId}.`);
      }
    }
  });
  await database.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef);
    if (!snapshot.exists) throw new LegacySharedDeckApplyError('Shared-deck migration is not frozen.');
    state = assertState(snapshot.data());
    if (state.phase === 'sealed') {
      transaction.set(stateRef, {
        ...state,
        phase: 'applying',
        progress: { nextEntry: 0, batchIndex: 0 },
        ledgerReady: false,
      });
      state = { ...state, phase: 'applying', progress: { nextEntry: 0, batchIndex: 0 } };
    }
  });
  const initialState = state!;
  const initialProgress = isRecord(initialState.progress) && typeof initialState.progress.nextEntry === 'number'
    ? initialState.progress.nextEntry : 0;
  if (!Number.isSafeInteger(initialProgress) || initialProgress < 0 || initialProgress > inventory.entries.length) {
    throw new LegacySharedDeckApplyError('Shared-deck migration progress is invalid.');
  }
  let offset = 0;
  let nextEntry = initialProgress;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex]!;
    const batchStart = offset;
    offset += batch.length;
    if (initialState.phase !== 'applied' && initialState.phase !== 'verified' && offset <= nextEntry) continue;
    if (initialState.phase !== 'applied' && initialState.phase !== 'verified' && batchStart !== nextEntry) {
      throw new LegacySharedDeckApplyError('Shared-deck migration progress is not on a batch boundary.');
    }
    await database.runTransaction(async transaction => {
      const currentStateSnapshot = await transaction.get(stateRef);
      const currentState = assertState(currentStateSnapshot.data());
      const validationOnly = currentState.phase === 'applied' || currentState.phase === 'verified';
      if (!validationOnly && (currentState.phase !== 'applying'
        || !isRecord(currentState.progress)
        || currentState.progress.nextEntry !== batchStart)) {
        throw new LegacySharedDeckApplyError('Shared-deck migration progress changed concurrently.');
      }
      const snapshots = new Map<string, {
        publicSnapshot: DocumentSnapshot;
        privateSnapshot: DocumentSnapshot;
        quarantineSnapshot: DocumentSnapshot;
      }>();
      for (const entry of batch) {
        snapshots.set(entry.shareId, {
          publicSnapshot: await transaction.get(database.collection('shared_decks').doc(entry.shareId)),
          privateSnapshot: await transaction.get(database.collection('shared_deck_owners').doc(entry.shareId)),
          quarantineSnapshot: await transaction.get(quarantineReference(database, entry.shareId)),
        });
      }
      for (const entry of batch) {
        const { publicSnapshot, privateSnapshot, quarantineSnapshot } = snapshots.get(entry.shareId)!;
        const publicData = publicSnapshot.data();
        const privateData = privateSnapshot.data();
        const currentPublicDigest = publicData === undefined ? null : sourceDigest(publicData);
        const currentPrivateDigest = privateData === undefined ? null : sourceDigest(privateData);
        const quarantine = entry.action === 'quarantine';
        if (quarantine) {
          if (currentPublicDigest !== entry.publicSourceDigest || currentPrivateDigest !== entry.privateSourceDigest) {
            throw new LegacySharedDeckApplyError(`Quarantined source changed for ${entry.shareId}.`);
          }
          if (!quarantineFitsDocumentBound(options.ownerUid, entry.shareId, entry.reasonCode, publicData, privateData)) {
            throw new LegacySharedDeckApplyError(`Quarantine envelope exceeds the safe document bound for ${entry.shareId}.`);
          }
          if (!quarantineMatchesSource(quarantineSnapshot.data(), entry) && !validationOnly) {
            transaction.set(quarantineReference(database, entry.shareId), {
              schemaVersion: 2,
              ownerUid: options.ownerUid,
              revision: options.revision,
              shareId: entry.shareId,
              reasonCode: entry.reasonCode,
              publicData: publicData ?? null,
              privateData: privateData ?? null,
              publicSourceDigest: entry.publicSourceDigest,
              privateSourceDigest: entry.privateSourceDigest,
            });
            quarantinedShareIds.add(entry.shareId);
          } else if (validationOnly && !quarantineMatchesSource(quarantineSnapshot.data(), entry)) {
            throw new LegacySharedDeckApplyError(`Quarantine copy changed for ${entry.shareId}.`);
          }
          continue;
        }
        if (validationOnly) {
          if (!isAppliedPair(entry, publicData, privateData, options.ownerUid, inventory.scanStartedAt)) {
            throw new LegacySharedDeckApplyError(`Applied share changed for ${entry.shareId}.`);
          }
          continue;
        }
        if (isAppliedPair(entry, publicData, privateData, options.ownerUid, inventory.scanStartedAt)) continue;
        if (currentPublicDigest !== entry.publicSourceDigest || currentPrivateDigest !== entry.privateSourceDigest) {
          throw new LegacySharedDeckApplyError(`Source digest changed for ${entry.shareId}.`);
        }
        if (!isRecord(publicData) || entry.payloadDigest === null || entry.payloadBytes === null) {
          throw new LegacySharedDeckApplyError(`Valid source is missing for ${entry.shareId}.`);
        }
        const createdAt = sourceCreatedAt(publicData.createdAt);
        const expiresAt = sourceExpiresAt(entry, inventory.scanStartedAt);
        if (!createdAt || !expiresAt) throw new LegacySharedDeckApplyError(`Timestamp is invalid for ${entry.shareId}.`);
        const payload = { category: publicData.category, cards: publicData.cards };
        const payloadCheck = exactPayload(payload);
        if ('reasonCode' in payloadCheck || payloadCheck.digest !== entry.payloadDigest || payloadCheck.bytes !== entry.payloadBytes) {
          throw new LegacySharedDeckApplyError(`Payload changed for ${entry.shareId}.`);
        }
        transaction.set(database.collection('shared_decks').doc(entry.shareId), {
          category: payload.category, cards: payload.cards, createdAt, expiresAt, schemaVersion: 2,
        });
        transaction.set(database.collection('shared_deck_owners').doc(entry.shareId), {
          ownerUid: options.ownerUid, createdAt, expiresAt, payloadBytes: entry.payloadBytes, schemaVersion: 2,
        });
        migratedShareIds.add(entry.shareId);
      }
      if (!validationOnly) {
        transaction.set(stateRef, {
          ...currentState,
          phase: 'applying',
          progress: { nextEntry: offset, batchIndex: batchIndex + 1 },
          ledgerReady: false,
        });
        nextEntry = offset;
      }
    });
  }
  await database.runTransaction(async transaction => {
    const stateSnapshot = await transaction.get(stateRef);
    const usageSnapshot = await transaction.get(usageRef);
    const currentState = assertState(stateSnapshot.data());
    if (currentState.phase === 'applied' || currentState.phase === 'verified') {
      if (!usageSnapshot.exists || !usageEqual(usageSnapshot.data(), ledger)) {
        throw new LegacySharedDeckApplyError('Applied shared-deck ledger changed before retry.');
      }
      return;
    }
    if (currentState.phase !== 'applying' || !isRecord(currentState.progress)
      || currentState.progress.nextEntry !== inventory.entries.length) {
      throw new LegacySharedDeckApplyError('Shared-deck migration is incomplete.');
    }
    if (usageSnapshot.exists && !usageEqual(usageSnapshot.data(), ledger)) {
      throw new LegacySharedDeckApplyError('Existing shared-deck ledger does not match inventory.');
    }
    if (!usageSnapshot.exists) transaction.create(usageRef, ledger);
    transaction.set(stateRef, {
      ...currentState,
      phase: 'applied',
      progress: { nextEntry: inventory.entries.length, batchIndex: batches.length },
      manifest: inventory.sealedManifest,
      ledgerReady: true,
      updatedAt: options.now ?? Timestamp.now(),
    });
  });
  return {
    ownerUid: options.ownerUid,
    revision: options.revision,
    inventoryDigest: inventory.inventoryDigest,
    migratedShareIds: [...migratedShareIds],
    quarantinedShareIds: [...quarantinedShareIds],
    ledger,
  };
}

export type LegacySharedDeckCutoverVerification = {
  readonly verified: boolean;
  readonly validLegacyPublicCount: number;
  readonly activeLedgerCount: number;
};

/** Verify the post-apply public/private pair and ledger before reopening writes. */
export async function verifyLegacySharedDeckCutover(
  database: Firestore,
  inventory: LegacySharedDeckInventory,
): Promise<LegacySharedDeckCutoverVerification> {
  if (inventory.consistency !== 'frozen') throw new LegacySharedDeckApplyError('Cutover requires a frozen inventory.');
  validateSealedInventory(inventory);
  if (!inventory.applyEligible) throw new LegacySharedDeckApplyError('Cutover requires an eligible sealed inventory.');

  const stateRef = migrationStateReference(database);
  const usageRef = usageReference(database, inventory.ownerUid);
  // Sealed entries are already bounded chunks. Use a binary search over their
  // immutable ID order instead of building a second unbounded seen-ID map.
  const expectedEntryFor = (shareId: string): LegacySharedDeckInventoryEntry | undefined => {
    let low = 0;
    let high = inventory.entries.length - 1;
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const candidate = inventory.entries[middle]!;
      const comparison = utf8Compare(candidate.shareId, shareId);
      if (comparison === 0) return candidate;
      if (comparison < 0) low = middle + 1;
      else high = middle - 1;
    }
    return undefined;
  };
  type VerificationProgress = {
    readonly active: boolean;
    readonly publicCursor: string | null;
    readonly privateCursor: string | null;
    readonly publicTerminal: boolean;
    readonly privateTerminal: boolean;
    readonly sealedCursor: number;
    readonly validLegacyPublicCount: number;
  };
  const emptyProgress = (): VerificationProgress => ({
    active: true,
    publicCursor: null,
    privateCursor: null,
    publicTerminal: false,
    privateTerminal: false,
    sealedCursor: 0,
    validLegacyPublicCount: 0,
  });
  const parseProgress = (value: unknown): VerificationProgress => {
    const validLegacyPublicCount = isRecord(value) ? value.validLegacyPublicCount : undefined;
    if (!isRecord(value)
      || typeof value.active !== 'boolean'
      || (value.publicCursor !== null && typeof value.publicCursor !== 'string')
      || (value.privateCursor !== null && typeof value.privateCursor !== 'string')
      || typeof value.publicTerminal !== 'boolean'
      || typeof value.privateTerminal !== 'boolean'
      || !Number.isSafeInteger(value.sealedCursor)
      || (value.sealedCursor as number) < 0
      || (value.sealedCursor as number) > inventory.entries.length
      || !Number.isSafeInteger(validLegacyPublicCount)
      || (validLegacyPublicCount as number) < 0) {
      throw new LegacySharedDeckApplyError('Cutover verification progress is malformed.');
    }
    return value as unknown as VerificationProgress;
  };
  const assertState = (value: unknown): DataRecord => {
    if (!isRecord(value)
      || value.ownerUid !== inventory.ownerUid
      || value.revision !== inventory.revision
      || value.target !== inventory.target
      || value.inventoryDigest !== inventory.inventoryDigest
      || (value.phase !== 'applied' && value.phase !== 'verified')
      || value.ledgerReady !== true
      || !validSealedManifestRoot(value.manifest, {
        ownerUid: inventory.ownerUid,
        revision: inventory.revision,
        target: inventory.target,
        inventoryDigest: inventory.inventoryDigest,
      })
      || digestCanonicalValue(value.manifest) !== digestCanonicalValue(inventory.sealedManifest)) {
      throw new LegacySharedDeckApplyError('Cutover verification state is not ready.');
    }
    return value;
  };

  const initialProgress = await database.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef);
    const state = assertState(snapshot.data());
    const rawProgress = state.verificationProgress;
    if (isRecord(rawProgress) && rawProgress.active === true) return parseProgress(rawProgress);
    const progress = emptyProgress();
    transaction.set(stateRef, { ...state, verificationProgress: progress });
    return progress;
  });

  const processSource = async (
    transaction: Transaction,
    shareId: string,
    publicData: DataRecord | undefined,
    privateData: DataRecord | undefined,
  ): Promise<boolean> => {
    const expectedEntry = expectedEntryFor(shareId);
    if (!expectedEntry) throw new LegacySharedDeckApplyError('Cutover verification found a source record outside the sealed inventory.');
    const entry = entryFor({ shareId, publicData, privateData }, inventory.ownerUid, inventory.scanStartedAt);
    if (expectedEntry.action === 'block') {
      throw new LegacySharedDeckApplyError(`Cutover verification found a blocked source for ${shareId}.`);
    }
    const quarantine = expectedEntry.action === 'quarantine';
    if (quarantine) {
      const quarantineSnapshot = await transaction.get(quarantineReference(database, shareId));
      if (entry.publicSourceDigest !== expectedEntry.publicSourceDigest
        || entry.privateSourceDigest !== expectedEntry.privateSourceDigest
        || !quarantineMatchesSource(quarantineSnapshot.data(), expectedEntry)) {
        throw new LegacySharedDeckApplyError(`Cutover verification found an unverified quarantine copy for ${shareId}.`);
      }
      return false;
    }
    if (entry.action === 'block') {
      throw new LegacySharedDeckApplyError(`Cutover verification found an invalid source for ${shareId}.`);
    }
    const exactSchema2 = isRecord(publicData)
      && exactKeys(publicData, ['category', 'cards', 'createdAt', 'expiresAt', 'schemaVersion'])
      && publicData.schemaVersion === 2;
    if (!exactSchema2
      || !isRecord(privateData)
      || !exactKeys(privateData, ['ownerUid', 'createdAt', 'expiresAt', 'payloadBytes', 'schemaVersion'])
      || !isAppliedPair(
        expectedEntry,
        publicData,
        privateData,
        inventory.ownerUid,
        inventory.scanStartedAt,
      )) {
      throw new LegacySharedDeckApplyError('Cutover verification found a missing or mismatched schema2 pair.');
    }
    return false;
  };

  const scanSource = async (
    collection: 'shared_decks' | 'shared_deck_owners',
    publicFirst: boolean,
    startingProgress: VerificationProgress,
  ): Promise<VerificationProgress> => {
    let after = publicFirst ? startingProgress.publicCursor : startingProgress.privateCursor;
    const terminal = publicFirst ? startingProgress.publicTerminal : startingProgress.privateTerminal;
    if (terminal) return startingProgress;
    while (true) {
      const page = await database.runTransaction(async transaction => {
        const state = assertState((await transaction.get(stateRef)).data());
        const progress = parseProgress(state.verificationProgress);
        const expectedCursor = publicFirst ? progress.publicCursor : progress.privateCursor;
        if (!progress.active || expectedCursor !== after) {
          throw new LegacySharedDeckApplyError('Cutover verification progress changed concurrently.');
        }
        let query = database.collection(collection).orderBy('__name__').limit(MAX_VERIFY_ENTRIES_PER_TRANSACTION);
        if (after !== null) query = query.startAfter(after);
        const snapshot = await transaction.get(query);
        if (snapshot.size > MAX_VERIFY_ENTRIES_PER_TRANSACTION) {
          throw new LegacySharedDeckApplyError('Cutover verification page exceeded its transaction bound.');
        }
        let pageLegacyCount = 0;
        for (const document of snapshot.docs) {
          const shareId = document.id;
          const side = document.data() as DataRecord;
          const publicData = publicFirst
            ? side
            : (await transaction.get(database.collection('shared_decks').doc(shareId))).data() as DataRecord | undefined;
          const privateData = publicFirst
            ? (await transaction.get(database.collection('shared_deck_owners').doc(shareId))).data() as DataRecord | undefined
            : side;
          if (await processSource(transaction, shareId, publicData, privateData)) pageLegacyCount += 1;
        }
        const lastId = snapshot.docs.at(-1)?.id ?? after;
        const pageProgress: VerificationProgress = {
          ...progress,
          publicCursor: publicFirst ? lastId : progress.publicCursor,
          privateCursor: publicFirst ? progress.privateCursor : lastId,
          publicTerminal: publicFirst ? snapshot.size < MAX_VERIFY_ENTRIES_PER_TRANSACTION : progress.publicTerminal,
          privateTerminal: publicFirst ? progress.privateTerminal : snapshot.size < MAX_VERIFY_ENTRIES_PER_TRANSACTION,
          validLegacyPublicCount: progress.validLegacyPublicCount + pageLegacyCount,
        };
        transaction.set(stateRef, { ...state, verificationProgress: pageProgress });
        return {
          size: snapshot.size,
          lastId,
          progress: pageProgress,
        };
      });
      if (page.size < MAX_VERIFY_ENTRIES_PER_TRANSACTION) return page.progress;
      if (page.lastId === null || page.lastId === after) {
        throw new LegacySharedDeckApplyError('Cutover verification pagination stalled.');
      }
      after = page.lastId;
    }
  };

  const publicProgress = await scanSource('shared_decks', true, initialProgress);
  const finalScanProgress = await scanSource('shared_deck_owners', false, publicProgress);

  // The source scans above reject extra records.  A bounded direct pass over
  // sealed IDs proves that none disappeared between pages and also makes a
  // crash/resume independent of in-memory seen-ID sets.
  let sealedProgress = finalScanProgress;
  for (let offset = sealedProgress.sealedCursor; offset < inventory.entries.length; offset += MAX_VERIFY_ENTRIES_PER_TRANSACTION) {
    const batch = inventory.entries.slice(offset, offset + MAX_VERIFY_ENTRIES_PER_TRANSACTION);
    sealedProgress = await database.runTransaction(async transaction => {
      const state = assertState((await transaction.get(stateRef)).data());
      const progress = parseProgress(state.verificationProgress);
      if (!progress.active || progress.sealedCursor !== offset) {
        throw new LegacySharedDeckApplyError('Cutover verification sealed progress changed concurrently.');
      }
      for (const expectedEntry of batch) {
        const publicData = (await transaction.get(database.collection('shared_decks').doc(expectedEntry.shareId))).data() as DataRecord | undefined;
        const privateData = (await transaction.get(database.collection('shared_deck_owners').doc(expectedEntry.shareId))).data() as DataRecord | undefined;
        if (await processSource(transaction, expectedEntry.shareId, publicData, privateData)) {
          throw new LegacySharedDeckApplyError('Cutover verification found a valid legacy public share.');
        }
      }
      const nextProgress: VerificationProgress = {
        ...progress,
        sealedCursor: offset + batch.length,
      };
      transaction.set(stateRef, { ...state, verificationProgress: nextProgress });
      return nextProgress;
    });
  }
  if (sealedProgress.validLegacyPublicCount > 0) {
    throw new LegacySharedDeckApplyError('Cutover verification found a valid legacy public share.');
  }

  const expected = expectedUsage(inventory.entries, inventory.scanStartedAt);
  const result = await database.runTransaction(async transaction => {
    const stateSnapshot = await transaction.get(stateRef);
    const usageSnapshot = await transaction.get(usageRef);
    const state = assertState(stateSnapshot.data());
    const progress = parseProgress(state.verificationProgress);
    if (!progress.active
      || !progress.publicTerminal
      || !progress.privateTerminal
      || progress.sealedCursor !== inventory.entries.length) {
      throw new LegacySharedDeckApplyError('Cutover verification has not completed every sealed entry.');
    }
    if (!usageSnapshot.exists || !usageEqual(usageSnapshot.data(), expected)) {
      throw new LegacySharedDeckApplyError('Cutover verification found a mismatched usage ledger.');
    }
    transaction.set(stateRef, {
      ...state,
      phase: 'verified',
      ledgerReady: true,
      verificationProgress: { ...progress, active: false },
      verifiedAt: Timestamp.now(),
    });
    return {
      verified: true,
      validLegacyPublicCount: sealedProgress.validLegacyPublicCount,
      activeLedgerCount: expected.activeCount,
    };
  });
  return result;
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
  inventoryDigest: inventory.inventoryDigest,
  sealedManifest: inventory.sealedManifest
    ? {
      rootDigest: inventory.sealedManifest.rootDigest,
      entryCount: inventory.sealedManifest.entryCount,
      chunkCount: inventory.sealedManifest.chunkCount,
    }
    : null,
  publicTerminal: inventory.publicTerminal,
  privateTerminal: inventory.privateTerminal,
  chainHead: inventory.chainHead,
});

export const buildInventoryReport = (inventory: LegacySharedDeckInventory): string => (
  JSON.stringify(buildRedactedInventoryReport(inventory))
);

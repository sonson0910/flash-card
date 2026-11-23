import { randomBytes } from 'node:crypto';
import { FieldPath, Timestamp, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { resolvePlan } from './aiQuota.js';
import { createLegacyCourseProfile } from './course-profile-contract.js';
import { InputValidationError } from './inputValidation.js';
import type { PilotConfig } from './pilotConfig.js';

/**
 * Learner file uploads: PDF and EPUB sources and card images.
 *
 * The browser never writes a file record or a usage counter. `prepareFileUpload` reserves the
 * declared bytes against the plan allowance and creates an `uploading` record; the browser then
 * writes the object to `users/{uid}/files/{fileId}` (Storage Rules allow only that owner, an
 * allowed content type and the absolute ceiling below). The finalize trigger reads the stored
 * object's real size, type and leading bytes, moves the reservation to used bytes, and deletes
 * any object that has no reservation, breaks the plan limits or does not match its type.
 */

export const FILE_KINDS = ['pdf', 'epub', 'image'] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const FILE_PURPOSES = ['source', 'card-image'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];
export type FileStatus = 'uploading' | 'ready' | 'partial' | 'rejected';
export type FileVerification = 'pending' | 'complete' | 'partial' | 'unavailable' | 'failed';
export type FileRejectionReason = 'type' | 'size' | 'quota' | 'signature' | 'expired';

/** Content types the service accepts, mapped to the file kind shown to the learner. */
export const FILE_CONTENT_TYPES: Readonly<Record<string, FileKind>> = Object.freeze({
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'image/webp': 'image',
  'image/png': 'image',
  'image/jpeg': 'image',
});

/** Hard ceiling for one object. Storage Rules enforce the same number; plan limits sit below it. */
export const FILE_OBJECT_CEILING_BYTES = 50 * 1024 * 1024;
export const FILE_RESERVATION_TTL_MS = 60 * 60_000;
export const FILE_NAME_MAX_LENGTH = 160;
export const FILE_LIST_LIMIT = 200;
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
const OWNER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const COURSE_ID_PATTERN = /^[^/\x00-\x1F\x7F]{1,128}$/;
const REJECTED_RECORD_TTL_MS = 24 * 60 * 60_000;
export const FILE_HEAD_BYTES = 64;

export const fileObjectPath = (uid: string, fileId: string) => `users/${uid}/files/${fileId}`;

export const parseFileObjectPath = (name: unknown): { uid: string; fileId: string } | null => {
  if (typeof name !== 'string') return null;
  const match = /^users\/([^/]+)\/files\/([^/]+)$/.exec(name);
  if (!match || !OWNER_ID_PATTERN.test(match[1]) || !FILE_ID_PATTERN.test(match[2])) return null;
  return { uid: match[1], fileId: match[2] };
};

export interface FileLimits {
  readonly tier: 'free' | 'pro';
  readonly limitBytes: number;
  readonly maxFileBytes: number;
}

export const fileLimitsFor = (planData: unknown, now: Date, config: PilotConfig): FileLimits => {
  const tier = resolvePlan(planData, now, config).tier;
  return tier === 'pro'
    ? { tier, limitBytes: config.proStorageBytes, maxFileBytes: Math.min(config.proMaxFileBytes, FILE_OBJECT_CEILING_BYTES) }
    : { tier, limitBytes: config.freeStorageBytes, maxFileBytes: Math.min(config.freeMaxFileBytes, FILE_OBJECT_CEILING_BYTES) };
};

export class FileServiceError extends Error {
  constructor(readonly reason: 'quota' | 'size' | 'type' | 'not-found' | 'course-not-found' | 'not-ready',
    readonly details: Record<string, unknown> = {}) {
    super(reason);
    this.name = 'FileServiceError';
  }
}

const fail = (path: string, message: string): never => {
  throw new InputValidationError(`${path} ${message}.`);
};

const plainObject = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value as Record<string, unknown>;
};

const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'is not supported');
};

const ownerIdAt = (value: unknown): string => {
  if (typeof value !== 'string' || !OWNER_ID_PATTERN.test(value)) fail('ownerId', 'must be a valid account ID');
  return value as string;
};

const fileIdAt = (value: unknown): string => {
  if (typeof value !== 'string' || !FILE_ID_PATTERN.test(value)) fail('fileId', 'must be a valid file ID');
  return value as string;
};

const courseIdAt = (value: unknown, path = 'courseId'): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return fail(path, 'must be a string or null');
  const id = value.normalize('NFC').trim();
  if (!COURSE_ID_PATTERN.test(id) || id === '.' || id === '..' || /^__.*__$/.test(id)) fail(path, 'must be a valid course ID');
  return id;
};

/** Keeps the learner's own file name readable while removing path separators and control characters. */
export const cleanFileName = (value: unknown): string => {
  if (typeof value !== 'string') return fail('name', 'must be a string');
  const name = value.normalize('NFC').replace(/[\x00-\x1F\x7F/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) fail('name', 'must not be empty');
  return Array.from(name).slice(0, FILE_NAME_MAX_LENGTH).join('');
};

export interface PrepareFileUploadRequest {
  readonly ownerId: string;
  readonly name: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly purpose: FilePurpose;
  readonly courseId: string | null;
  /**
   * A file ID the browser chose. Asking again with the same ID and details returns the reservation the
   * first request made, so a request whose answer was lost does not reserve the bytes twice.
   */
  readonly fileId?: string;
}

export const parsePrepareFileUploadRequest = (value: unknown): PrepareFileUploadRequest => {
  const source = plainObject(value, 'request');
  onlyKeys(source, ['ownerId', 'name', 'contentType', 'bytes', 'purpose', 'courseId', 'fileId'], 'request');
  const contentType = typeof source.contentType === 'string' ? source.contentType.trim().toLowerCase() : '';
  if (!FILE_CONTENT_TYPES[contentType]) fail('contentType', 'is not supported');
  if (!Number.isSafeInteger(source.bytes) || Number(source.bytes) <= 0) fail('bytes', 'must be a positive integer');
  const purpose = source.purpose ?? 'source';
  if (!FILE_PURPOSES.includes(purpose as FilePurpose)) fail('purpose', 'is not supported');
  if (purpose === 'card-image' && FILE_CONTENT_TYPES[contentType] !== 'image') fail('contentType', 'must be an image for a card image');
  return {
    ownerId: ownerIdAt(source.ownerId),
    name: cleanFileName(source.name),
    contentType,
    bytes: Number(source.bytes),
    purpose: purpose as FilePurpose,
    courseId: courseIdAt(source.courseId),
    ...(source.fileId === undefined ? {} : { fileId: fileIdAt(source.fileId) }),
  };
};

export const parseFileIdRequest = (value: unknown): { ownerId: string; fileId: string } => {
  const source = plainObject(value, 'request');
  onlyKeys(source, ['ownerId', 'fileId'], 'request');
  return { ownerId: ownerIdAt(source.ownerId), fileId: fileIdAt(source.fileId) };
};

export const parseUpdateFileRequest = (value: unknown): { ownerId: string; fileId: string; courseId: string | null } => {
  const source = plainObject(value, 'request');
  onlyKeys(source, ['ownerId', 'fileId', 'courseId'], 'request');
  if (!('courseId' in source)) fail('courseId', 'is required');
  return { ownerId: ownerIdAt(source.ownerId), fileId: fileIdAt(source.fileId), courseId: courseIdAt(source.courseId) };
};

/** Where the next page of the file list starts: the creation time of the last file shown, then its ID. */
const FILE_LIST_CURSOR_PATTERN = /^(\d{1,16}):([A-Za-z0-9_-]{20,64})$/;

export const parseListFilesRequest = (value: unknown): { ownerId: string; cursor?: string } => {
  const source = plainObject(value, 'request');
  onlyKeys(source, ['ownerId', 'cursor'], 'request');
  const ownerId = ownerIdAt(source.ownerId);
  if (source.cursor === undefined || source.cursor === null) return { ownerId };
  if (typeof source.cursor !== 'string' || !FILE_LIST_CURSOR_PATTERN.test(source.cursor)) fail('cursor', 'must come from a file list');
  return { ownerId, cursor: source.cursor as string };
};

interface UsageRecord { usedBytes: number; reservedBytes: number; fileCount: number }
interface FileRecord {
  ownerId?: unknown; name?: unknown; kind?: unknown; contentType?: unknown; purpose?: unknown;
  courseId?: unknown; status?: unknown; declaredBytes?: unknown; bytes?: unknown;
  verification?: unknown; rejectionReason?: unknown; createdAt?: unknown; updatedAt?: unknown;
  reservationExpiresAt?: unknown;
}

const count = (value: unknown): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
const asDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate(): Date }).toDate();
  }
  return null;
};
const usageOf = (data: unknown): UsageRecord => {
  const source = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return { usedBytes: count(source.usedBytes), reservedBytes: count(source.reservedBytes), fileCount: count(source.fileCount) };
};

const ownerRefs = (database: Firestore, uid: string) => {
  const owner = database.collection('users').doc(uid);
  return {
    plan: owner.collection('profile').doc('plan'),
    usage: owner.collection('file_usage').doc('current'),
    files: owner.collection('files'),
    courses: owner.collection('profile').doc('courses'),
  };
};

const newFileId = () => randomBytes(15).toString('base64url');

/** Releases reservations whose upload never finished, inside the caller's transaction. */
const releaseExpired = async (transaction: Transaction, refs: ReturnType<typeof ownerRefs>,
  usage: UsageRecord, now: Date): Promise<{ usage: UsageRecord; released: DocumentReference[] }> => {
  const pending = await transaction.get(refs.files.where('status', '==', 'uploading').limit(FILE_LIST_LIMIT));
  const released: DocumentReference[] = [];
  let reservedBytes = usage.reservedBytes;
  for (const snapshot of pending.docs) {
    const record = snapshot.data() as FileRecord;
    const expiresAt = asDate(record.reservationExpiresAt);
    if (expiresAt && expiresAt > now) continue;
    reservedBytes = Math.max(0, reservedBytes - count(record.declaredBytes));
    released.push(snapshot.ref);
  }
  return { usage: { ...usage, reservedBytes }, released };
};

export interface PreparedFileUpload {
  readonly fileId: string;
  readonly path: string;
  readonly maxFileBytes: number;
  readonly expiresAt: string;
  /** The account's usage once this upload is reserved, so the device never estimates it. */
  readonly usage: FileListing['usage'];
}

export async function prepareFileUpload(database: Firestore, uid: string, request: PrepareFileUploadRequest,
  config: PilotConfig, now = new Date()): Promise<PreparedFileUpload> {
  const refs = ownerRefs(database, uid);
  const fileId = request.fileId ?? newFileId();
  const fileRef = refs.files.doc(fileId);
  const expiresAt = new Date(now.getTime() + FILE_RESERVATION_TTL_MS);
  return database.runTransaction(async transaction => {
    const [planSnapshot, usageSnapshot, coursesSnapshot, existingSnapshot] = await Promise.all([
      transaction.get(refs.plan), transaction.get(refs.usage),
      request.courseId ? transaction.get(refs.courses) : Promise.resolve(null),
      request.fileId ? transaction.get(fileRef) : Promise.resolve(null),
    ]);
    const limits = fileLimitsFor(planSnapshot.data(), now, config);
    const existing = existingSnapshot?.exists ? existingSnapshot.data() as FileRecord : undefined;
    if (existing) {
      // The same request again: hand back its reservation instead of making a second one.
      const reservationEndsAt = asDate(existing.reservationExpiresAt);
      const sameUpload = existing.status === 'uploading' && existing.name === request.name
        && existing.contentType === request.contentType && existing.purpose === request.purpose
        && (existing.courseId ?? null) === request.courseId && existing.declaredBytes === request.bytes;
      if (!sameUpload) fail('fileId', 'is already used by another file');
      if (reservationEndsAt && reservationEndsAt > now) {
        return {
          fileId, path: fileObjectPath(uid, fileId), maxFileBytes: limits.maxFileBytes,
          expiresAt: reservationEndsAt.toISOString(), usage: usageOf(usageSnapshot.data()),
        };
      }
    }
    if (request.courseId && !courseExists(coursesSnapshot, request.courseId)) {
      throw new FileServiceError('course-not-found');
    }
    const { usage, released } = await releaseExpired(transaction, refs, usageOf(usageSnapshot.data()), now);
    if (request.bytes > limits.maxFileBytes) {
      throw new FileServiceError('size', { maxFileBytes: limits.maxFileBytes });
    }
    if (usage.usedBytes + usage.reservedBytes + request.bytes > limits.limitBytes) {
      throw new FileServiceError('quota', { limitBytes: limits.limitBytes, usedBytes: usage.usedBytes, reservedBytes: usage.reservedBytes });
    }
    // An expired reservation of this very file is replaced below rather than deleted first.
    for (const ref of released) if (ref.path !== fileRef.path) transaction.delete(ref);
    const nextUsage = { usedBytes: usage.usedBytes, reservedBytes: usage.reservedBytes + request.bytes, fileCount: usage.fileCount };
    transaction.set(refs.usage, { ...nextUsage, updatedAt: now });
    const record = {
      schemaVersion: 1,
      ownerId: uid,
      name: request.name,
      kind: FILE_CONTENT_TYPES[request.contentType],
      contentType: request.contentType,
      purpose: request.purpose,
      courseId: request.courseId,
      status: 'uploading',
      declaredBytes: request.bytes,
      bytes: null,
      verification: 'pending',
      rejectionReason: null,
      storagePath: fileObjectPath(uid, fileId),
      createdAt: now,
      updatedAt: now,
      reservationExpiresAt: expiresAt,
    };
    if (existing) transaction.set(fileRef, record);
    else transaction.create(fileRef, record);
    return { fileId, path: fileObjectPath(uid, fileId), maxFileBytes: limits.maxFileBytes, expiresAt: expiresAt.toISOString(), usage: nextUsage };
  });
}

/** An account without a stored course profile has the implicit legacy profile, as course reads assume. */
const courseExists = (snapshot: { exists: boolean; data(): unknown } | null, courseId: string): boolean => {
  const data = snapshot?.exists ? snapshot.data() : createLegacyCourseProfile();
  const courses = data && typeof data === 'object' ? (data as { courses?: unknown }).courses : null;
  return Array.isArray(courses) && courses.some(course => course && typeof course === 'object'
    && (course as { id?: unknown }).id === courseId);
};

/** Recognises each accepted type by its leading bytes. EPUB without its mimetype entry first is partial. */
export const verifyFileSignature = (contentType: string, head: Uint8Array): 'complete' | 'partial' | 'failed' => {
  const ascii = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end));
  switch (contentType) {
    case 'application/pdf':
      return ascii(0, 5) === '%PDF-' ? 'complete' : 'failed';
    case 'application/epub+zip':
      if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) return 'failed';
      return ascii(30, 58) === 'mimetypeapplication/epub+zip' ? 'complete' : 'partial';
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? 'complete' : 'failed';
    case 'image/png':
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => head[index] === byte) ? 'complete' : 'failed';
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff ? 'complete' : 'failed';
    default:
      return 'failed';
  }
};

/** The Storage operations the file service needs; production wraps the admin bucket. */
export interface FileObjectStore {
  readHead(path: string, bytes: number): Promise<Uint8Array>;
  deleteObject(path: string): Promise<void>;
  deleteOwnerObjects(uid: string): Promise<void>;
}

export interface FinalizedObject {
  readonly name: string;
  readonly size: number;
  readonly contentType: string | null;
}

export type FinalizeOutcome =
  | { kind: 'ignored' }
  | { kind: 'deleted-unreserved' }
  | { kind: 'rejected'; reason: FileRejectionReason }
  | { kind: 'stored'; status: 'ready' | 'partial' };

const isSettledRecord = (record: FileRecord | undefined): boolean => record?.status === 'ready' || record?.status === 'partial';

export async function finalizeUploadedFile(database: Firestore, objects: FileObjectStore, object: FinalizedObject,
  config: PilotConfig, now = new Date()): Promise<FinalizeOutcome> {
  const owner = parseFileObjectPath(object.name);
  if (!owner) {
    // Anything under a learner's prefix that is not a well-formed file path has no record to own it.
    if (typeof object.name === 'string' && object.name.startsWith('users/')) {
      await objects.deleteObject(object.name);
      return { kind: 'deleted-unreserved' };
    }
    return { kind: 'ignored' };
  }
  const refs = ownerRefs(database, owner.uid);
  const fileRef = refs.files.doc(owner.fileId);
  const initial = await fileRef.get();
  const initialRecord = initial.data() as FileRecord | undefined;
  // A finalize event can be delivered more than once. The object of a file that is already settled is
  // owned by its record and its counted bytes, so a repeat delivery must leave both alone.
  if (isSettledRecord(initialRecord)) return { kind: 'ignored' };
  if (!initialRecord || initialRecord.status !== 'uploading') {
    await objects.deleteObject(object.name);
    return { kind: 'deleted-unreserved' };
  }
  const size = Number(object.size);
  const contentType = (object.contentType ?? '').toLowerCase();
  // A head that cannot be read settles nothing: the error fails the event so it is delivered again, and
  // the file stays reserved until the leading bytes can be checked.
  const verification = contentType !== initialRecord.contentType || !FILE_CONTENT_TYPES[contentType]
    ? 'failed' as const
    : verifyFileSignature(contentType, await objects.readHead(object.name, FILE_HEAD_BYTES));
  const outcome = await database.runTransaction(async transaction => {
    const [recordSnapshot, usageSnapshot, planSnapshot] = await Promise.all([
      transaction.get(fileRef), transaction.get(refs.usage), transaction.get(refs.plan),
    ]);
    const record = recordSnapshot.data() as FileRecord | undefined;
    if (isSettledRecord(record)) return { kind: 'ignored' } as const;
    if (!record || record.status !== 'uploading') return { kind: 'deleted-unreserved' } as const;
    const usage = usageOf(usageSnapshot.data());
    const limits = fileLimitsFor(planSnapshot.data(), now, config);
    const reservedBytes = Math.max(0, usage.reservedBytes - count(record.declaredBytes));
    const reason: FileRejectionReason | null = contentType !== record.contentType || !FILE_CONTENT_TYPES[contentType] ? 'type'
      : verification === 'failed' ? 'signature'
        : !Number.isSafeInteger(size) || size <= 0 || size > limits.maxFileBytes ? 'size'
          : usage.usedBytes + size > limits.limitBytes ? 'quota'
            : null;
    if (reason) {
      transaction.set(refs.usage, { ...usage, reservedBytes, updatedAt: now });
      transaction.update(fileRef, {
        status: 'rejected', rejectionReason: reason, verification: reason === 'signature' || reason === 'type' ? 'failed' : 'pending',
        bytes: Number.isSafeInteger(size) ? size : null, updatedAt: now, reservationExpiresAt: null,
      });
      return { kind: 'rejected', reason } as const;
    }
    const status = verification === 'complete' ? 'ready' : 'partial';
    transaction.set(refs.usage, {
      usedBytes: usage.usedBytes + size, reservedBytes, fileCount: usage.fileCount + 1, updatedAt: now,
    });
    transaction.update(fileRef, {
      status, verification, bytes: size, updatedAt: now, verifiedAt: now, reservationExpiresAt: null,
    });
    return { kind: 'stored', status } as const;
  });
  if (outcome.kind === 'rejected' || outcome.kind === 'deleted-unreserved') await objects.deleteObject(object.name);
  return outcome;
}

export interface FileSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: FileKind;
  readonly contentType: string;
  readonly purpose: FilePurpose;
  readonly courseId: string | null;
  readonly status: FileStatus;
  readonly verification: FileVerification;
  readonly bytes: number | null;
  readonly declaredBytes: number;
  readonly rejectionReason: FileRejectionReason | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

const summaryOf = (id: string, record: FileRecord): FileSummary | null => {
  if (typeof record.name !== 'string' || typeof record.contentType !== 'string') return null;
  const kind = FILE_CONTENT_TYPES[record.contentType];
  const status = record.status;
  if (!kind || (status !== 'uploading' && status !== 'ready' && status !== 'partial' && status !== 'rejected')) return null;
  const verification = ['pending', 'complete', 'partial', 'unavailable', 'failed'].includes(String(record.verification))
    ? record.verification as FileVerification : 'pending';
  return {
    id,
    name: record.name,
    kind,
    contentType: record.contentType,
    purpose: record.purpose === 'card-image' ? 'card-image' : 'source',
    courseId: typeof record.courseId === 'string' ? record.courseId : null,
    status,
    verification,
    bytes: Number.isSafeInteger(record.bytes) ? Number(record.bytes) : null,
    declaredBytes: count(record.declaredBytes),
    rejectionReason: typeof record.rejectionReason === 'string' ? record.rejectionReason as FileRejectionReason : null,
    createdAt: asDate(record.createdAt)?.toISOString() ?? null,
    updatedAt: asDate(record.updatedAt)?.toISOString() ?? null,
  };
};

export interface FileListing {
  readonly files: readonly FileSummary[];
  readonly usage: { readonly usedBytes: number; readonly reservedBytes: number; readonly fileCount: number };
  readonly limits: FileLimits;
  /** Passed back as `cursor` to list the files that come after this page; null when there are none. */
  readonly nextCursor: string | null;
}

/**
 * One page of the learner's files, newest first. A rejected upload has no stored object and only
 * explains the failure, so its record is removed once it is older than the window the learner is
 * shown; otherwise old rejections would fill every page ahead of the files that are still stored.
 */
export async function listFiles(database: Firestore, uid: string, config: PilotConfig, now = new Date(),
  cursor: string | null = null): Promise<FileListing> {
  const refs = ownerRefs(database, uid);
  const after = cursor === null ? null : FILE_LIST_CURSOR_PATTERN.exec(cursor);
  if (cursor !== null && !after) throw new InputValidationError('cursor must come from a file list.');
  let query = refs.files.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (after) query = query.startAfter(Timestamp.fromMillis(Number(after[1])), after[2]);
  const [planSnapshot, usageSnapshot, filesSnapshot] = await Promise.all([
    refs.plan.get(), refs.usage.get(), query.limit(FILE_LIST_LIMIT + 1).get(),
  ]);
  const usage = usageOf(usageSnapshot.data());
  const files: FileSummary[] = [];
  const staleRejected: DocumentReference[] = [];
  const page = filesSnapshot.docs.slice(0, FILE_LIST_LIMIT);
  const last = filesSnapshot.docs.length > FILE_LIST_LIMIT ? page[page.length - 1] : undefined;
  const lastCreatedAt = last ? asDate((last.data() as FileRecord).createdAt) : null;
  let expiredReservation = false;
  for (const snapshot of page) {
    const record = snapshot.data() as FileRecord;
    const updatedAt = asDate(record.updatedAt);
    if (record.status === 'rejected' && updatedAt && now.getTime() - updatedAt.getTime() > REJECTED_RECORD_TTL_MS) {
      staleRejected.push(snapshot.ref);
      continue;
    }
    const expiresAt = asDate(record.reservationExpiresAt);
    if (record.status === 'uploading' && expiresAt && expiresAt <= now) {
      expiredReservation = true;
      continue;
    }
    const summary = summaryOf(snapshot.id, record);
    if (summary) files.push(summary);
  }
  if (staleRejected.length) {
    const batch = database.batch();
    for (const ref of staleRejected) batch.delete(ref);
    await batch.commit();
  }
  // The usage shown is the one left after any reservation this call released.
  let shownUsage = usage;
  if (expiredReservation) {
    shownUsage = await database.runTransaction(async transaction => {
      const current = usageOf((await transaction.get(refs.usage)).data());
      const { usage: next, released } = await releaseExpired(transaction, refs, current, now);
      for (const ref of released) transaction.delete(ref);
      if (released.length) transaction.set(refs.usage, { ...next, updatedAt: now });
      return next;
    });
  }
  return {
    files,
    usage: { usedBytes: shownUsage.usedBytes, reservedBytes: shownUsage.reservedBytes, fileCount: shownUsage.fileCount },
    limits: fileLimitsFor(planSnapshot.data(), now, config),
    nextCursor: last && lastCreatedAt ? `${lastCreatedAt.getTime()}:${last.id}` : null,
  };
}

export async function updateFileCourse(database: Firestore, uid: string, fileId: string, courseId: string | null,
  now = new Date()): Promise<FileSummary> {
  const refs = ownerRefs(database, uid);
  const fileRef = refs.files.doc(fileId);
  return database.runTransaction(async transaction => {
    const [recordSnapshot, coursesSnapshot] = await Promise.all([
      transaction.get(fileRef), courseId ? transaction.get(refs.courses) : Promise.resolve(null),
    ]);
    const record = recordSnapshot.data() as FileRecord | undefined;
    if (!record) throw new FileServiceError('not-found');
    if (record.status !== 'ready' && record.status !== 'partial') throw new FileServiceError('not-ready');
    if (courseId && !courseExists(coursesSnapshot, courseId)) throw new FileServiceError('course-not-found');
    transaction.update(fileRef, { courseId, updatedAt: now });
    const summary = summaryOf(fileId, { ...record, courseId, updatedAt: now });
    if (!summary) throw new FileServiceError('not-found');
    return summary;
  });
}

/** Deletes the stored object first, then the record, and gives its bytes or reservation back. */
export async function deleteFile(database: Firestore, objects: FileObjectStore, uid: string, fileId: string,
  now = new Date()): Promise<{ usage: FileListing['usage'] }> {
  const refs = ownerRefs(database, uid);
  const fileRef = refs.files.doc(fileId);
  // A file that is already gone answers like the delete that removed it, so a repeated request after a
  // lost response still succeeds; removing an absent object is harmless.
  await objects.deleteObject(fileObjectPath(uid, fileId));
  return database.runTransaction(async transaction => {
    const [recordSnapshot, usageSnapshot] = await Promise.all([transaction.get(fileRef), transaction.get(refs.usage)]);
    const usage = usageOf(usageSnapshot.data());
    const record = recordSnapshot.data() as FileRecord | undefined;
    if (!record) return { usage: { usedBytes: usage.usedBytes, reservedBytes: usage.reservedBytes, fileCount: usage.fileCount } };
    const next = { ...usage };
    if (record.status === 'ready' || record.status === 'partial') {
      next.usedBytes = Math.max(0, usage.usedBytes - count(record.bytes));
      next.fileCount = Math.max(0, usage.fileCount - 1);
    } else if (record.status === 'uploading') {
      next.reservedBytes = Math.max(0, usage.reservedBytes - count(record.declaredBytes));
    }
    transaction.delete(fileRef);
    transaction.set(refs.usage, { ...next, updatedAt: now });
    return { usage: { usedBytes: next.usedBytes, reservedBytes: next.reservedBytes, fileCount: next.fileCount } };
  });
}

/** Minimal surface of a Cloud Storage bucket, so tests can pass a fake. */
export interface BucketLike {
  file(path: string): {
    download(options: { start: number; end: number }): Promise<[Buffer]>;
    delete(options: { ignoreNotFound: boolean }): Promise<unknown>;
  };
  deleteFiles(options: { prefix: string; force: boolean }): Promise<unknown>;
}

export const bucketFileObjects = (bucket: () => BucketLike): FileObjectStore => ({
  async readHead(path, bytes) {
    const [contents] = await bucket().file(path).download({ start: 0, end: bytes - 1 });
    return new Uint8Array(contents);
  },
  async deleteObject(path) {
    await bucket().file(path).delete({ ignoreNotFound: true });
  },
  async deleteOwnerObjects(uid) {
    if (!OWNER_ID_PATTERN.test(uid)) throw new Error('File owner ID is invalid.');
    try {
      await bucket().deleteFiles({ prefix: `users/${uid}/`, force: true });
    } catch (error) {
      // A bucket that does not exist holds no uploads, so there is nothing to remove.
      if ((error as { code?: unknown } | null)?.code === 404) return;
      throw error;
    }
  },
});

let accountFileObjects: FileObjectStore | null = null;

/** The deployed entry point registers its bucket so account deletion also removes stored objects. */
export const configureAccountFileObjects = (objects: FileObjectStore | null) => { accountFileObjects = objects; };
export const configuredAccountFileObjects = (): FileObjectStore | null => accountFileObjects;

export const exportedFileRows = async (database: Firestore, uid: string) => {
  const owner = database.collection('users').doc(uid);
  const [files, usage] = await Promise.all([owner.collection('files').get(), owner.collection('file_usage').get()]);
  return {
    files: files.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    fileUsage: usage.docs.map(doc => ({ id: doc.id, ...doc.data() })),
  };
};

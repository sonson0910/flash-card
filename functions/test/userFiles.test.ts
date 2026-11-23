import { describe, expect, it, vi } from 'vitest';
import { InputValidationError } from '../src/inputValidation.js';
import { parsePilotConfig, PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';
import {
  bucketFileObjects, cleanFileName, FILE_OBJECT_CEILING_BYTES, fileLimitsFor, fileObjectPath, parseFileIdRequest,
  parseFileObjectPath, parseListFilesRequest, parsePrepareFileUploadRequest, parseUpdateFileRequest, verifyFileSignature,
  type BucketLike,
} from '../src/userFiles.js';

const bytes = (...values: Array<number | string>) => {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === 'number') out.push(value);
    else for (const char of value) out.push(char.charCodeAt(0));
  }
  return new Uint8Array([...out, ...new Array(Math.max(0, 64 - out.length)).fill(0)]);
};
const now = new Date('2026-11-19T03:00:00.000Z');
const proPlan = {
  tier: 'pro', entitlementId: 'pro-1',
  startsAt: new Date('2026-11-01T00:00:00.000Z'), expiresAt: new Date('2026-12-01T00:00:00.000Z'),
};

describe('upload request parsing', () => {
  const valid = { ownerId: 'owner-1', name: 'reading.pdf', contentType: 'application/pdf', bytes: 1_024 };

  it('accepts a source upload and defaults the purpose and course', () => {
    expect(parsePrepareFileUploadRequest(valid)).toEqual({
      ownerId: 'owner-1', name: 'reading.pdf', contentType: 'application/pdf', bytes: 1_024, purpose: 'source', courseId: null,
    });
    expect(parsePrepareFileUploadRequest({ ...valid, contentType: ' Image/WEBP ', purpose: 'card-image', courseId: 'course-en' }))
      .toMatchObject({ contentType: 'image/webp', purpose: 'card-image', courseId: 'course-en' });
  });

  it('refuses unsupported types, non-positive sizes, unknown fields and card images that are not images', () => {
    for (const request of [
      { ...valid, contentType: 'text/html' },
      { ...valid, contentType: 'image/svg+xml' },
      { ...valid, bytes: 0 },
      { ...valid, bytes: 1.5 },
      { ...valid, bytes: '1024' },
      { ...valid, extra: true },
      { ...valid, purpose: 'avatar' },
      { ...valid, purpose: 'card-image' },
      { ...valid, ownerId: 'owner/1' },
      { ...valid, courseId: 'a/b' },
      { ...valid, name: '   ' },
      null,
      [],
    ]) expect(() => parsePrepareFileUploadRequest(request)).toThrow(InputValidationError);
  });

  it('keeps a readable name without separators or control characters', () => {
    expect(cleanFileName('  ../secret\\notes\u0000.pdf ')).toBe('.. secret notes .pdf');
    expect(Array.from(cleanFileName('a'.repeat(400)))).toHaveLength(160);
  });

  it('parses list, update and delete requests strictly', () => {
    expect(parseListFilesRequest({ ownerId: 'owner-1' })).toEqual({ ownerId: 'owner-1' });
    expect(() => parseListFilesRequest({ ownerId: 'owner-1', all: true })).toThrow(InputValidationError);
    const cursor = '1700000000000:AbCdEfGhIjKlMnOpQrSt';
    expect(parseListFilesRequest({ ownerId: 'owner-1', cursor })).toEqual({ ownerId: 'owner-1', cursor });
    expect(parseListFilesRequest({ ownerId: 'owner-1', cursor: null })).toEqual({ ownerId: 'owner-1' });
    for (const bad of ['', 'next', '1700000000000', '17000:short', `${cursor}/x`, 5]) {
      expect(() => parseListFilesRequest({ ownerId: 'owner-1', cursor: bad })).toThrow(InputValidationError);
    }
    expect(parseFileIdRequest({ ownerId: 'owner-1', fileId: 'AbCdEfGhIjKlMnOpQrSt' }))
      .toEqual({ ownerId: 'owner-1', fileId: 'AbCdEfGhIjKlMnOpQrSt' });
    expect(() => parseFileIdRequest({ ownerId: 'owner-1', fileId: '../x' })).toThrow(InputValidationError);
    expect(parseUpdateFileRequest({ ownerId: 'owner-1', fileId: 'AbCdEfGhIjKlMnOpQrSt', courseId: null }))
      .toMatchObject({ courseId: null });
    expect(() => parseUpdateFileRequest({ ownerId: 'owner-1', fileId: 'AbCdEfGhIjKlMnOpQrSt' })).toThrow(InputValidationError);
  });
});

describe('stored object paths', () => {
  it('recognises only well-formed owner file paths', () => {
    expect(parseFileObjectPath(fileObjectPath('owner-1', 'AbCdEfGhIjKlMnOpQrSt')))
      .toEqual({ uid: 'owner-1', fileId: 'AbCdEfGhIjKlMnOpQrSt' });
    for (const name of ['users/owner-1/files/short', 'users/owner-1/files/AbCdEfGhIjKlMnOpQrSt/x',
      'users/owner-1/avatar.png', 'public/AbCdEfGhIjKlMnOpQrSt', undefined]) {
      expect(parseFileObjectPath(name)).toBeNull();
    }
  });
});

describe('per-plan limits', () => {
  it('reads the allowance and the single-file limit from pilot configuration', () => {
    expect(fileLimitsFor(undefined, now, PILOT_CONFIG_DEFAULTS)).toEqual({
      tier: 'free', limitBytes: PILOT_CONFIG_DEFAULTS.freeStorageBytes, maxFileBytes: PILOT_CONFIG_DEFAULTS.freeMaxFileBytes,
    });
    expect(fileLimitsFor(proPlan, now, { ...PILOT_CONFIG_DEFAULTS, proStorageBytes: 9_000, proMaxFileBytes: 3_000 }))
      .toEqual({ tier: 'pro', limitBytes: 9_000, maxFileBytes: 3_000 });
  });

  it('falls back to the free limits once a Pro period has ended', () => {
    expect(fileLimitsFor(proPlan, new Date('2026-12-02T00:00:00.000Z'), PILOT_CONFIG_DEFAULTS).tier).toBe('free');
  });

  it('refuses a configured file limit above the Storage Rules ceiling', () => {
    const parsed = parsePilotConfig({ ...PILOT_CONFIG_DEFAULTS, proMaxFileBytes: FILE_OBJECT_CEILING_BYTES + 1, freeStorageBytes: 0 });
    expect(parsed.invalidFields).toEqual(['freeStorageBytes', 'proMaxFileBytes']);
    expect(parsed.config.proMaxFileBytes).toBe(PILOT_CONFIG_DEFAULTS.proMaxFileBytes);
    expect(PILOT_CONFIG_DEFAULTS.proMaxFileBytes).toBeLessThanOrEqual(FILE_OBJECT_CEILING_BYTES);
  });
});

describe('file signatures', () => {
  it('accepts each type by its leading bytes', () => {
    expect(verifyFileSignature('application/pdf', bytes('%PDF-1.7'))).toBe('complete');
    expect(verifyFileSignature('application/epub+zip',
      bytes(0x50, 0x4b, 0x03, 0x04, ...new Array(26).fill(0), 'mimetypeapplication/epub+zip'))).toBe('complete');
    expect(verifyFileSignature('image/webp', bytes('RIFF', 1, 2, 3, 4, 'WEBPVP8 '))).toBe('complete');
    expect(verifyFileSignature('image/png', bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('complete');
    expect(verifyFileSignature('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('complete');
  });

  it('marks a zip without the EPUB mimetype entry first as partial, and anything else as failed', () => {
    expect(verifyFileSignature('application/epub+zip', bytes(0x50, 0x4b, 0x03, 0x04))).toBe('partial');
    expect(verifyFileSignature('application/pdf', bytes('<html>'))).toBe('failed');
    expect(verifyFileSignature('image/png', bytes(0xff, 0xd8, 0xff))).toBe('failed');
    expect(verifyFileSignature('text/plain', bytes('%PDF-'))).toBe('failed');
  });
});

describe('bucket adapter', () => {
  it('reads only the head, ignores missing objects on delete and deletes an owner prefix', async () => {
    const download = vi.fn().mockResolvedValue([Buffer.from('%PDF-')]);
    const remove = vi.fn().mockResolvedValue(undefined);
    const deleteFiles = vi.fn().mockResolvedValue(undefined);
    const bucket = { file: vi.fn(() => ({ download, delete: remove })), deleteFiles } as unknown as BucketLike;
    const objects = bucketFileObjects(() => bucket);
    expect(Array.from(await objects.readHead('users/a/files/x', 64))).toEqual(Array.from(Buffer.from('%PDF-')));
    expect(download).toHaveBeenCalledWith({ start: 0, end: 63 });
    await objects.deleteObject('users/a/files/x');
    expect(remove).toHaveBeenCalledWith({ ignoreNotFound: true });
    await objects.deleteOwnerObjects('owner-1');
    expect(deleteFiles).toHaveBeenCalledWith({ prefix: 'users/owner-1/', force: true });
    await expect(objects.deleteOwnerObjects('../x')).rejects.toThrow('File owner ID is invalid.');
  });

  it('treats a missing bucket as holding no uploads, and passes on any other failure', async () => {
    const missing = Object.assign(new Error('The specified bucket does not exist.'), { code: 404 });
    const denied = Object.assign(new Error('Forbidden.'), { code: 403 });
    const deleteFiles = vi.fn().mockRejectedValueOnce(missing).mockRejectedValueOnce(denied);
    const bucket = { file: vi.fn(), deleteFiles } as unknown as BucketLike;
    const objects = bucketFileObjects(() => bucket);
    await expect(objects.deleteOwnerObjects('owner-1')).resolves.toBeUndefined();
    await expect(objects.deleteOwnerObjects('owner-1')).rejects.toBe(denied);
  });
});

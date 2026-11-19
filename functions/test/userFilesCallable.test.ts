import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';
import { RateLimitExceededError } from '../src/rateLimiter.js';
import { FileServiceError } from '../src/userFiles.js';

const prepareFileUpload = vi.fn();
const listFiles = vi.fn();
const updateFileCourse = vi.fn();
const deleteFile = vi.fn();
const finalizeUploadedFile = vi.fn();
const consumePersistentRateLimit = vi.fn();
const isAccountDeleting = vi.fn();

vi.mock('../src/userFiles.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/userFiles.js')>(),
  prepareFileUpload: (...args: unknown[]) => prepareFileUpload(...args),
  listFiles: (...args: unknown[]) => listFiles(...args),
  updateFileCourse: (...args: unknown[]) => updateFileCourse(...args),
  deleteFile: (...args: unknown[]) => deleteFile(...args),
  finalizeUploadedFile: (...args: unknown[]) => finalizeUploadedFile(...args),
}));

vi.mock('../src/pilotConfig.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/pilotConfig.js')>(),
  loadPilotConfig: async () => PILOT_CONFIG_DEFAULTS,
}));

vi.mock('../src/rateLimiter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/rateLimiter.js')>(),
  consumePersistentRateLimit: (...args: unknown[]) => consumePersistentRateLimit(...args),
}));

vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  isAccountDeleting: (...args: unknown[]) => isAccountDeleting(...args),
  readAccountAccess: async (...args: unknown[]) => ({ deleting: await isAccountDeleting(...args), profiled: true }),
}));

type Runnable = { run(request: unknown): Promise<unknown> };

const previousEnv = { ...process.env };
let endpoints: Record<'prepareFileUpload' | 'listMyFiles' | 'updateMyFile' | 'deleteMyFile' | 'finalizeFileUpload', Runnable>;
const fileId = 'AbCdEfGhIjKlMnOpQrSt';
const prepareData = { ownerId: 'owner-1', name: 'reading.pdf', contentType: 'application/pdf', bytes: 2_048 };

beforeAll(async () => {
  process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
  const module = await import('../src/index.js') as unknown as Record<string, Runnable>;
  endpoints = {
    prepareFileUpload: module.prepareFileUpload!, listMyFiles: module.listMyFiles!, updateMyFile: module.updateMyFile!,
    deleteMyFile: module.deleteMyFile!, finalizeFileUpload: module.finalizeFileUpload!,
  };
});

afterAll(() => {
  process.env = { ...previousEnv };
});

beforeEach(() => {
  for (const mock of [prepareFileUpload, listFiles, updateFileCourse, deleteFile, finalizeUploadedFile]) mock.mockReset();
  consumePersistentRateLimit.mockReset().mockResolvedValue(undefined);
  isAccountDeleting.mockReset().mockResolvedValue(false);
});

describe('file callables', () => {
  it('reserves an upload for the signed-in owner after spending the upload budget', async () => {
    prepareFileUpload.mockResolvedValue({ fileId, path: `users/owner-1/files/${fileId}`, maxFileBytes: 10, expiresAt: 'x' });
    await expect(endpoints.prepareFileUpload.run({ auth: { uid: 'owner-1' }, data: prepareData }))
      .resolves.toMatchObject({ fileId });
    expect(consumePersistentRateLimit).toHaveBeenCalledWith(expect.anything(), 'owner-1', 'file-prepare', 60);
    expect(prepareFileUpload).toHaveBeenCalledWith(expect.anything(), 'owner-1',
      expect.objectContaining({ ownerId: 'owner-1', bytes: 2_048, purpose: 'source' }), PILOT_CONFIG_DEFAULTS);
  });

  it('refuses signed-out, mismatched and malformed requests before any budget or write', async () => {
    await expect(endpoints.prepareFileUpload.run({ data: prepareData })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(endpoints.prepareFileUpload.run({ auth: { uid: 'owner-2' }, data: prepareData }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(endpoints.prepareFileUpload.run({ auth: { uid: 'owner-1' }, data: { ...prepareData, contentType: 'text/html' } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(endpoints.deleteMyFile.run({ auth: { uid: 'owner-1' }, data: { ownerId: 'owner-1', fileId: '../x' } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
    expect(prepareFileUpload).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('maps quota, size, missing file and course errors to stable reasons', async () => {
    prepareFileUpload.mockRejectedValueOnce(new FileServiceError('quota', { limitBytes: 100 }));
    await expect(endpoints.prepareFileUpload.run({ auth: { uid: 'owner-1' }, data: prepareData }))
      .rejects.toMatchObject({ code: 'resource-exhausted', details: { reason: 'storage-quota', limitBytes: 100 } });
    prepareFileUpload.mockRejectedValueOnce(new FileServiceError('size', { maxFileBytes: 10 }));
    await expect(endpoints.prepareFileUpload.run({ auth: { uid: 'owner-1' }, data: prepareData }))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'file-too-large', maxFileBytes: 10 } });
    deleteFile.mockRejectedValueOnce(new FileServiceError('not-found'));
    await expect(endpoints.deleteMyFile.run({ auth: { uid: 'owner-1' }, data: { ownerId: 'owner-1', fileId } }))
      .rejects.toMatchObject({ code: 'not-found', details: { reason: 'file-not-found' } });
    updateFileCourse.mockRejectedValueOnce(new FileServiceError('course-not-found'));
    await expect(endpoints.updateMyFile.run({ auth: { uid: 'owner-1' }, data: { ownerId: 'owner-1', fileId, courseId: 'c-1' } }))
      .rejects.toMatchObject({ code: 'not-found', details: { reason: 'course-not-found' } });
  });

  it('hides unexpected failures behind an internal error without the file name', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listFiles.mockRejectedValueOnce(new Error('reading.pdf exploded'));
    await expect(endpoints.listMyFiles.run({ auth: { uid: 'owner-1' }, data: { ownerId: 'owner-1' } }))
      .rejects.toMatchObject({ code: 'internal' });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('reading.pdf');
    consoleError.mockRestore();
  });

  it('stops at the rate limit', async () => {
    consumePersistentRateLimit.mockRejectedValueOnce(new RateLimitExceededError(60_000));
    await expect(endpoints.deleteMyFile.run({ auth: { uid: 'owner-1' }, data: { ownerId: 'owner-1', fileId } }))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('lists, attaches and deletes through the owner', async () => {
    listFiles.mockResolvedValue({ files: [], usage: { usedBytes: 0, reservedBytes: 0, fileCount: 0 }, limits: {} });
    await endpoints.listMyFiles.run({ auth: { uid: 'owner-1' }, data: { ownerId: 'owner-1' } });
    expect(listFiles).toHaveBeenCalledWith(expect.anything(), 'owner-1', PILOT_CONFIG_DEFAULTS);
    updateFileCourse.mockResolvedValue({ id: fileId });
    await expect(endpoints.updateMyFile.run({ auth: { uid: 'owner-1' }, data: { ownerId: 'owner-1', fileId, courseId: 'c-1' } }))
      .resolves.toEqual({ file: { id: fileId } });
    expect(updateFileCourse).toHaveBeenCalledWith(expect.anything(), 'owner-1', fileId, 'c-1');
    deleteFile.mockResolvedValue({ usage: { usedBytes: 0, reservedBytes: 0, fileCount: 0 } });
    await endpoints.deleteMyFile.run({ auth: { uid: 'owner-1' }, data: { ownerId: 'owner-1', fileId } });
    expect(deleteFile).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'owner-1', fileId);
  });
});

describe('finalize trigger', () => {
  it('settles the stored object with the size and type the bucket reports', async () => {
    finalizeUploadedFile.mockResolvedValue({ kind: 'stored', status: 'ready' });
    await endpoints.finalizeFileUpload.run({
      data: { name: `users/owner-1/files/${fileId}`, bucket: 'demo-lingoflash.appspot.com', size: '4096', contentType: 'application/pdf' },
    });
    expect(finalizeUploadedFile).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      { name: `users/owner-1/files/${fileId}`, size: 4_096, contentType: 'application/pdf' }, PILOT_CONFIG_DEFAULTS);
  });
});

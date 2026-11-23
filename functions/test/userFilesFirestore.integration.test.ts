import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportAccountData, purgeAccountData } from '../src/accountData.js';
import { analyticsPseudonym } from '../src/analyticsEvents.js';
import { LEGACY_COURSE_ID } from '../src/course-profile-contract.js';
import { PILOT_CONFIG_DEFAULTS, type PilotConfig } from '../src/pilotConfig.js';
import {
  bucketFileObjects, deleteFile, FileServiceError, finalizeUploadedFile, listFiles, prepareFileUpload,
  updateFileCourse, type BucketLike, type FileObjectStore,
} from '../src/userFiles.js';

// Runs inside `npm run test:rules`, which starts the Firestore and Storage emulators.
const describeWithEmulators = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST
  ? describe : describe.skip;
const BUCKET = 'demo-lingoflash.appspot.com';
const key = 'files-test-secret'.padEnd(32, 'x');
const now = new Date('2026-11-19T03:00:00.000Z');
const config: PilotConfig = { ...PILOT_CONFIG_DEFAULTS, freeStorageBytes: 4_096, freeMaxFileBytes: 3_000 };
const pdf = (size: number) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, size - 9), 0x20)]);

describeWithEmulators('learner file uploads against the emulators', () => {
  let app: App;
  let database: Firestore;
  type TestObject = ReturnType<BucketLike['file']> & { save(data: Buffer, options: unknown): Promise<void>; exists(): Promise<[boolean]> };
  let bucket: Omit<BucketLike, 'file'> & { file(path: string): TestObject };
  let objects: FileObjectStore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash', storageBucket: BUCKET }, 'user-files-integration');
    database = getFirestore(app, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
    bucket = getStorage(app).bucket(BUCKET) as unknown as typeof bucket;
    objects = bucketFileObjects(() => bucket);
  });
  afterAll(async () => { await database.terminate(); await deleteApp(app); });

  const owner = () => `files-${randomUUID()}`;
  const usageOf = async (uid: string) => (await database.collection('users').doc(uid)
    .collection('file_usage').doc('current').get()).data();
  const upload = async (uid: string, fileId: string, data: Buffer, contentType: string) => {
    const path = `users/${uid}/files/${fileId}`;
    await bucket.file(path).save(data, { contentType, resumable: false });
    return { name: path, size: data.length, contentType };
  };
  const exists = async (path: string) => (await bucket.file(path).exists())[0];
  const seedCourse = (uid: string) => database.collection('users').doc(uid).collection('profile').doc('courses')
    .set({ courses: [{ id: 'course-en' }], activeCourseId: 'course-en' });

  it('reserves bytes, then settles the real stored size and frees the reservation', async () => {
    const uid = owner();
    const prepared = await prepareFileUpload(database, uid, {
      ownerId: uid, name: 'reading.pdf', contentType: 'application/pdf', bytes: 1_000, purpose: 'source', courseId: null,
    }, config, now);
    expect(await usageOf(uid)).toMatchObject({ usedBytes: 0, reservedBytes: 1_000 });
    const object = await upload(uid, prepared.fileId, pdf(1_200), 'application/pdf');
    await expect(finalizeUploadedFile(database, objects, object, config, now)).resolves.toEqual({ kind: 'stored', status: 'ready' });
    expect(await usageOf(uid)).toMatchObject({ usedBytes: 1_200, reservedBytes: 0, fileCount: 1 });
    const listing = await listFiles(database, uid, config, now);
    expect(listing.files).toEqual([expect.objectContaining({
      id: prepared.fileId, name: 'reading.pdf', kind: 'pdf', status: 'ready', verification: 'complete', bytes: 1_200,
    })]);
    expect(listing.limits).toEqual({ tier: 'free', limitBytes: 4_096, maxFileBytes: 3_000 });
  });

  it('refuses a reservation over the plan file limit or the remaining allowance', async () => {
    const uid = owner();
    const request = { ownerId: uid, name: 'big.pdf', contentType: 'application/pdf', bytes: 3_001, purpose: 'source' as const, courseId: null };
    await expect(prepareFileUpload(database, uid, request, config, now)).rejects.toMatchObject({ reason: 'size' });
    await prepareFileUpload(database, uid, { ...request, bytes: 2_500 }, config, now);
    await expect(prepareFileUpload(database, uid, { ...request, bytes: 2_000 }, config, now))
      .rejects.toEqual(expect.objectContaining({ reason: 'quota' }));
    await expect(prepareFileUpload(database, uid, { ...request, bytes: 10, courseId: 'missing' }, config, now))
      .rejects.toBeInstanceOf(FileServiceError);
  });

  it('deletes an object that would push the account over its allowance', async () => {
    const uid = owner();
    const first = await prepareFileUpload(database, uid, {
      ownerId: uid, name: 'one.pdf', contentType: 'application/pdf', bytes: 100, purpose: 'source', courseId: null,
    }, config, now);
    const second = await prepareFileUpload(database, uid, {
      ownerId: uid, name: 'two.pdf', contentType: 'application/pdf', bytes: 100, purpose: 'source', courseId: null,
    }, config, now);
    // Both reservations declared 100 bytes; the stored objects are far larger than declared.
    await finalizeUploadedFile(database, objects, await upload(uid, first.fileId, pdf(2_900), 'application/pdf'), config, now);
    const over = await upload(uid, second.fileId, pdf(2_900), 'application/pdf');
    await expect(finalizeUploadedFile(database, objects, over, config, now)).resolves.toEqual({ kind: 'rejected', reason: 'quota' });
    expect(await exists(over.name)).toBe(false);
    expect(await usageOf(uid)).toMatchObject({ usedBytes: 2_900, reservedBytes: 0, fileCount: 1 });
  });

  it('rejects a wrong type or signature and removes objects nobody reserved', async () => {
    const uid = owner();
    const prepared = await prepareFileUpload(database, uid, {
      ownerId: uid, name: 'fake.pdf', contentType: 'application/pdf', bytes: 50, purpose: 'source', courseId: null,
    }, config, now);
    const fake = await upload(uid, prepared.fileId, Buffer.from('<html>not a pdf</html>'), 'application/pdf');
    await expect(finalizeUploadedFile(database, objects, fake, config, now)).resolves.toEqual({ kind: 'rejected', reason: 'signature' });
    expect(await exists(fake.name)).toBe(false);
    const swapped = await prepareFileUpload(database, uid, {
      ownerId: uid, name: 'swap.pdf', contentType: 'application/pdf', bytes: 50, purpose: 'source', courseId: null,
    }, config, now);
    const png = await upload(uid, swapped.fileId, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png');
    await expect(finalizeUploadedFile(database, objects, png, config, now)).resolves.toEqual({ kind: 'rejected', reason: 'type' });
    const stray = await upload(uid, 'StrayStrayStrayStray', pdf(100), 'application/pdf');
    await expect(finalizeUploadedFile(database, objects, stray, config, now)).resolves.toEqual({ kind: 'deleted-unreserved' });
    expect(await exists(stray.name)).toBe(false);
    expect(await usageOf(uid)).toMatchObject({ usedBytes: 0, reservedBytes: 0 });
  });

  it('attaches a stored file to an existing course, then deletes it and gives the bytes back', async () => {
    const uid = owner();
    await seedCourse(uid);
    const prepared = await prepareFileUpload(database, uid, {
      ownerId: uid, name: 'stories.pdf', contentType: 'application/pdf', bytes: 500, purpose: 'source', courseId: null,
    }, config, now);
    const object = await upload(uid, prepared.fileId, pdf(500), 'application/pdf');
    await finalizeUploadedFile(database, objects, object, config, now);
    await expect(updateFileCourse(database, uid, prepared.fileId, 'course-en', now)).resolves.toMatchObject({ courseId: 'course-en' });
    await expect(updateFileCourse(database, uid, prepared.fileId, 'course-missing', now)).rejects.toMatchObject({ reason: 'course-not-found' });
    await expect(deleteFile(database, objects, uid, prepared.fileId, now)).resolves.toEqual({ usage: { usedBytes: 0, reservedBytes: 0, fileCount: 0 } });
    expect(await exists(object.name)).toBe(false);
    expect((await listFiles(database, uid, config, now)).files).toEqual([]);
  });

  it('treats an account with no stored course profile as having only its legacy course', async () => {
    const uid = owner();
    const prepared = await prepareFileUpload(database, uid, {
      ownerId: uid, name: 'legacy.pdf', contentType: 'application/pdf', bytes: 500, purpose: 'source', courseId: LEGACY_COURSE_ID,
    }, config, now);
    const object = await upload(uid, prepared.fileId, pdf(500), 'application/pdf');
    await finalizeUploadedFile(database, objects, object, config, now);
    await expect(updateFileCourse(database, uid, prepared.fileId, null, now)).resolves.toMatchObject({ courseId: null });
    await expect(updateFileCourse(database, uid, prepared.fileId, LEGACY_COURSE_ID, now))
      .resolves.toMatchObject({ courseId: LEGACY_COURSE_ID });
    await expect(updateFileCourse(database, uid, prepared.fileId, 'course-en', now)).rejects.toMatchObject({ reason: 'course-not-found' });
    await expect(prepareFileUpload(database, uid, {
      ownerId: uid, name: 'other.pdf', contentType: 'application/pdf', bytes: 10, purpose: 'source', courseId: 'course-en',
    }, config, now)).rejects.toMatchObject({ reason: 'course-not-found' });
  });

  it('accepts the legacy course only while it is still in a stored course profile', async () => {
    const uid = owner();
    await seedCourse(uid);
    await expect(prepareFileUpload(database, uid, {
      ownerId: uid, name: 'legacy.pdf', contentType: 'application/pdf', bytes: 10, purpose: 'source', courseId: LEGACY_COURSE_ID,
    }, config, now)).rejects.toMatchObject({ reason: 'course-not-found' });
  });

  it('releases a reservation that expired without an upload', async () => {
    const uid = owner();
    await prepareFileUpload(database, uid, {
      ownerId: uid, name: 'late.pdf', contentType: 'application/pdf', bytes: 700, purpose: 'source', courseId: null,
    }, config, now);
    const later = new Date(now.getTime() + 61 * 60_000);
    expect((await listFiles(database, uid, config, later)).files).toEqual([]);
    expect(await usageOf(uid)).toMatchObject({ reservedBytes: 0 });
  });

  it('exports file records and removes both objects and records when the account is purged', async () => {
    const uid = owner();
    const prepared = await prepareFileUpload(database, uid, {
      ownerId: uid, name: 'mine.pdf', contentType: 'application/pdf', bytes: 300, purpose: 'source', courseId: null,
    }, config, now);
    const object = await upload(uid, prepared.fileId, pdf(300), 'application/pdf');
    await finalizeUploadedFile(database, objects, object, config, now);
    const exported = await exportAccountData(database, uid, key) as { files: Array<{ id: string; name: string }>; fileUsage: unknown[] };
    expect(exported.files).toEqual([expect.objectContaining({ id: prepared.fileId, name: 'mine.pdf' })]);
    expect(exported.fileUsage).toHaveLength(1);
    await purgeAccountData(database, uid, analyticsPseudonym(uid, key), objects);
    expect(await exists(object.name)).toBe(false);
    expect((await database.collection('users').doc(uid).collection('files').get()).empty).toBe(true);
    expect(await usageOf(uid)).toBeUndefined();
  });
});

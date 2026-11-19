import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, getMetadata, listAll, ref, updateMetadata, uploadBytes } from 'firebase/storage';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-lingoflash';
const OWNER = 'storage-owner';
const OTHER = 'storage-other';
const FILE_ID = 'AbCdEfGhIjKlMnOpQrSt';
const CEILING_BYTES = 50 * 1024 * 1024;
const pdfBytes = new TextEncoder().encode('%PDF-1.7\n% learner source\n');
const filePath = (uid = OWNER, fileId = FILE_ID) => `users/${uid}/files/${fileId}`;

// Runs inside `npm run test:rules`, which starts the Storage emulator; a plain unit run skips it.
const describeWithEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('Storage rules for learner uploads', () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      storage: { rules: await readFile('storage.rules', 'utf8') },
    });
  });

  beforeEach(async () => {
    await environment.clearStorage();
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  const ownerStorage = () => environment.authenticatedContext(OWNER).storage();

  const seedObject = async (path = filePath()) => {
    await environment.withSecurityRulesDisabled(async context => {
      await uploadBytes(ref(context.storage(), path), pdfBytes, { contentType: 'application/pdf' });
    });
  };

  it('lets the owner upload an accepted type under their own file path and read it back', async () => {
    const storage = ownerStorage();
    await assertSucceeds(uploadBytes(ref(storage, filePath()), pdfBytes, { contentType: 'application/pdf' }));
    await assertSucceeds(getMetadata(ref(storage, filePath())));
    await assertSucceeds(getBytes(ref(storage, filePath())));
    for (const [fileId, contentType] of [
      ['EpubEpubEpubEpubEpub', 'application/epub+zip'],
      ['WebpWebpWebpWebpWebp', 'image/webp'],
      ['PngPngPngPngPngPngPn', 'image/png'],
      ['JpegJpegJpegJpegJpeg', 'image/jpeg'],
    ] as const) {
      await assertSucceeds(uploadBytes(ref(storage, filePath(OWNER, fileId)), pdfBytes, { contentType }));
    }
  });

  it('refuses another account, and anyone signed out, for reads and writes', async () => {
    await seedObject();
    const other = environment.authenticatedContext(OTHER).storage();
    const signedOut = environment.unauthenticatedContext().storage();
    await assertFails(getMetadata(ref(other, filePath())));
    await assertFails(getBytes(ref(other, filePath())));
    await assertFails(uploadBytes(ref(other, filePath(OWNER, 'OtherOtherOtherOther')), pdfBytes, { contentType: 'application/pdf' }));
    await assertFails(getBytes(ref(signedOut, filePath())));
    await assertFails(uploadBytes(ref(signedOut, filePath(OWNER, 'SignedOutSignedOutSi')), pdfBytes, { contentType: 'application/pdf' }));
  });

  it('refuses content types outside the accepted list', async () => {
    const storage = ownerStorage();
    for (const contentType of ['application/zip', 'text/html', 'image/svg+xml', 'application/octet-stream']) {
      await assertFails(uploadBytes(ref(storage, filePath()), pdfBytes, { contentType }));
    }
  });

  it('refuses an object above the absolute ceiling and an empty object', async () => {
    const storage = ownerStorage();
    await assertFails(uploadBytes(ref(storage, filePath()), new Uint8Array(CEILING_BYTES + 1), { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(storage, filePath()), new Uint8Array(0), { contentType: 'application/pdf' }));
  });

  it('refuses malformed file IDs and any path outside the file folder', async () => {
    const storage = ownerStorage();
    for (const path of [filePath(OWNER, 'short'), filePath(OWNER, 'has.dots.in.the.file.id'), `users/${OWNER}/avatar.png`,
      `users/${OWNER}/files/${FILE_ID}/nested`, `public/${FILE_ID}`]) {
      await assertFails(uploadBytes(ref(storage, path), pdfBytes, { contentType: 'application/pdf' }));
    }
  });

  it('never lets the browser replace, delete, re-label or list stored files', async () => {
    await seedObject();
    const storage = ownerStorage();
    await assertFails(uploadBytes(ref(storage, filePath()), pdfBytes, { contentType: 'application/pdf' }));
    await assertFails(updateMetadata(ref(storage, filePath()), { contentType: 'image/png' }));
    await assertFails(deleteObject(ref(storage, filePath())));
    await assertFails(listAll(ref(storage, `users/${OWNER}/files`)));
  });
});

import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyLibraryFacetMutation, libraryFacetV2OperationId } from '../src/libraryFacetPersistence.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';

describeWithEmulator('Firestore library facet receipts', () => {
  let app: App;
  let database: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'library-facet-receipts-integration');
    database = getFirestore(app, DATABASE_ID);
  });

  afterAll(async () => {
    await database.terminate();
    await deleteApp(app);
  });

  it('commits a concurrent operation once and replays its original result', async () => {
    const ownerId = `facet-receipt-${randomUUID()}`;
    const operationCreatedAt = new Date().toISOString();
    const request = {
      op: 'delta' as const,
      ownerId,
      opId: libraryFacetV2OperationId(Date.parse(operationCreatedAt), randomUUID().replaceAll('-', '')),
      operationCreatedAt,
      delta: { IELTS: 1 },
    };
    const results = await Promise.all([
      applyLibraryFacetMutation(database, ownerId, request),
      applyLibraryFacetMutation(database, ownerId, request),
    ]);

    expect(results).toEqual([{ categories: { IELTS: 1 }, complete: false }, { categories: { IELTS: 1 }, complete: false }]);
    const owner = database.collection('users').doc(ownerId);
    expect((await owner.collection('profile').doc('library_facets').get()).data()).toMatchObject({
      categories: { IELTS: 1 }, complete: false,
    });
    expect((await owner.collection('library_facet_receipts').doc(request.opId).get()).data()).toMatchObject({
      fingerprint: expect.any(String), result: { categories: { IELTS: 1 }, complete: false },
    });
  });
});

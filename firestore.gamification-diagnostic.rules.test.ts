import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'demo-lingoflash';

describe('Firestore gamification rules expression budget', () => {
  let testEnvironment: RulesTestEnvironment;

  beforeAll(async () => {
    const rules = await readFile(new URL('./firestore.rules', import.meta.url), 'utf8');
    testEnvironment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules },
    });
  });

  afterEach(async () => {
    await testEnvironment.clearFirestore();
  });

  afterAll(async () => {
    await testEnvironment?.cleanup();
  });

  it('validates every stream document without a count-based expression boundary', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const stats = doc(owner, 'users/owner/profile/stats');
    const validStats = {
      streak: 4,
      xp: 1250,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: ['device-a:operation-1'],
      xpStreamSchemaVersion: 2,
    };

    await assertSucceeds(setDoc(stats, validStats));
    const stream = doc(owner, 'users/owner/xp_streams/device_a');
    await assertSucceeds(setDoc(stream, {
      schemaVersion: 2,
      clientId: 'device_a',
      sequence: 14,
      retiredAt: null,
    }));
    await assertSucceeds(getDoc(stats));
    await assertSucceeds(getDoc(stream));
    await assertFails(getDoc(doc(intruder, 'users/owner/profile/stats')));
    await assertFails(setDoc(doc(intruder, 'users/owner/profile/stats'), validStats));
    await assertFails(setDoc(stats, { ...validStats, administrator: true }));
    await assertFails(setDoc(stats, { ...validStats, xp: 1.5 }));
    await assertFails(setDoc(stats, { ...validStats, streak: -1 }));
    await assertFails(setDoc(stats, { ...validStats, xpStreamSchemaVersion: 1 }));
    await assertFails(setDoc(stats, { ...validStats, appliedXpSequenceByClient: { device_a: 14 } }));
    await assertFails(setDoc(stream, { schemaVersion: 2, clientId: 'device_a', sequence: 0, retiredAt: null }));
    await assertFails(setDoc(stream, { schemaVersion: 2, clientId: 'bad client', sequence: 14, retiredAt: null }));
    await assertFails(setDoc(doc(owner, 'users/owner/xp_streams/constructor'), {
      schemaVersion: 2,
      clientId: 'constructor',
      sequence: 1,
      retiredAt: null,
    }));
    await assertFails(setDoc(stream, { schemaVersion: 2, clientId: 'device_a', sequence: 1.5, retiredAt: null }));
    await assertFails(setDoc(stream, { schemaVersion: 2, clientId: 'device_a', sequence: 13, retiredAt: null }));
    await assertFails(setDoc(doc(owner, 'users/owner/xp_streams/device_b'), {
      schemaVersion: 2,
      clientId: 'device_b',
      sequence: 1,
      retiredAt: null,
      extra: true,
    }));
    await assertFails(setDoc(stats, {
      ...validStats,
      appliedXpOperationIds: Array.from({ length: 2049 }, (_, index) => `operation-${index}`),
    }));
    await assertFails(deleteDoc(stats));
    await assertFails(deleteDoc(stream));
  });
});

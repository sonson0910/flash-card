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

  it('validates every client sequence at the 16-stream boundary', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const stats = doc(owner, 'users/owner/profile/stats');
    const validStats = {
      streak: 4,
      xp: 1250,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: ['device-a:operation-1'],
      appliedXpSequenceByClient: { device_a: 14 },
    };
    const {
      appliedXpSequenceByClient: _sequenceWatermarks,
      ...statsWithoutSequenceWatermarks
    } = validStats;

    await assertSucceeds(setDoc(stats, validStats));
    await assertSucceeds(setDoc(stats, {
      ...validStats,
      appliedXpSequenceByClient: Object.fromEntries(
        Array.from({ length: 16 }, (_, index) => [`device_${index}`, index + 1]),
      ),
    }));
    await assertSucceeds(getDoc(stats));
    await assertFails(getDoc(doc(intruder, 'users/owner/profile/stats')));
    await assertFails(setDoc(doc(intruder, 'users/owner/profile/stats'), validStats));
    await assertFails(setDoc(stats, { ...validStats, administrator: true }));
    await assertFails(setDoc(stats, { ...validStats, xp: 1.5 }));
    await assertFails(setDoc(stats, { ...validStats, streak: -1 }));
    await assertFails(setDoc(stats, statsWithoutSequenceWatermarks));
    await assertFails(setDoc(stats, {
      ...validStats,
      appliedXpSequenceByClient: [],
    }));
    await assertFails(setDoc(stats, {
      ...validStats,
      appliedXpSequenceByClient: { device_a: 0 },
    }));
    await assertFails(setDoc(stats, {
      ...validStats,
      appliedXpSequenceByClient: Object.fromEntries(
        Array.from({ length: 17 }, (_, index) => [`device_${index}`, index + 1]),
      ),
    }));
    await assertFails(setDoc(stats, {
      ...validStats,
      appliedXpOperationIds: Array.from({ length: 2049 }, (_, index) => `operation-${index}`),
    }));
    await assertFails(deleteDoc(stats));
  });
});

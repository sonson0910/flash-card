import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'demo-lingoflash';

describe('Firestore gamification direct-write boundary', () => {
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

  it('keeps gamification documents owner-readable while denying direct mutations', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const stats = doc(owner, 'users/owner/profile/stats');
    const history = doc(owner, 'users/owner/profile/xp_history');
    const stream = doc(owner, 'users/owner/xp_streams/device_a');
    const validStats = {
      streak: 4,
      xp: 1250,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: ['device-a:operation-1'],
      xpStreamSchemaVersion: 2,
    };
    const validHistory = { 'Sun Aug 09 2026': 1250 };
    const validStream = {
      schemaVersion: 2,
      clientId: 'device_a',
      sequence: 14,
      retiredAt: null,
    };
    const protectedDocuments = [
      {
        owner: stats,
        intruder: doc(intruder, 'users/owner/profile/stats'),
        value: validStats,
        update: { xp: 1251 },
      },
      {
        owner: history,
        intruder: doc(intruder, 'users/owner/profile/xp_history'),
        value: validHistory,
        update: { 'Sun Aug 09 2026': 1251 },
      },
      {
        owner: stream,
        intruder: doc(intruder, 'users/owner/xp_streams/device_a'),
        value: validStream,
        update: { sequence: 15 },
      },
    ];

    await testEnvironment.withSecurityRulesDisabled(async context => {
      const trusted = context.firestore();
      await setDoc(doc(trusted, 'users/owner/profile/stats'), validStats);
      await setDoc(doc(trusted, 'users/owner/profile/xp_history'), validHistory);
      await setDoc(doc(trusted, 'users/owner/xp_streams/device_a'), validStream);
    });

    await assertSucceeds(getDoc(stats));
    await assertSucceeds(getDoc(history));
    await assertSucceeds(getDoc(stream));
    await assertFails(getDoc(doc(intruder, 'users/owner/profile/stats')));
    await assertFails(getDoc(doc(intruder, 'users/owner/profile/xp_history')));
    await assertFails(getDoc(doc(intruder, 'users/owner/xp_streams/device_a')));

    for (const protectedDocument of protectedDocuments) {
      await assertFails(updateDoc(protectedDocument.owner, protectedDocument.update));
      await assertFails(updateDoc(protectedDocument.intruder, protectedDocument.update));
      await assertFails(deleteDoc(protectedDocument.owner));
      await assertFails(deleteDoc(protectedDocument.intruder));
    }

    await testEnvironment.withSecurityRulesDisabled(async context => {
      const trusted = context.firestore();
      await deleteDoc(doc(trusted, 'users/owner/profile/stats'));
      await deleteDoc(doc(trusted, 'users/owner/profile/xp_history'));
      await deleteDoc(doc(trusted, 'users/owner/xp_streams/device_a'));
    });

    for (const protectedDocument of protectedDocuments) {
      await assertFails(setDoc(protectedDocument.owner, protectedDocument.value));
      await assertFails(setDoc(protectedDocument.intruder, protectedDocument.value));
    }
  });

  it('keeps per-card review XP awards server-only', async () => {
    const path = 'users/owner/review_xp_awards/award-1';
    const owner = doc(testEnvironment.authenticatedContext('owner').firestore(), path);
    const intruder = doc(testEnvironment.authenticatedContext('intruder').firestore(), path);
    const award = { cardId: 'word-focus', studyDay: '2026-10-01', schemaVersion: 1 };
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), path), award);
    });

    for (const reference of [owner, intruder]) {
      await assertFails(getDoc(reference));
      await assertFails(updateDoc(reference, { studyDay: '2026-10-02' }));
      await assertFails(deleteDoc(reference));
    }
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await deleteDoc(doc(context.firestore(), path));
    });
    await assertFails(setDoc(owner, award));
    await assertFails(setDoc(intruder, award));
  });
});

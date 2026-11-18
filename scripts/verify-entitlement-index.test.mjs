import { describe, expect, it } from 'vitest';
import {
  hasReadyEntitlementIndex,
  hasReadyServiceIndexes,
  missingServiceIndexes,
} from './verify-entitlement-index.mjs';

const project = 'sonflash-staging-20260906';
const database = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';
const index = {
  name: `projects/${project}/databases/${database}/collectionGroups/entitlements/indexes/abc`,
  queryScope: 'COLLECTION', state: 'READY',
  fields: [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'expiresAt', order: 'ASCENDING' },
    { fieldPath: '__name__', order: 'ASCENDING' },
  ],
};
const pushIndex = {
  name: `projects/${project}/databases/${database}/collectionGroups/reminderState/indexes/push`,
  queryScope: 'COLLECTION_GROUP', state: 'READY',
  fields: [
    { fieldPath: 'channels.push', order: 'ASCENDING' },
    { fieldPath: 'nextEligibleSendAt', order: 'ASCENDING' },
    { fieldPath: '__name__', order: 'ASCENDING' },
  ],
};
const emailIndex = {
  name: `projects/${project}/databases/${database}/collectionGroups/reminderState/indexes/email`,
  queryScope: 'COLLECTION_GROUP', state: 'READY',
  fields: [
    { fieldPath: 'channels.emailDigest', order: 'ASCENDING' },
    { fieldPath: 'nextWeeklyDigestAt', order: 'ASCENDING' },
    { fieldPath: '__name__', order: 'ASCENDING' },
  ],
};
const aiOpsIndex = {
  name: `projects/${project}/databases/${database}/collectionGroups/ai_operations/indexes/ops`,
  queryScope: 'COLLECTION_GROUP', state: 'READY',
  fields: [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'reservedAt', order: 'ASCENDING' },
    { fieldPath: '__name__', order: 'ASCENDING' },
  ],
};

describe('Pro intent and service composite index readback', () => {
  it('accepts only the ready index in the exact project and database', () => {
    expect(hasReadyEntitlementIndex([index], project, database)).toBe(true);
    expect(hasReadyEntitlementIndex([{ ...index, state: 'CREATING' }], project, database)).toBe(false);
    expect(hasReadyEntitlementIndex([{ ...index, queryScope: 'COLLECTION_GROUP' }], project, database)).toBe(false);
    expect(hasReadyEntitlementIndex([index], 'other-project', database)).toBe(false);
    expect(hasReadyEntitlementIndex([index], project, 'other-database')).toBe(false);
    expect(hasReadyEntitlementIndex([], project, database)).toBe(false);
  });

  it('verifies all four backend service composite indexes together', () => {
    const allFour = [index, pushIndex, emailIndex, aiOpsIndex];
    expect(hasReadyServiceIndexes(allFour, project, database)).toBe(true);
    expect(missingServiceIndexes(allFour, project, database)).toEqual([]);
    expect(missingServiceIndexes([index], project, database)).toEqual([
      'reminderState(channels.push, nextEligibleSendAt)',
      'reminderState(channels.emailDigest, nextWeeklyDigestAt)',
      'ai_operations(status, reservedAt)',
    ]);
  });
});

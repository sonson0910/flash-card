import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REQUIRED_SERVICE_INDEXES = [
  {
    label: 'entitlements(status, expiresAt)',
    collectionGroup: 'entitlements',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'expiresAt', order: 'ASCENDING' },
    ],
  },
  {
    label: 'reminderState(channels.push, nextEligibleSendAt)',
    collectionGroup: 'reminderState',
    queryScope: 'COLLECTION_GROUP',
    fields: [
      { fieldPath: 'channels.push', order: 'ASCENDING' },
      { fieldPath: 'nextEligibleSendAt', order: 'ASCENDING' },
    ],
  },
  {
    label: 'reminderState(channels.emailDigest, nextWeeklyDigestAt)',
    collectionGroup: 'reminderState',
    queryScope: 'COLLECTION_GROUP',
    fields: [
      { fieldPath: 'channels.emailDigest', order: 'ASCENDING' },
      { fieldPath: 'nextWeeklyDigestAt', order: 'ASCENDING' },
    ],
  },
  {
    label: 'ai_operations(status, reservedAt)',
    collectionGroup: 'ai_operations',
    queryScope: 'COLLECTION_GROUP',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'reservedAt', order: 'ASCENDING' },
    ],
  },
];

function hasReadyCompositeIndex(indexes, projectId, databaseId, spec) {
  if (!Array.isArray(indexes)) return false;
  const prefix = `projects/${projectId}/databases/${databaseId}/collectionGroups/${spec.collectionGroup}/indexes/`;
  return indexes.some(index => index?.name?.startsWith(prefix)
    && index.queryScope === spec.queryScope
    && index.state === 'READY'
    && spec.fields.every((field, idx) => index.fields?.[idx]?.fieldPath === field.fieldPath
      && index.fields[idx].order === field.order));
}

export function hasReadyEntitlementIndex(indexes, projectId, databaseId) {
  return hasReadyCompositeIndex(indexes, projectId, databaseId, REQUIRED_SERVICE_INDEXES[0]);
}

export function missingServiceIndexes(indexes, projectId, databaseId) {
  return REQUIRED_SERVICE_INDEXES
    .filter(spec => !hasReadyCompositeIndex(indexes, projectId, databaseId, spec))
    .map(spec => spec.label);
}

export function hasReadyServiceIndexes(indexes, projectId, databaseId) {
  return missingServiceIndexes(indexes, projectId, databaseId).length === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , projectId, databaseId] = process.argv;
  if (!projectId || !databaseId) throw new Error('Project and database are required.');
  const indexes = JSON.parse(readFileSync(0, 'utf8'));
  const missing = missingServiceIndexes(indexes, projectId, databaseId);
  if (missing.length > 0) {
    throw new Error(`Required Firestore composite indexes are not READY for ${projectId}/${databaseId}: ${missing.join(', ')}`);
  }
  console.log('All required service composite indexes (entitlements, push reminders, email digests, ai_operations) are READY.');
}

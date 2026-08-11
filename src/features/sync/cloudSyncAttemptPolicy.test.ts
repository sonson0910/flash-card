import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canAttemptCloudSync, resolveSyncEpoch } from './syncHealthModel';

describe('cloud sync attempt policy', () => {
  it('lets an explicit retry probe Firebase during an automatic quota cooldown', () => {
    expect(canAttemptCloudSync(true, true)).toBe(true);
    expect(canAttemptCloudSync(true, false)).toBe(false);
  });

  it('uses the epoch verified by the current retry without waiting for a React rerender', () => {
    expect(resolveSyncEpoch('owner-a', null, { userId: 'owner-a', value: 4 })).toBe(4);
  });

  it('never accepts a verified epoch belonging to another account', () => {
    expect(resolveSyncEpoch('owner-a', null, { userId: 'owner-b', value: 4 })).toBeNull();
  });

  it('does not present normal epoch verification as a cloud failure', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../librarySession/useLibraryDeviceSync.ts', import.meta.url)),
      'utf8',
    );
    const unverifiedEpochBranch = source.slice(
      source.indexOf('if (activeEpoch === null)'),
      source.indexOf('const database = db'),
    );

    expect(unverifiedEpochBranch).not.toContain("setError('Cloud pending; saved locally.')");
    expect(unverifiedEpochBranch).toContain('setError(null)');
  });
});

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
});

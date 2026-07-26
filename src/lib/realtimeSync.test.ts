import { describe, expect, it } from 'vitest';
import { shouldRefreshCountForRealtimeChanges } from './realtimeSync';

describe('shouldRefreshCountForRealtimeChanges', () => {
  it('does not run a second count for the initial listener snapshot', () => {
    expect(shouldRefreshCountForRealtimeChanges(true, ['added', 'added'])).toBe(false);
  });

  it('does not count again for an in-place card update', () => {
    expect(shouldRefreshCountForRealtimeChanges(false, ['modified'])).toBe(false);
  });

  it('refreshes the count after a remote card is added or removed', () => {
    expect(shouldRefreshCountForRealtimeChanges(false, ['added'])).toBe(true);
    expect(shouldRefreshCountForRealtimeChanges(false, ['removed'])).toBe(true);
  });
});

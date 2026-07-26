import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  loadStoredPendingOperations,
  updateStoredPendingOperations,
} from './pendingOperationStore';

describe('IndexedDB pending operation store', () => {
  it('updates a user-scoped queue atomically without exposing another user', async () => {
    await updateStoredPendingOperations('store-user-a', () => [{ id: 'a' }]);
    await updateStoredPendingOperations('store-user-b', () => [{ id: 'b' }]);
    await updateStoredPendingOperations<{ id: string }>('store-user-a', current => [
      ...current,
      { id: 'a2' },
    ]);

    await expect(loadStoredPendingOperations('store-user-a')).resolves.toEqual([
      { id: 'a' },
      { id: 'a2' },
    ]);
    await expect(loadStoredPendingOperations('store-user-b')).resolves.toEqual([{ id: 'b' }]);
  });
});

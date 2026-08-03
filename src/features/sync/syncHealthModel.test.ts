import { describe, expect, it } from 'vitest';
import {
  countPendingSyncOperations,
  getSyncErrorMessage,
  getSyncHealth,
} from './syncHealthModel';

describe('sync health model', () => {
  it('reports a fully persisted library as saved', () => {
    expect(getSyncHealth({
      isOnline: true,
      isSyncing: false,
      pendingCount: 0,
      error: null,
    })).toMatchObject({
      kind: 'saved',
      label: 'Saved',
      busy: false,
      canRetry: false,
    });
  });

  it('explains that pending changes remain safe while offline', () => {
    expect(getSyncHealth({
      isOnline: false,
      isSyncing: false,
      pendingCount: 3,
      error: null,
    })).toMatchObject({
      kind: 'saving-offline',
      label: 'Saving offline',
      busy: false,
      canRetry: false,
      message: '3 changes are safe on this device and will sync when you reconnect.',
    });
  });

  it('reports online pending work as syncing', () => {
    expect(getSyncHealth({
      isOnline: true,
      isSyncing: false,
      pendingCount: 1,
      error: null,
    })).toMatchObject({
      kind: 'syncing',
      label: 'Syncing',
      busy: true,
      canRetry: false,
      message: 'Syncing 1 change to your library.',
    });
  });

  it('gives actionable errors precedence and enables retry', () => {
    expect(getSyncHealth({
      isOnline: false,
      isSyncing: true,
      pendingCount: 2,
      error: 'Firebase is unavailable.',
    })).toMatchObject({
      kind: 'needs-attention',
      label: 'Needs attention',
      busy: false,
      canRetry: true,
      message: 'Firebase is unavailable.',
    });
  });

  it('counts only pending operations owned by the active account', () => {
    expect(countPendingSyncOperations([
      { ownerUserId: 'user-a' },
      { ownerUserId: 'user-b' },
      {},
      { ownerUserId: 'user-a' },
    ], 'user-a')).toBe(2);
  });

  it('turns unknown sync failures into a safe actionable message', () => {
    expect(getSyncErrorMessage(new Error('  Firebase is unavailable.  '))).toBe('Firebase is unavailable.');
    expect(getSyncErrorMessage({ code: 'unknown' })).toBe(
      'Sync is temporarily unavailable. Your changes are still safe on this device.',
    );
  });
});

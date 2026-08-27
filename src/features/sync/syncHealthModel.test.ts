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

  it('reports online pending work as queued when no sync attempt is active', () => {
    expect(getSyncHealth({
      isOnline: true,
      isSyncing: false,
      pendingCount: 1,
      error: null,
    })).toMatchObject({
      kind: 'queued',
      label: 'Waiting to sync',
      busy: false,
      canRetry: true,
      message: '1 change is safe on this device and waiting to sync.',
    });
  });

  it('only announces active work as syncing', () => {
    expect(getSyncHealth({
      isOnline: true,
      isSyncing: true,
      pendingCount: 5,
      error: null,
    })).toMatchObject({
      kind: 'syncing',
      label: 'Syncing',
      busy: true,
      canRetry: false,
      message: 'Syncing 5 changes to your library.',
    });
  });

  it('gives transient actionable errors precedence and enables retry', () => {
    expect(getSyncHealth({
      isOnline: false,
      isSyncing: true,
      pendingCount: 2,
      error: 'Cloud is temporarily unreachable. Your changes are safe on this device and will retry automatically.',
    })).toMatchObject({
      kind: 'needs-attention',
      label: 'Needs attention',
      busy: false,
      canRetry: true,
      message: 'Cloud is temporarily unreachable. Your changes are safe on this device and will retry automatically.',
    });
  });

  it('does not offer retry for an administrator configuration blocker', () => {
    expect(getSyncHealth({
      isOnline: true,
      isSyncing: false,
      pendingCount: 2,
      error: 'This app and its cloud configuration are out of sync. Your changes are safe; update the cloud configuration, then retry.',
    })).toMatchObject({
      kind: 'needs-attention',
      canRetry: false,
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
    expect(getSyncErrorMessage(new Error('private backend detail'))).toBe(
      'Sync is temporarily unavailable. Your changes are still safe on this device.',
    );
    expect(getSyncErrorMessage({ code: 'unknown' })).toBe(
      'Sync is temporarily unavailable. Your changes are still safe on this device.',
    );
  });

  it('keeps an IndexedDB upgrade blocker actionable without exposing internals', () => {
    const blocked = new Error(
      'Another SonFlash tab is blocking local sync storage. Close other SonFlash tabs, then retry syncing. Your changes remain safe on this device.',
    );
    blocked.name = 'PendingOperationStoreBlockedError';

    expect(getSyncErrorMessage(blocked)).toBe(blocked.message);
  });

  it('separates expired sign-in recovery from administrator access rules', () => {
    const permissionMessage = getSyncErrorMessage(Object.assign(
      new Error('Missing or insufficient permissions.'),
      { code: 'firestore/permission-denied' },
    ));
    const unauthenticatedMessage = getSyncErrorMessage({ code: 'functions/unauthenticated' });

    expect(permissionMessage).toBe(
      'Firebase access rules need administrator attention. Your changes are safe on this device; ask the app administrator to update access before trying again.',
    );
    expect(unauthenticatedMessage).toBe(
      'Your cloud sign-in is no longer current. Your changes are safe on this device; sign in again to resume syncing.',
    );
    expect(getSyncHealth({ isOnline: true, isSyncing: false, pendingCount: 2, error: permissionMessage }).canRetry).toBe(false);
    expect(getSyncHealth({ isOnline: true, isSyncing: false, pendingCount: 2, error: unauthenticatedMessage }).canRetry).toBe(false);
  });

  it('explains transient network and quota failures without losing safety context', () => {
    expect(getSyncErrorMessage({ code: 'unavailable' })).toBe(
      'Cloud is temporarily unreachable. Your changes are safe on this device and will retry automatically.',
    );
    expect(getSyncErrorMessage({ code: 'resource-exhausted' })).toBe(
      "Firebase's daily read limit has been reached. Changes stay safe on this device until the quota resets.",
    );
  });

  it('treats App Check startup and throttle failures as transient cloud errors', () => {
    for (const code of ['appCheck/initial-throttle', 'app-check/fetch-status-error']) {
      const message = getSyncErrorMessage({ code });
      expect(message).toBe(
        'The secure cloud check could not reach Firebase. Your changes are safe on this device and will retry automatically.',
      );
      expect(getSyncHealth({ isOnline: true, isSyncing: false, pendingCount: 2, error: message }).canRetry).toBe(true);
    }
  });
});

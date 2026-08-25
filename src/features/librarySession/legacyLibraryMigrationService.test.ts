import { beforeEach, describe, expect, it, vi } from 'vitest';

const functions = vi.hoisted(() => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  callable: vi.fn(),
  capability: { available: true } as { available: boolean; reason?: string },
}));

vi.mock('firebase/functions', () => ({
  getFunctions: functions.getFunctions,
  httpsCallable: functions.httpsCallable,
}));

vi.mock('../../lib/firebase', () => ({
  protectedFunctionsCapability: functions.capability,
}));

import { migrateLegacyLibraryWithAdmin } from './legacyLibraryMigrationService';

describe('legacyLibraryMigrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    functions.capability.available = true;
    delete functions.capability.reason;
    functions.getFunctions.mockReturnValue({ region: 'asia-southeast1' });
    functions.httpsCallable.mockReturnValue(functions.callable);
  });

  it('continues bounded Admin chunks until final verification is complete', async () => {
    functions.callable
      .mockResolvedValueOnce({
        data: { migrated: 100, merged: 2, scanned: 100, complete: false, remaining: 75, invalid: 0 },
      })
      .mockResolvedValueOnce({
        data: { migrated: 75, merged: 1, scanned: 75, complete: false, remaining: 0, invalid: 0 },
      })
      .mockResolvedValueOnce({
        data: { migrated: 0, merged: 0, scanned: 172, complete: true, remaining: 0, invalid: 0 },
      });

    await expect(migrateLegacyLibraryWithAdmin({} as never)).resolves.toEqual({
      migrated: 175,
      scanned: 175,
      complete: true,
    });
    expect(functions.httpsCallable).toHaveBeenCalledWith(
      { region: 'asia-southeast1' },
      'migrateLegacyLibrary',
    );
    expect(functions.callable).toHaveBeenCalledTimes(3);
    expect(functions.callable).toHaveBeenCalledWith({ batchSize: 100, dryRun: false });
    expect(functions.callable.mock.calls.flat()).not.toContainEqual(
      expect.objectContaining({ ownerId: expect.anything() }),
    );
  });

  it('fails closed on malformed or stalled callable responses', async () => {
    functions.callable.mockResolvedValueOnce({
      data: { migrated: 0, merged: 0, scanned: 0, complete: false, remaining: 1, invalid: 0 },
    });
    await expect(migrateLegacyLibraryWithAdmin({} as never))
      .rejects.toThrow('did not make progress');

    functions.callable.mockResolvedValueOnce({ data: { complete: true } });
    await expect(migrateLegacyLibraryWithAdmin({} as never))
      .rejects.toThrow('invalid response');
  });

  it('treats server-only discovery pages with migrated=0 as provisional progress', async () => {
    functions.callable
      .mockResolvedValueOnce({
        data: { migrated: 0, merged: 0, scanned: 100, complete: false, phase: 'discover', remaining: 1, invalid: 0 },
      })
      .mockResolvedValueOnce({
        data: { migrated: 0, merged: 0, scanned: 1, complete: false, phase: 'discovered', remaining: 0, invalid: 0 },
      });

    await expect(migrateLegacyLibraryWithAdmin({} as never)).resolves.toEqual({
      migrated: 0,
      scanned: 101,
      complete: false,
    });
    expect(functions.callable).toHaveBeenCalledTimes(2);
  });

  it('stops at provisional discovery without reporting migration completion', async () => {
    functions.callable.mockResolvedValueOnce({
      data: { migrated: 0, merged: 0, scanned: 1, complete: false, phase: 'discovered', remaining: 0, invalid: 0 },
    });

    await expect(migrateLegacyLibraryWithAdmin({} as never)).resolves.toEqual({
      migrated: 0,
      scanned: 1,
      complete: false,
    });
    expect(functions.callable).toHaveBeenCalledTimes(1);
  });

  it('blocks the Admin call when App Check is unavailable', async () => {
    functions.capability.available = false;
    functions.capability.reason = 'app-check-initialization-failed';

    await expect(migrateLegacyLibraryWithAdmin({} as never))
      .rejects.toThrow('Library upgrade is unavailable because the protected cloud service could not start securely.');
    expect(functions.getFunctions).not.toHaveBeenCalled();
  });
});

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

  it('uses exactly 30 calls for 3,000 source cards across apply and verification', async () => {
    for (let batch = 0; batch < 15; batch += 1) {
      functions.callable.mockResolvedValueOnce({
        data: { migrated: 200, merged: 0, scanned: 200, complete: false, remaining: 1, invalid: 0 },
      });
    }
    for (let batch = 0; batch < 14; batch += 1) {
      functions.callable.mockResolvedValueOnce({
        data: { migrated: 0, merged: 0, scanned: 200, complete: false, remaining: 1, invalid: 0 },
      });
    }
    functions.callable.mockResolvedValueOnce({
      data: { migrated: 0, merged: 0, scanned: 200, complete: true, remaining: 0, invalid: 0 },
    });

    await expect(migrateLegacyLibraryWithAdmin({} as never)).resolves.toMatchObject({
      migrated: 3_000,
      complete: true,
    });
    expect(functions.callable).toHaveBeenCalledTimes(30);
  });

  it('continues when a bounded page contains only cards already migrated', async () => {
    functions.callable
      .mockResolvedValueOnce({
        data: { migrated: 0, merged: 0, scanned: 100, complete: false, remaining: 1, invalid: 0 },
      })
      .mockResolvedValueOnce({
        data: { migrated: 0, merged: 0, scanned: 0, complete: true, remaining: 0, invalid: 0 },
      });

    await expect(migrateLegacyLibraryWithAdmin({} as never)).resolves.toEqual({
      migrated: 0,
      scanned: 100,
      complete: true,
    });
  });

  it('continues through the empty apply-to-verification transition', async () => {
    functions.callable
      .mockResolvedValueOnce({
        data: { migrated: 0, merged: 0, scanned: 0, complete: false, remaining: 1, invalid: 0 },
      })
      .mockResolvedValueOnce({
        data: { migrated: 0, merged: 0, scanned: 0, complete: true, remaining: 0, invalid: 0 },
      });

    await expect(migrateLegacyLibraryWithAdmin({} as never)).resolves.toEqual({
      migrated: 0,
      scanned: 0,
      complete: true,
    });
  });

  it('fails closed on malformed or stalled callable responses', async () => {
    functions.callable.mockResolvedValueOnce({
      data: { migrated: 0, merged: 0, scanned: 0, complete: false, remaining: 0, invalid: 0 },
    });
    await expect(migrateLegacyLibraryWithAdmin({} as never))
      .rejects.toThrow('did not make progress');

    functions.callable.mockResolvedValueOnce({ data: { complete: true } });
    await expect(migrateLegacyLibraryWithAdmin({} as never))
      .rejects.toThrow('invalid response');
  });

  it('shows the protected operator path when the browser source-card limit is reached', async () => {
    functions.callable.mockRejectedValueOnce({
      code: 'functions/failed-precondition',
      details: { reason: 'browser-source-card-limit', maximumSourceCards: 3_000 },
    });

    await expect(migrateLegacyLibraryWithAdmin({} as never)).rejects.toMatchObject({
      code: 'browser-source-card-limit',
      retryable: false,
      message: 'This library has more than 3,000 cards. Ask an administrator to run the protected operator migration.',
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

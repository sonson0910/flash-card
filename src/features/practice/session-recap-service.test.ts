import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'owner-1' } as { uid: string } | null },
  countCardsDueTomorrow: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth, db: {} }));
vi.mock('../../lib/cardRepository', () => ({ countCardsDueTomorrow: mocks.countCardsDueTomorrow }));

import { loadTomorrowDueCount } from './session-recap-service';

describe('loadTomorrowDueCount', () => {
  beforeEach(() => {
    mocks.auth.currentUser = { uid: 'owner-1' };
    mocks.countCardsDueTomorrow.mockReset();
  });

  it('uses one count query for the signed-in owner and selected language', async () => {
    mocks.countCardsDueTomorrow.mockResolvedValue(0);
    await expect(loadTomorrowDueCount('en')).resolves.toBe(0);
    expect(mocks.countCardsDueTomorrow).toHaveBeenCalledOnce();
    expect(mocks.countCardsDueTomorrow).toHaveBeenCalledWith({}, 'owner-1', 'en');
  });

  it('does not query when signed out or publish a result after an account switch', async () => {
    mocks.auth.currentUser = null;
    await expect(loadTomorrowDueCount('en')).rejects.toThrow('unavailable');
    expect(mocks.countCardsDueTomorrow).not.toHaveBeenCalled();

    mocks.auth.currentUser = { uid: 'owner-1' };
    mocks.countCardsDueTomorrow.mockImplementation(async () => {
      mocks.auth.currentUser = { uid: 'owner-2' };
      return 4;
    });
    await expect(loadTomorrowDueCount('en')).rejects.toThrow('owner changed');
  });
});

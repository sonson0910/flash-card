import { describe, expect, it, vi } from 'vitest';
import { createAccountProfileGuard } from '../src/account-profile-guard.js';

const fakeReads = (initial: { deleting?: boolean; profiled?: boolean } = {}) => {
  const state = { deleting: false, profiled: false, ...initial };
  const reads = {
    isDeleting: vi.fn(async (_uid: string) => state.deleting),
    readAccess: vi.fn(async (_uid: string) => ({ deleting: state.deleting, profiled: state.profiled })),
  };
  return { state, reads };
};

describe('account profile guard', () => {
  it('allows an account that holds a completed profile record', async () => {
    const { reads } = fakeReads({ profiled: true });
    await expect(createAccountProfileGuard(reads).check('owner-a')).resolves.toBe('allowed');
    expect(reads.readAccess).toHaveBeenCalledWith('owner-a');
  });

  it('refuses an account without a record, which includes every age-restricted account', async () => {
    const { reads } = fakeReads({ profiled: false });
    await expect(createAccountProfileGuard(reads).check('owner-a')).resolves.toBe('profile-required');
  });

  it('refuses an account in deletion before looking at its profile', async () => {
    const { reads } = fakeReads({ deleting: true, profiled: true });
    await expect(createAccountProfileGuard(reads).check('owner-a')).resolves.toBe('deleting');
  });

  it('remembers a profile, so a later call reads only the deletion tombstone', async () => {
    const { reads } = fakeReads({ profiled: true });
    const guard = createAccountProfileGuard(reads);
    await guard.check('owner-a');
    await expect(guard.check('owner-a')).resolves.toBe('allowed');
    await expect(guard.check('owner-a')).resolves.toBe('allowed');
    expect(reads.readAccess).toHaveBeenCalledTimes(1);
    expect(reads.isDeleting).toHaveBeenCalledTimes(2);
  });

  it('still refuses a remembered account once its deletion starts', async () => {
    const { state, reads } = fakeReads({ profiled: true });
    const guard = createAccountProfileGuard(reads);
    await guard.check('owner-a');
    state.deleting = true;
    await expect(guard.check('owner-a')).resolves.toBe('deleting');
    await expect(guard.check('owner-a')).resolves.toBe('deleting');
    expect(reads.readAccess).toHaveBeenCalledTimes(2);
  });

  it('never remembers a missing record, so completing the profile takes effect on the next call', async () => {
    const { state, reads } = fakeReads({ profiled: false });
    const guard = createAccountProfileGuard(reads);
    await expect(guard.check('owner-a')).resolves.toBe('profile-required');
    await expect(guard.check('owner-a')).resolves.toBe('profile-required');
    expect(reads.readAccess).toHaveBeenCalledTimes(2);
    expect(reads.isDeleting).not.toHaveBeenCalled();
    state.profiled = true;
    await expect(guard.check('owner-a')).resolves.toBe('allowed');
  });

  it('keeps the cache bounded and evicts the least recently used owner first', async () => {
    const { reads } = fakeReads({ profiled: true });
    const guard = createAccountProfileGuard(reads, 2);
    await guard.check('owner-a');
    await guard.check('owner-b');
    await guard.check('owner-a');
    await guard.check('owner-c');
    reads.readAccess.mockClear();
    await guard.check('owner-a');
    expect(reads.readAccess).not.toHaveBeenCalled();
    await guard.check('owner-b');
    expect(reads.readAccess).toHaveBeenCalledWith('owner-b');
  });

  it('rejects an invalid capacity', () => {
    const { reads } = fakeReads();
    expect(() => createAccountProfileGuard(reads, 0)).toThrow('positive integer');
  });
});

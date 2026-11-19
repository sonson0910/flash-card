export type AccountAccess = 'allowed' | 'deleting' | 'profile-required';

export interface AccountAccessReads {
  /** The deletion tombstone alone. */
  isDeleting(uid: string): Promise<boolean>;
  /** The deletion tombstone and the completed account profile record, in one round trip. */
  readAccess(uid: string): Promise<{ readonly deleting: boolean; readonly profiled: boolean }>;
}

export interface AccountProfileGuard {
  check(uid: string): Promise<AccountAccess>;
}

/**
 * Decides whether a signed-in account may use the endpoints that create or change learner content, grant
 * rewards or spend provider money: it must not be in deletion and must hold a completed account profile.
 *
 * The profile record is never changed after it is created and only account deletion removes it, which the
 * tombstone read on every call still catches. So a positive answer is remembered per instance, bounded,
 * and the steady-state cost stays one tombstone read. A missing record is never remembered, because
 * completing the profile creates it at any moment.
 */
export const createAccountProfileGuard = (reads: AccountAccessReads, maximumEntries = 4_096): AccountProfileGuard => {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries <= 0) {
    throw new Error('Account profile cache capacity must be a positive integer.');
  }
  // Insertion order doubles as recency: a hit is moved to the end, the oldest entry is evicted first.
  const profiled = new Set<string>();

  return {
    async check(uid) {
      if (profiled.has(uid)) {
        if (await reads.isDeleting(uid)) {
          profiled.delete(uid);
          return 'deleting';
        }
        profiled.delete(uid);
        profiled.add(uid);
        return 'allowed';
      }
      const access = await reads.readAccess(uid);
      if (access.deleting) return 'deleting';
      if (!access.profiled) return 'profile-required';
      if (profiled.size >= maximumEntries) {
        const oldest = profiled.values().next();
        if (!oldest.done) profiled.delete(oldest.value);
      }
      profiled.add(uid);
      return 'allowed';
    },
  };
};

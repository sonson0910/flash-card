import { describe, expect, it } from 'vitest';
import { toReviewHttpsError } from '../src/index.js';
import { ReviewPersistenceConflictError } from '../src/reviewPersistence.js';

describe('review callable rollout', () => {
  it('keeps strict rejection reasons off the legacy endpoint while V2 receives them', () => {
    const rejection = new ReviewPersistenceConflictError('stale-review');

    const legacy = toReviewHttpsError(rejection, false);
    const v2 = toReviewHttpsError(rejection, true);

    expect(legacy.code).toBe('failed-precondition');
    expect(legacy.details).toBeUndefined();
    expect(v2.details).toEqual({ reason: 'stale-review' });
  });
});

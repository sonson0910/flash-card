import { describe, expect, it } from 'vitest';
import {
  canStartLibraryClear,
  planClearFailureRecovery,
  planDeckDeletionFailureRecovery,
  runEpochProtectedLibraryClear,
} from './libraryMutationRecovery';

describe('bulk library mutation recovery', () => {
  it('does not start a clear while generation or import owns the loading state', () => {
    expect(canStartLibraryClear(true)).toBe(false);
    expect(canStartLibraryClear(false)).toBe(true);
  });

  it('does not claim a failed multi-batch clear left every card unchanged', () => {
    const recovery = planClearFailureRecovery(false);

    expect(recovery.clearLocalView).toBe(false);
    expect(recovery.message).toContain('Some cards may already have been deleted');
    expect(recovery.message).not.toContain('left unchanged');
  });

  it('fences each mutation step when a lease guard is provided', async () => {
    const order: string[] = [];
    await runEpochProtectedLibraryClear({
      assertActive: () => order.push('assert'),
      incrementEpoch: async () => {
        order.push('increment');
        return 4;
      },
      onEpochAdvanced: () => order.push('publish'),
      clearPending: async () => {
        order.push('clear-pending');
      },
      deleteCards: async () => {
        order.push('delete-cards');
      },
    });

    expect(order).toEqual([
      'assert',
      'increment',
      'assert',
      'publish',
      'assert',
      'clear-pending',
      'assert',
      'delete-cards',
      'assert',
    ]);
  });

  it('clears the local view when card deletion completed but metadata cleanup failed', () => {
    expect(planClearFailureRecovery(true).clearLocalView).toBe(true);
  });

  it('only applies a deck deletion locally after both primary cloud mutations completed', () => {
    expect(planDeckDeletionFailureRecovery(true, true).applyLocalResult).toBe(true);
    expect(planDeckDeletionFailureRecovery(true, false).applyLocalResult).toBe(false);
    expect(planDeckDeletionFailureRecovery(false, false).message).toContain('partially completed');
  });

  it('advances and publishes the epoch before clearing pending writes or deleting cards', async () => {
    const order: string[] = [];

    await expect(runEpochProtectedLibraryClear({
      incrementEpoch: async () => {
        order.push('increment');
        return 4;
      },
      onEpochAdvanced: epoch => {
        order.push(`publish-${epoch}`);
      },
      clearPending: async () => {
        order.push('clear-pending');
      },
      deleteCards: async () => {
        order.push('delete-cards');
      },
    })).resolves.toBe(4);

    expect(order).toEqual([
      'increment',
      'publish-4',
      'clear-pending',
      'delete-cards',
    ]);
  });

  it('passes the new epoch to card deletion for durable fencing', async () => {
    let deletionEpoch: number | undefined;

    await runEpochProtectedLibraryClear({
      incrementEpoch: async () => 4,
      onEpochAdvanced: () => undefined,
      clearPending: async () => undefined,
      deleteCards: async (epoch?: number) => {
        deletionEpoch = epoch;
      },
    });

    expect(deletionEpoch).toBe(4);
  });
});

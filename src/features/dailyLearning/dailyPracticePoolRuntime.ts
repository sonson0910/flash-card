import type { CardData } from '../../types/card';

export const DAILY_PRACTICE_POOL_LIMIT = 50;

export type DailyPracticePoolLoadResult =
  | {
      readonly status: 'loaded';
      readonly ownerId: string | null;
      readonly cards: readonly CardData[];
    }
  | { readonly status: 'stale' };

export interface DailyPracticePoolRuntime {
  load(maximum?: number): Promise<DailyPracticePoolLoadResult>;
  /** Invalidates in-flight work when the composing owner scope changes. */
  ownerChanged(): void;
}

export interface DailyPracticePoolRuntimeOptions {
  readonly activeOwner: () => string | null;
  /** Existing bounded Practice Pool port; this runtime never scans the library. */
  readonly loadPracticePool: (
    maximum?: number,
    includeFuture?: boolean,
  ) => Promise<CardData[]>;
}

const assertPoolLimit = (maximum: number): number => {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > DAILY_PRACTICE_POOL_LIMIT) {
    throw new RangeError(`Daily Practice Pool size must be between 1 and ${DAILY_PRACTICE_POOL_LIMIT}.`);
  }
  return maximum;
};

export function createDailyPracticePoolRuntime({
  activeOwner,
  loadPracticePool,
}: DailyPracticePoolRuntimeOptions): DailyPracticePoolRuntime {
  let ownerEpoch = 0;
  let requestGeneration = 0;

  return {
    async load(maximum = DAILY_PRACTICE_POOL_LIMIT) {
      const limit = assertPoolLimit(maximum);
      const token = {
        ownerId: activeOwner(),
        ownerEpoch,
        generation: ++requestGeneration,
      };
      const isCurrent = () => (
        token.ownerEpoch === ownerEpoch
        && token.generation === requestGeneration
        && token.ownerId === activeOwner()
      );
      let cards: CardData[];
      try {
        cards = await loadPracticePool(limit, true);
      } catch (error) {
        if (!isCurrent()) return { status: 'stale' };
        throw error;
      }
      if (!isCurrent()) return { status: 'stale' };
      return {
        status: 'loaded',
        ownerId: token.ownerId,
        cards: cards.slice(0, limit),
      };
    },
    ownerChanged() {
      ownerEpoch += 1;
    },
  };
}

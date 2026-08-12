export type PracticeActivity = 'study' | 'quiz' | 'spelling' | 'story';

export type PracticePreparationResult<T> =
  | { status: 'ready'; sessionToken: number; value: T }
  | { status: 'busy' }
  | { status: 'stale' }
  | { status: 'failed'; error: unknown; sessionToken: number };

export interface PracticePreparationScope {
  sessionToken: number;
  isCurrent(): boolean;
}

export interface PracticeSessionLifecycle {
  currentToken(): number;
  replaceOwner(ownerId: string | null): void;
  isCurrent(sessionToken: number): boolean;
  prepare<T>(
    activity: PracticeActivity,
    operation: (scope: PracticePreparationScope) => Promise<T>,
    onStart?: () => void,
  ): Promise<PracticePreparationResult<T>>;
  activate(activity: PracticeActivity, sessionToken: number): boolean;
  isActive(activity: PracticeActivity): boolean;
  clear(activity?: PracticeActivity): void;
  reset(): void;
  claimReview(cardId: string): boolean;
  settleReview(cardId: string, outcome: 'saved' | 'retry'): boolean;
  isReviewed(cardId: string): boolean;
}

interface Preparation {
  id: symbol;
  activity: PracticeActivity;
  sessionToken: number;
}

export function createPracticeSessionLifecycle(
  initialOwnerId: string | null,
): PracticeSessionLifecycle {
  let ownerId = initialOwnerId;
  let generation = 0;
  let preparation: Preparation | null = null;
  let active: { activity: PracticeActivity; sessionToken: number } | null = null;
  const pendingReviewIds = new Set<string>();
  const reviewedCardIds = new Set<string>();

  const currentToken = () => generation;
  const isCurrent = (sessionToken: number) => sessionToken === generation;

  const resetReviewAuthority = () => {
    pendingReviewIds.clear();
    reviewedCardIds.clear();
  };

  const reset = () => {
    preparation = null;
    active = null;
    resetReviewAuthority();
  };

  const replaceOwner = (nextOwnerId: string | null) => {
    if (ownerId === nextOwnerId) return;
    ownerId = nextOwnerId;
    generation += 1;
    reset();
  };

  const prepare = async <T>(
    activity: PracticeActivity,
    operation: (scope: PracticePreparationScope) => Promise<T>,
    onStart?: () => void,
  ): Promise<PracticePreparationResult<T>> => {
    if (preparation?.sessionToken === generation) return { status: 'busy' };

    const current: Preparation = {
      id: Symbol(activity),
      activity,
      sessionToken: generation,
    };
    preparation = current;
    const scope: PracticePreparationScope = {
      sessionToken: current.sessionToken,
      isCurrent: () => isCurrent(current.sessionToken) && preparation?.id === current.id,
    };

    try {
      onStart?.();
      const value = await operation(scope);
      if (!isCurrent(current.sessionToken) || preparation?.id !== current.id) {
        return { status: 'stale' };
      }
      return { status: 'ready', sessionToken: current.sessionToken, value };
    } catch (error) {
      if (!isCurrent(current.sessionToken) || preparation?.id !== current.id) {
        return { status: 'stale' };
      }
      return { status: 'failed', error, sessionToken: current.sessionToken };
    } finally {
      if (preparation?.id === current.id) preparation = null;
    }
  };

  const activate = (activity: PracticeActivity, sessionToken: number) => {
    if (!isCurrent(sessionToken)) return false;
    active = { activity, sessionToken };
    if (activity === 'study') resetReviewAuthority();
    return true;
  };

  const isActive = (activity: PracticeActivity) => active?.activity === activity
    && isCurrent(active.sessionToken);

  const clear = (activity?: PracticeActivity) => {
    if (activity === undefined) {
      preparation = null;
      active = null;
      resetReviewAuthority();
      return;
    }
    if (preparation?.activity === activity) preparation = null;
    if (active?.activity === activity) active = null;
    if (activity === 'study') resetReviewAuthority();
  };

  const claimReview = (cardId: string) => {
    if (!isActive('study')) return false;
    if (pendingReviewIds.has(cardId) || reviewedCardIds.has(cardId)) return false;
    pendingReviewIds.add(cardId);
    return true;
  };

  const settleReview = (cardId: string, outcome: 'saved' | 'retry') => {
    const wasPending = pendingReviewIds.delete(cardId);
    if (!isActive('study') || !wasPending) return false;
    if (outcome === 'saved') reviewedCardIds.add(cardId);
    return true;
  };

  const isReviewed = (cardId: string) => isActive('study') && reviewedCardIds.has(cardId);

  return {
    currentToken,
    replaceOwner,
    isCurrent,
    prepare,
    activate,
    isActive,
    clear,
    reset,
    claimReview,
    settleReview,
    isReviewed,
  };
}

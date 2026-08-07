import type { LearningStateV3 } from '../multilingual/schemaV3';

export const CATALOG_PROGRESS_MEMBERSHIP_LIMIT = 10_000;
export const CATALOG_MASTERY_THRESHOLD = 0.8;

export type CatalogLearningStatus = 'not-started' | 'started' | 'mastered';
export type CatalogTierProgressStatus = 'not-started' | 'in-progress' | 'completed';

export interface CatalogProgressMembership {
  readonly membershipId: string;
  readonly lexemeId: string;
  readonly trackId: string;
  readonly tier: string;
}

export interface CatalogTierProgress {
  readonly tier: string;
  readonly total: number;
  readonly started: number;
  readonly mastered: number;
  readonly percentMastered: number;
  readonly status: CatalogTierProgressStatus;
}

export interface CatalogTrackProgress {
  readonly trackId: string;
  readonly total: number;
  readonly started: number;
  readonly mastered: number;
  readonly percentMastered: number;
  readonly tiers: Readonly<Record<string, CatalogTierProgress>>;
}

export interface CatalogProgressSummary {
  readonly totalMemberships: number;
  readonly uniqueLexemes: number;
  readonly tracks: Readonly<Record<string, CatalogTrackProgress>>;
}

interface MutableProgressCount {
  total: number;
  started: number;
  mastered: number;
}

interface MutableTrackProgress extends MutableProgressCount {
  readonly tiers: Map<string, MutableProgressCount>;
}

const hasReviewEvidence = (state: LearningStateV3): boolean => (
  state.reviewHistory.length > 0
  || (state.reviews ?? 0) > 0
  || (state.fsrs?.reps ?? 0) > 0
);

export function classifyCatalogLearningState(
  state: LearningStateV3 | null | undefined,
): CatalogLearningStatus {
  if (!state) return 'not-started';
  if ((state.mastery ?? 0) >= CATALOG_MASTERY_THRESHOLD) return 'mastered';
  return hasReviewEvidence(state) ? 'started' : 'not-started';
}

const increment = (target: MutableProgressCount, status: CatalogLearningStatus): void => {
  target.total += 1;
  if (status === 'started' || status === 'mastered') target.started += 1;
  if (status === 'mastered') target.mastered += 1;
};

const percentage = (mastered: number, total: number): number => (
  total === 0 ? 0 : Math.round((mastered / total) * 100)
);

const tierStatus = (value: MutableProgressCount): CatalogTierProgressStatus => {
  if (value.total > 0 && value.mastered === value.total) return 'completed';
  if (value.started > 0) return 'in-progress';
  return 'not-started';
};

const assertIdentifier = (value: string, label: string): void => {
  if (!value || value.length > 128) throw new TypeError(`${label} must contain between 1 and 128 characters.`);
};

export function aggregateCatalogProgress(
  memberships: readonly CatalogProgressMembership[],
  learningStates: ReadonlyMap<string, LearningStateV3 | null>,
): CatalogProgressSummary {
  if (memberships.length > CATALOG_PROGRESS_MEMBERSHIP_LIMIT) {
    throw new RangeError(`Catalog progress supports at most ${CATALOG_PROGRESS_MEMBERSHIP_LIMIT.toLocaleString('en-US')} memberships.`);
  }

  const membershipIds = new Set<string>();
  const lexemeIds = new Set<string>();
  const tracks = new Map<string, MutableTrackProgress>();

  for (const membership of memberships) {
    assertIdentifier(membership.membershipId, 'membershipId');
    assertIdentifier(membership.lexemeId, 'lexemeId');
    assertIdentifier(membership.trackId, 'trackId');
    assertIdentifier(membership.tier, 'tier');
    if (membershipIds.has(membership.membershipId)) {
      throw new TypeError(`Catalog progress contains duplicate membership ID: ${membership.membershipId}`);
    }
    membershipIds.add(membership.membershipId);
    lexemeIds.add(membership.lexemeId);

    const state = learningStates.get(membership.lexemeId);
    if (state && state.lexemeId !== membership.lexemeId) {
      throw new TypeError(`Learning State key does not match lexeme ID: ${membership.lexemeId}`);
    }
    const status = classifyCatalogLearningState(state);
    const track = tracks.get(membership.trackId) ?? {
      total: 0,
      started: 0,
      mastered: 0,
      tiers: new Map<string, MutableProgressCount>(),
    };
    const tier = track.tiers.get(membership.tier) ?? { total: 0, started: 0, mastered: 0 };
    increment(track, status);
    increment(tier, status);
    track.tiers.set(membership.tier, tier);
    tracks.set(membership.trackId, track);
  }

  const publicTracks: Record<string, CatalogTrackProgress> = {};
  tracks.forEach((track, trackId) => {
    const tiers: Record<string, CatalogTierProgress> = {};
    track.tiers.forEach((tier, tierId) => {
      tiers[tierId] = {
        tier: tierId,
        ...tier,
        percentMastered: percentage(tier.mastered, tier.total),
        status: tierStatus(tier),
      };
    });
    publicTracks[trackId] = {
      trackId,
      total: track.total,
      started: track.started,
      mastered: track.mastered,
      percentMastered: percentage(track.mastered, track.total),
      tiers,
    };
  });

  return {
    totalMemberships: memberships.length,
    uniqueLexemes: lexemeIds.size,
    tracks: publicTracks,
  };
}

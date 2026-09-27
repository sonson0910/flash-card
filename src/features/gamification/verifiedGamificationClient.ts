import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  app,
  auth,
  getSonFlashFunctions,
  protectedFunctionsCapability,
} from '../../lib/firebase';
import {
  assertProtectedFunctionsAvailable,
  classifyProtectedFunctionError,
  ProtectedFunctionError,
} from '../../lib/protectedFunctionsCapability';

export type CeremonyEvent = 'tierup' | 'streak' | 'levelup';
export const EQUIP_OWNED_FRAME_CALLABLE = 'equipOwnedFrame';

export interface AuthoritativeGamification {
  readonly xp: number;
  readonly level: number;
  readonly streak: number;
  readonly studyDay?: string;
}

export interface VerifiedGamificationOutcome extends AuthoritativeGamification {
  readonly events?: readonly CeremonyEvent[];
}

export interface ReviewGamificationOutcome {
  readonly gamification: VerifiedGamificationOutcome;
  readonly ceremonyEvents?: readonly CeremonyEvent[];
}

export interface RewardInventory {
  readonly unlockedBadgeIds: readonly string[];
  readonly ownedFrameIds: readonly string[];
  readonly ownedTitleIds: readonly string[];
  readonly equippedFrameId: string | null;
  readonly hintTokens: number;
  readonly streakFreezes: number;
}

export interface LegacyGamificationHistory {
  readonly label: 'legacy';
  readonly xp: number;
  readonly streak: number;
  readonly history: Readonly<Record<string, number>>;
}

export interface VerifiedGamificationState extends AuthoritativeGamification {
  readonly studyDay?: string;
  readonly xpHistory: Readonly<Record<string, number>>;
  readonly rewards: RewardInventory;
  readonly legacyHistory: LegacyGamificationHistory;
}

export interface UseVerifiedGamificationOptions {
  readonly ownerId: string | null;
  readonly database: Firestore | null;
}

const zeroInventory: RewardInventory = Object.freeze({
  unlockedBadgeIds: [], ownedFrameIds: [], ownedTitleIds: [], equippedFrameId: null,
  hintTokens: 0, streakFreezes: 0,
});

const zeroState = (): VerifiedGamificationState => ({
  xp: 0, level: 1, streak: 0, xpHistory: {}, rewards: zeroInventory,
  legacyHistory: { label: 'legacy', xp: 0, streak: 0, history: {} },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const counter = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum ? Number(value) : 0;

const strings = (value: unknown): readonly string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  : [];

const history = (value: unknown, verified = true): Record<string, number> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([day, amount]) => (
    (verified ? /^\d{4}-\d{2}-\d{2}$/.test(day) : day.length > 0 && day.length <= 64 && !['__proto__', 'constructor', 'prototype'].includes(day))
      && counter(amount) > 0 ? [[day, counter(amount)]] : []
  )));
};

const levelForXp = (xp: number) => Math.floor(Math.sqrt(xp / 100)) + 1;

const inventory = (value: unknown): RewardInventory => {
  const source = isRecord(value) ? value : {};
  const ownedFrameIds = strings(source.ownedFrameIds);
  const equippedFrameId = typeof source.equippedFrameId === 'string'
    && ownedFrameIds.includes(source.equippedFrameId)
    ? source.equippedFrameId
    : null;
  return {
    unlockedBadgeIds: strings(source.unlockedBadgeIds),
    ownedFrameIds,
    ownedTitleIds: strings(source.ownedTitleIds),
    equippedFrameId,
    hintTokens: counter(source.hintTokens, 3),
    streakFreezes: counter(source.streakFreezes, 1),
  };
};

export function verifiedGamificationFromDocuments(
  statsValue: unknown,
  historyValue: unknown,
  rewardsValue: unknown,
): VerifiedGamificationState {
  const stats = isRecord(statsValue) ? statsValue : {};
  const xp = counter(stats.verifiedXp);
  return {
    xp,
    level: levelForXp(xp),
    streak: counter(stats.verifiedStreak),
    xpHistory: history(isRecord(historyValue) ? historyValue.verifiedByDayV1 : undefined),
    rewards: inventory(rewardsValue),
    legacyHistory: {
      label: 'legacy', xp: counter(stats.xp), streak: counter(stats.streak), history: history(historyValue, false),
    },
  };
}

export function acceptAuthoritativeGamificationOutcome(
  current: VerifiedGamificationState,
  outcome: VerifiedGamificationOutcome,
): VerifiedGamificationState {
  const outcomeXp = counter(outcome.xp);
  const outcomeLevel = levelForXp(outcomeXp);
  if (outcome.level !== outcomeLevel) return current;
  const isNewer = outcomeXp > current.xp;
  const xp = Math.max(current.xp, outcomeXp);
  const events = new Set(outcome.events);
  const rewards = current.rewards;
  const add = (items: readonly string[], item: string) => items.includes(item) ? items : [...items, item];
  const grantsStreak = events.has('streak') && !rewards.unlockedBadgeIds.includes('web-wanderer');
  const grantsLevel = events.has('levelup') && !rewards.ownedFrameIds.includes('crimson-wing');
  return {
    ...current,
    xp,
    level: levelForXp(xp),
    streak: isNewer ? counter(outcome.streak) : current.streak,
    ...(isNewer && typeof outcome.studyDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(outcome.studyDay) ? {
      studyDay: outcome.studyDay,
      xpHistory: {
        ...current.xpHistory,
        [outcome.studyDay]: (current.xpHistory[outcome.studyDay] ?? 0) + (outcomeXp - current.xp),
      },
    } : {}),
    rewards: {
      ...rewards,
      ...(grantsStreak ? {
        unlockedBadgeIds: add(rewards.unlockedBadgeIds, 'web-wanderer'),
        streakFreezes: Math.min(rewards.streakFreezes + 1, 1),
      } : {}),
      ...(grantsLevel ? {
        ownedFrameIds: add(rewards.ownedFrameIds, 'crimson-wing'),
        ownedTitleIds: add(rewards.ownedTitleIds, 'word-collector'),
        hintTokens: Math.min(rewards.hintTokens + 1, 3),
      } : {}),
    },
  };
}

export function replayAuthoritativeGamificationOutcomes(
  hydrated: VerifiedGamificationState,
  outcomes: readonly VerifiedGamificationOutcome[],
): VerifiedGamificationState {
  return normalizeDeferredGamificationOutcomes(outcomes)
    .reduce(acceptAuthoritativeGamificationOutcome, hydrated);
}

export function normalizeDeferredGamificationOutcomes(
  outcomes: readonly VerifiedGamificationOutcome[],
): VerifiedGamificationOutcome[] {
  const normalized = new Map<string, VerifiedGamificationOutcome>();
  for (const outcome of outcomes) {
    const xp = counter(outcome.xp);
    if (outcome.level !== levelForXp(xp)) continue;
    const key = `${xp}\u001f${outcome.studyDay ?? ''}`;
    const existing = normalized.get(key);
    const events = existing ? [...new Set([...(existing.events ?? []), ...(outcome.events ?? [])])] : outcome.events;
    normalized.set(key, existing ? {
      ...outcome,
      ...(events?.length ? { events } : {}),
    } : outcome);
  }
  return [...normalized.values()]
    .sort((left, right) => counter(left.xp) - counter(right.xp));
}

export async function hydrateVerifiedGamification(
  database: Firestore,
  ownerId: string,
): Promise<VerifiedGamificationState> {
  const profile = ['users', ownerId, 'profile'] as const;
  const [stats, xpHistory, rewards] = await Promise.all([
    getDoc(doc(database, ...profile, 'stats')),
    getDoc(doc(database, ...profile, 'xp_history')),
    getDoc(doc(database, ...profile, 'rewards')),
  ]);
  return verifiedGamificationFromDocuments(
    stats.exists() ? stats.data() : undefined,
    xpHistory.exists() ? xpHistory.data() : undefined,
    rewards.exists() ? rewards.data() : undefined,
  );
}

export async function equipRewardFrame(ownerId: string, frameId: string): Promise<string> {
  assertProtectedFunctionsAvailable(protectedFunctionsCapability, 'Reward frame');
  if (auth?.currentUser?.uid !== ownerId) {
    throw new ProtectedFunctionError({
      message: 'Reward frame stopped because the active account changed.',
      kind: 'authentication', code: 'owner-mismatch', retryable: false,
    });
  }
  try {
    const callable = httpsCallable<{ frameId: string }, { equippedFrameId: string }>(
      await getSonFlashFunctions(app!), EQUIP_OWNED_FRAME_CALLABLE,
    );
    const response = await callable({ frameId });
    if (response.data.equippedFrameId !== frameId) throw new Error('Reward frame returned an invalid response.');
    return response.data.equippedFrameId;
  } catch (error) {
    throw classifyProtectedFunctionError(error, 'Reward frame');
  }
}

export function useVerifiedGamificationState({ ownerId, database }: UseVerifiedGamificationOptions) {
  const [state, setState] = useState<VerifiedGamificationState>(zeroState);
  const ownerRef = useRef(ownerId);
  const stateOwnerRef = useRef(ownerId);
  const deferredOutcomesRef = useRef<VerifiedGamificationOutcome[]>([]);
  const hydrationPendingRef = useRef(false);
  ownerRef.current = ownerId;
  const scopedState = stateOwnerRef.current === ownerId ? state : zeroState();

  useEffect(() => {
    let cancelled = false;
    stateOwnerRef.current = ownerId;
    deferredOutcomesRef.current = [];
    hydrationPendingRef.current = Boolean(ownerId && database);
    setState(zeroState());
    if (!ownerId || !database) return () => { cancelled = true; };
    void hydrateVerifiedGamification(database, ownerId).then(next => {
      if (!cancelled && ownerRef.current === ownerId) {
        const deferredOutcomes = deferredOutcomesRef.current;
        deferredOutcomesRef.current = [];
        hydrationPendingRef.current = false;
        setState(replayAuthoritativeGamificationOutcomes(next, deferredOutcomes));
      }
    }).catch(error => {
      if (!cancelled && ownerRef.current === ownerId) {
        deferredOutcomesRef.current = [];
        hydrationPendingRef.current = false;
        console.error('Failed to hydrate verified gamification.', error);
      }
    });
    return () => {
      cancelled = true;
      deferredOutcomesRef.current = [];
      hydrationPendingRef.current = false;
    };
  }, [database, ownerId]);

  const acceptAuthoritativeOutcome = useCallback((outcome: VerifiedGamificationOutcome) => {
    if (outcome.level !== levelForXp(counter(outcome.xp))) return;
    if (hydrationPendingRef.current) {
      deferredOutcomesRef.current = normalizeDeferredGamificationOutcomes([
        ...deferredOutcomesRef.current,
        outcome,
      ]);
    }
    setState(current => acceptAuthoritativeGamificationOutcome(current, outcome));
  }, []);
  const equipFrame = useCallback(async (frameId = 'crimson-wing') => {
    if (!ownerId) throw new ProtectedFunctionError({
      message: 'Reward frame needs a current sign-in.', kind: 'authentication', code: 'unauthenticated', retryable: false,
    });
    const equippedFrameId = await equipRewardFrame(ownerId, frameId);
    if (ownerRef.current === ownerId) setState(current => ({
      ...current, rewards: { ...current.rewards, equippedFrameId },
    }));
  }, [ownerId]);

  return useMemo(() => ({ ...scopedState, acceptAuthoritativeOutcome, equipFrame }), [acceptAuthoritativeOutcome, equipFrame, scopedState]);
}

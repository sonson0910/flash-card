import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calculateLocalGamification } from './gamificationModel';
import {
  acknowledgeStoredGamificationSave,
  addXpToStoredGamification,
  readGamificationSnapshot,
  writeGamificationSnapshot,
  type GamificationStorage,
  type StoredGamificationSnapshot,
} from './gamificationStorage';
import { createGamificationStoreController, type GamificationStore } from './gamificationStore';
import { firebaseGamificationStore } from './firebaseGamificationStore';

export interface UseGamificationOptions {
  ownerId: string | null;
  cloudBackoffActive: boolean;
  store: GamificationStore | null;
  storage?: GamificationStorage;
  now?: () => Date;
  saveDelayMs?: number;
}

export interface GamificationState {
  streak: number;
  xp: number;
  xpHistory: Record<string, number>;
  level: number;
  addXp: (amount: number) => void;
}

const MAX_GAMIFICATION_SAVE_ATTEMPTS = 3;
const MAX_GAMIFICATION_SAVE_RETRY_DELAY_MS = 60_000;

const calculateStoredSnapshot = (
  storage: GamificationStorage,
  ownerId: string | null,
  now: Date,
): StoredGamificationSnapshot => {
  const stored = readGamificationSnapshot(storage, ownerId);
  const calculated = calculateLocalGamification(stored, now);
  return {
    ...calculated,
    history: stored.history,
    ...(stored.pendingOperations ? { pendingOperations: stored.pendingOperations } : {}),
  };
};

const normalizeLoadedSnapshot = (
  snapshot: StoredGamificationSnapshot,
  now: Date,
): StoredGamificationSnapshot => ({
  ...snapshot,
  ...calculateLocalGamification(snapshot, now),
  history: snapshot.history,
});

const samePublishedGamificationSnapshot = (
  left: StoredGamificationSnapshot,
  right: StoredGamificationSnapshot,
): boolean => {
  if (
    left.streak !== right.streak
    || left.xp !== right.xp
    || left.lastActive !== right.lastActive
  ) return false;
  const leftHistory = Object.entries(left.history);
  const rightHistory = Object.entries(right.history);
  if (
    leftHistory.length !== rightHistory.length
    || leftHistory.some(([day, value]) => right.history[day] !== value)
  ) return false;
  const leftPending = left.pendingOperations ?? [];
  const rightPending = right.pendingOperations ?? [];
  return leftPending.length === rightPending.length
    && leftPending.every((operation, index) => {
      const candidate = rightPending[index];
      return candidate?.id === operation.id
        && candidate.delta === operation.delta
        && candidate.day === operation.day;
    });
};

export function useGamificationState({
  ownerId,
  cloudBackoffActive,
  store,
  storage = globalThis.localStorage,
  now = () => new Date(),
  saveDelayMs = 5000,
}: UseGamificationOptions): GamificationState {
  const nowRef = useRef(now);
  nowRef.current = now;
  const activeOwnerRef = useRef(ownerId);
  activeOwnerRef.current = ownerId;
  const scopeKey = ownerId ? `owner:${ownerId}` : 'anonymous';
  const initialSnapshotRef = useRef<StoredGamificationSnapshot | null>(null);
  if (!initialSnapshotRef.current) {
    initialSnapshotRef.current = calculateStoredSnapshot(storage, ownerId, nowRef.current());
  }
  const initialSnapshot = initialSnapshotRef.current;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const snapshotRef = useRef(snapshot);
  const snapshotScopeRef = useRef(scopeKey);
  const scopedSnapshot = snapshotScopeRef.current === scopeKey
    ? snapshot
    : calculateStoredSnapshot(storage, ownerId, nowRef.current());
  snapshotRef.current = scopedSnapshot;
  const { streak, xp, history: xpHistory } = scopedSnapshot;
  const pendingOperationKey = scopedSnapshot.pendingOperations
    ?.map(operation => operation.id)
    .join('\u001f') ?? '';
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const level = useMemo(() => Math.floor(Math.sqrt(xp / 100)) + 1, [xp]);
  const storeController = useMemo(() => store
    ? createGamificationStoreController({ store, activeOwner: () => activeOwnerRef.current })
    : null, [store]);

  const addXp = useCallback((amount: number) => {
    const timestamp = nowRef.current();
    const current = snapshotScopeRef.current === scopeKey
      ? snapshotRef.current
      : calculateStoredSnapshot(storage, ownerId, timestamp);
    const next = addXpToStoredGamification(storage, ownerId, current, amount, timestamp);
    snapshotScopeRef.current = scopeKey;
    snapshotRef.current = next;
    setSnapshot(next);
  }, [ownerId, scopeKey, storage]);

  useEffect(() => {
    let cancelled = false;
    setHydratedScope(null);

    const applySnapshot = (snapshot: StoredGamificationSnapshot) => {
      if (cancelled) return;
      snapshotScopeRef.current = scopeKey;
      snapshotRef.current = snapshot;
      writeGamificationSnapshot(storage, ownerId, snapshot);
      setSnapshot(snapshot);
    };

    const localSnapshot = calculateStoredSnapshot(storage, ownerId, nowRef.current());
    applySnapshot(localSnapshot);
    if (!ownerId || !storeController || cloudBackoffActive) {
      setHydratedScope(scopeKey);
      return () => { cancelled = true; };
    }

    void storeController.load(ownerId, localSnapshot, snapshot => {
      applySnapshot(normalizeLoadedSnapshot(snapshot, nowRef.current()));
    }, () => snapshotRef.current).then(outcome => {
      if (!cancelled && outcome.status === 'loaded') setHydratedScope(scopeKey);
    }).catch(error => {
      console.error('Failed to load gamification state.', error);
      if (!cancelled && activeOwnerRef.current === ownerId) {
        // Local state was already published; keep any XP earned while the read was pending.
        setHydratedScope(scopeKey);
      }
    });
    return () => { cancelled = true; };
  }, [cloudBackoffActive, ownerId, scopeKey, storage, storeController]);

  useEffect(() => {
    if (!ownerId || !storeController || cloudBackoffActive || hydratedScope !== scopeKey) return;
    const ownerToSave = ownerId;
    const controller = storeController;
    let cancelled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    let snapshotToSave: StoredGamificationSnapshot | null = null;

    function scheduleSave(attempt: number, delayMs: number) {
      timeoutId = globalThis.setTimeout(() => {
        void saveSnapshot(attempt);
      }, delayMs);
    }

    async function saveSnapshot(attempt: number) {
      if (
        cancelled
        || activeOwnerRef.current !== ownerToSave
        || snapshotScopeRef.current !== scopeKey
      ) return;
      snapshotToSave ??= {
        ...snapshotRef.current,
        lastActive: nowRef.current().toDateString(),
      };
      try {
        const outcome = await controller.save(ownerToSave, snapshotToSave);
        if (
          cancelled
          || outcome.status !== 'saved'
          || activeOwnerRef.current !== ownerToSave
          || snapshotScopeRef.current !== scopeKey
        ) return;
        const current = snapshotRef.current;
        const acknowledged = acknowledgeStoredGamificationSave(
          storage,
          ownerToSave,
          current,
          outcome.snapshot,
          outcome.appliedOperationIds,
        );
        if (samePublishedGamificationSnapshot(acknowledged, current)) return;
        snapshotRef.current = acknowledged;
        setSnapshot(acknowledged);
      } catch (error) {
        if (
          cancelled
          || activeOwnerRef.current !== ownerToSave
          || snapshotScopeRef.current !== scopeKey
        ) return;
        const nextAttempt = attempt + 1;
        if (nextAttempt < MAX_GAMIFICATION_SAVE_ATTEMPTS) {
          scheduleSave(
            nextAttempt,
            Math.min(
              MAX_GAMIFICATION_SAVE_RETRY_DELAY_MS,
              Math.max(1, saveDelayMs * (2 ** nextAttempt)),
            ),
          );
          return;
        }
        console.warn('Gamification sync is queued for the next session.', error);
      }
    }

    scheduleSave(0, saveDelayMs);
    return () => {
      cancelled = true;
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    };
  }, [
    cloudBackoffActive,
    hydratedScope,
    ownerId,
    pendingOperationKey,
    saveDelayMs,
    scopeKey,
    storage,
    storeController,
    streak,
    xp,
    xpHistory,
  ]);

  return { streak, xp, xpHistory, level, addXp };
}

export interface GamificationIdentity {
  uid: string;
}

export const createGamificationCompatibilityHook = (store: GamificationStore | null) =>
  (identity: GamificationIdentity | null, cloudBackoffActive: boolean) => useGamificationState({
    ownerId: identity?.uid ?? null,
    cloudBackoffActive,
    store,
  });

/** Compatibility boundary for the current App composition root. */
export const useGamification = createGamificationCompatibilityHook(firebaseGamificationStore);

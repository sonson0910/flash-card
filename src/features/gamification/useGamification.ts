import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addXpToHistory, calculateLocalGamification } from './gamificationModel';
import {
  gamificationStorageKeys,
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

const calculateStoredSnapshot = (
  storage: GamificationStorage,
  ownerId: string | null,
  now: Date,
): StoredGamificationSnapshot => {
  const stored = readGamificationSnapshot(storage, ownerId);
  const calculated = calculateLocalGamification(stored, now);
  return { ...calculated, history: stored.history };
};

const normalizeLoadedSnapshot = (
  snapshot: StoredGamificationSnapshot,
  now: Date,
): StoredGamificationSnapshot => ({
  ...calculateLocalGamification(snapshot, now),
  history: snapshot.history,
});

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
  const [streak, setStreak] = useState(initialSnapshot.streak);
  const [xp, setXp] = useState(initialSnapshot.xp);
  const [xpHistory, setXpHistory] = useState<Record<string, number>>(initialSnapshot.history);
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const level = useMemo(() => Math.floor(Math.sqrt(xp / 100)) + 1, [xp]);
  const storeController = useMemo(() => store
    ? createGamificationStoreController({ store, activeOwner: () => activeOwnerRef.current })
    : null, [store]);

  const addXp = useCallback((amount: number) => {
    const timestamp = nowRef.current();
    const keys = gamificationStorageKeys(ownerId);
    setXp(previous => {
      const next = Math.max(0, previous + amount);
      storage.setItem(keys.xp, String(next));
      storage.setItem(keys.lastActive, timestamp.toDateString());
      return next;
    });
    const day = timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    setXpHistory(previous => {
      const next = addXpToHistory(previous, day, amount);
      storage.setItem(keys.history, JSON.stringify(next));
      return next;
    });
  }, [ownerId, storage]);

  useEffect(() => {
    let cancelled = false;
    setHydratedScope(null);

    const applySnapshot = (snapshot: StoredGamificationSnapshot) => {
      if (cancelled) return;
      writeGamificationSnapshot(storage, ownerId, snapshot);
      setStreak(snapshot.streak);
      setXp(snapshot.xp);
      setXpHistory(snapshot.history);
    };

    const localSnapshot = calculateStoredSnapshot(storage, ownerId, nowRef.current());
    applySnapshot(localSnapshot);
    if (!ownerId || !storeController || cloudBackoffActive) {
      setHydratedScope(scopeKey);
      return () => { cancelled = true; };
    }

    void storeController.load(ownerId, localSnapshot, snapshot => {
      applySnapshot(normalizeLoadedSnapshot(snapshot, nowRef.current()));
    }).then(outcome => {
      if (!cancelled && outcome.status === 'loaded') setHydratedScope(scopeKey);
    }).catch(error => {
      console.error('Failed to load gamification state.', error);
      if (!cancelled && activeOwnerRef.current === ownerId) {
        applySnapshot(localSnapshot);
        setHydratedScope(scopeKey);
      }
    });
    return () => { cancelled = true; };
  }, [cloudBackoffActive, ownerId, scopeKey, storage, storeController]);

  useEffect(() => {
    if (!ownerId || !storeController || cloudBackoffActive || hydratedScope !== scopeKey) return;
    const timeoutId = globalThis.setTimeout(() => {
      void storeController.save(ownerId, {
        streak,
        lastActive: nowRef.current().toDateString(),
        xp,
        history: xpHistory,
      }).catch(error => console.warn('Gamification sync is queued for the next session.', error));
    }, saveDelayMs);
    return () => globalThis.clearTimeout(timeoutId);
  }, [cloudBackoffActive, hydratedScope, ownerId, saveDelayMs, scopeKey, storeController, streak, xp, xpHistory]);

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

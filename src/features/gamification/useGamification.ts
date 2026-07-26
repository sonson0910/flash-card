import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import { addXpToHistory, calculateLocalGamification } from './gamificationModel';
import {
  gamificationStorageKeys,
  readGamificationSnapshot,
  writeGamificationSnapshot,
  type StoredGamificationSnapshot,
} from './gamificationStorage';

const calculateStoredSnapshot = (userId: string | null): StoredGamificationSnapshot => {
  const stored = readGamificationSnapshot(localStorage, userId);
  const calculated = calculateLocalGamification(stored);
  return { ...calculated, history: stored.history };
};

export function useGamification(user: User | null, cloudBackoffActive: boolean) {
  const userId = user?.uid ?? null;
  const scopeKey = userId ? `user:${userId}` : 'anonymous';
  const initialSnapshot = useMemo(() => calculateStoredSnapshot(userId), []);
  const [streak, setStreak] = useState(initialSnapshot.streak);
  const [xp, setXp] = useState(initialSnapshot.xp);
  const [xpHistory, setXpHistory] = useState<Record<string, number>>(initialSnapshot.history);
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const level = useMemo(() => Math.floor(Math.sqrt(xp / 100)) + 1, [xp]);

  const addXp = useCallback((amount: number) => {
    const keys = gamificationStorageKeys(userId);
    setXp(previous => {
      const next = Math.max(0, previous + amount);
      localStorage.setItem(keys.xp, String(next));
      localStorage.setItem(keys.lastActive, new Date().toDateString());
      return next;
    });
    const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    setXpHistory(previous => {
      const next = addXpToHistory(previous, day, amount);
      localStorage.setItem(keys.history, JSON.stringify(next));
      return next;
    });
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    setHydratedScope(null);

    const applySnapshot = (snapshot: StoredGamificationSnapshot) => {
      if (cancelled) return;
      writeGamificationSnapshot(localStorage, userId, snapshot);
      setStreak(snapshot.streak);
      setXp(snapshot.xp);
      setXpHistory(snapshot.history);
    };

    const localSnapshot = calculateStoredSnapshot(userId);
    applySnapshot(localSnapshot);

    if (!isFirebaseConfigured || !db || !user || cloudBackoffActive) {
      setHydratedScope(scopeKey);
      return () => { cancelled = true; };
    }

    const database = db;
    const statsRef = doc(database, 'users', user.uid, 'profile', 'stats');
    const historyRef = doc(database, 'users', user.uid, 'profile', 'xp_history');
    void Promise.all([getDoc(statsRef), getDoc(historyRef)]).then(async ([statsSnapshot, historySnapshot]) => {
      if (cancelled) return;
      let stats = localSnapshot;
      if (statsSnapshot.exists()) {
        const source = statsSnapshot.data();
        stats = {
          ...calculateLocalGamification({
            streak: Number(source.streak) || 0,
            xp: Number(source.xp) || 0,
            lastActive: typeof source.lastActive === 'string' ? source.lastActive : null,
          }),
          history: localSnapshot.history,
        };
      } else {
        await setDoc(statsRef, {
          streak: localSnapshot.streak,
          xp: localSnapshot.xp,
          lastActive: localSnapshot.lastActive,
        }, { merge: true });
      }

      let history = localSnapshot.history;
      if (historySnapshot.exists()) {
        history = Object.fromEntries(
          Object.entries(historySnapshot.data()).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
        );
      } else if (Object.keys(history).length > 0) {
        await setDoc(historyRef, history);
      }
      if (cancelled) return;
      applySnapshot({ ...stats, history });
      setHydratedScope(scopeKey);
    }).catch(error => {
      console.error('Failed to load gamification state.', error);
      if (!cancelled) {
        applySnapshot(localSnapshot);
        setHydratedScope(scopeKey);
      }
    });
    return () => { cancelled = true; };
  }, [userId, scopeKey, cloudBackoffActive]);

  useEffect(() => {
    if (!db || !user || !isFirebaseConfigured || cloudBackoffActive || hydratedScope !== scopeKey) return;
    const database = db;
    const currentUser = user;
    const timeoutId = window.setTimeout(() => {
      void Promise.all([
        setDoc(doc(database, 'users', currentUser.uid, 'profile', 'stats'), {
          streak,
          lastActive: new Date().toDateString(),
          xp,
        }, { merge: true }),
        setDoc(doc(database, 'users', currentUser.uid, 'profile', 'xp_history'), xpHistory, { merge: true }),
      ]).catch(error => console.warn('Gamification sync is queued for the next session.', error));
    }, 5000);
    return () => window.clearTimeout(timeoutId);
  }, [user, scopeKey, hydratedScope, cloudBackoffActive, streak, xp, xpHistory]);

  return { streak, xp, xpHistory, level, addXp };
}

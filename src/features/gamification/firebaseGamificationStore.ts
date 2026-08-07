import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import type { GamificationStore } from './gamificationStore';

export const firebaseGamificationStore: GamificationStore | null = isFirebaseConfigured && db
  ? {
      async load(ownerId, localFallback) {
        if (!db) return localFallback;
        const statsRef = doc(db, 'users', ownerId, 'profile', 'stats');
        const historyRef = doc(db, 'users', ownerId, 'profile', 'xp_history');
        const [statsSnapshot, historySnapshot] = await Promise.all([
          getDoc(statsRef),
          getDoc(historyRef),
        ]);

        let stats = {
          streak: localFallback.streak,
          xp: localFallback.xp,
          lastActive: localFallback.lastActive,
        };
        if (statsSnapshot.exists()) {
          const source = statsSnapshot.data();
          stats = {
            streak: Number(source.streak) || 0,
            xp: Number(source.xp) || 0,
            lastActive: typeof source.lastActive === 'string' ? source.lastActive : null,
          };
        } else {
          await setDoc(statsRef, stats, { merge: true });
        }

        let history = localFallback.history;
        if (historySnapshot.exists()) {
          history = Object.fromEntries(
            Object.entries(historySnapshot.data()).filter(
              (entry): entry is [string, number] => Number.isFinite(entry[1]),
            ),
          );
        } else if (Object.keys(history).length > 0) {
          await setDoc(historyRef, history);
        }
        return { ...stats, history };
      },

      async save(ownerId, snapshot) {
        if (!db) return;
        await Promise.all([
          setDoc(doc(db, 'users', ownerId, 'profile', 'stats'), {
            streak: snapshot.streak,
            lastActive: snapshot.lastActive,
            xp: snapshot.xp,
          }, { merge: true }),
          setDoc(doc(db, 'users', ownerId, 'profile', 'xp_history'), snapshot.history, { merge: true }),
        ]);
      },
    }
  : null;

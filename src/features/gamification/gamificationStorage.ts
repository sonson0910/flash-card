export interface GamificationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredGamificationSnapshot {
  streak: number;
  xp: number;
  lastActive: string | null;
  history: Record<string, number>;
}

const scopeSegment = (userId: string | null) => userId ? `user:${userId}` : 'anonymous';

export const gamificationStorageKeys = (userId: string | null) => {
  const prefix = `lingoflash_gamification:${scopeSegment(userId)}`;
  return {
    streak: `${prefix}:streak`,
    xp: `${prefix}:xp`,
    lastActive: `${prefix}:last_active`,
    history: `${prefix}:xp_history`,
  };
};

const readNumber = (storage: GamificationStorage, key: string) => {
  const value = Number(storage.getItem(key) ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const readHistory = (storage: GamificationStorage, key: string): Record<string, number> => {
  try {
    const value = JSON.parse(storage.getItem(key) ?? '{}') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
    );
  } catch {
    return {};
  }
};

export const readGamificationSnapshot = (
  storage: GamificationStorage,
  userId: string | null,
): StoredGamificationSnapshot => {
  const keys = gamificationStorageKeys(userId);
  return {
    streak: readNumber(storage, keys.streak),
    xp: readNumber(storage, keys.xp),
    lastActive: storage.getItem(keys.lastActive),
    history: readHistory(storage, keys.history),
  };
};

export const writeGamificationSnapshot = (
  storage: GamificationStorage,
  userId: string | null,
  snapshot: StoredGamificationSnapshot,
) => {
  const keys = gamificationStorageKeys(userId);
  storage.setItem(keys.streak, String(snapshot.streak));
  storage.setItem(keys.xp, String(snapshot.xp));
  storage.setItem(keys.lastActive, snapshot.lastActive ?? '');
  storage.setItem(keys.history, JSON.stringify(snapshot.history));
};

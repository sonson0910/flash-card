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

const readValue = (storage: GamificationStorage, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const writeValue = (storage: GamificationStorage, key: string, value: string) => {
  try {
    storage.setItem(key, value);
  } catch {
    // State remains available in React memory when browser storage is denied or full.
  }
};

const readNumber = (storage: GamificationStorage, key: string) => {
  const value = Number(readValue(storage, key) ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const readHistory = (storage: GamificationStorage, key: string): Record<string, number> => {
  try {
    const value = JSON.parse(readValue(storage, key) ?? '{}') as unknown;
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
    lastActive: readValue(storage, keys.lastActive),
    history: readHistory(storage, keys.history),
  };
};

export const writeGamificationSnapshot = (
  storage: GamificationStorage,
  userId: string | null,
  snapshot: StoredGamificationSnapshot,
) => {
  const keys = gamificationStorageKeys(userId);
  writeValue(storage, keys.streak, String(snapshot.streak));
  writeValue(storage, keys.xp, String(snapshot.xp));
  writeValue(storage, keys.lastActive, snapshot.lastActive ?? '');
  writeValue(storage, keys.history, JSON.stringify(snapshot.history));
};

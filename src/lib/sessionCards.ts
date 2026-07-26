export function selectCardsVisibleForSession<T>(
  cards: T[],
  ownerUserId: string | null,
  currentUserId: string | null,
): T[] {
  if (currentUserId === null) return ownerUserId === null ? cards : [];
  return ownerUserId === currentUserId ? cards : [];
}

export function canUseDeviceBackupForSession(backupUserId: string | null, currentUserId: string | null): boolean {
  return backupUserId === currentUserId;
}

export function retainCardsForSession<T>(cards: T[], signedIn: boolean, pageSize: number): T[] {
  return signedIn ? cards.slice(0, Math.max(0, pageSize)) : cards;
}

export interface SignedInCardSessionPlan<T> {
  visibleCards: T[];
  cardsToMigrate: T[];
  discardLocalCache: boolean;
}

export function planCardsForSignedInSession<T>(
  cards: T[],
  ownerUserId: string | null,
  currentUserId: string,
): SignedInCardSessionPlan<T> {
  if (ownerUserId === currentUserId) {
    return { visibleCards: cards, cardsToMigrate: [], discardLocalCache: false };
  }
  if (ownerUserId === null) {
    return { visibleCards: cards, cardsToMigrate: cards, discardLocalCache: false };
  }
  return { visibleCards: [], cardsToMigrate: [], discardLocalCache: true };
}

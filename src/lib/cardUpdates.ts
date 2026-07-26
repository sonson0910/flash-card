import type { CardData } from '../types/card';

export function isActiveUserSession(expectedUserId: string, activeUserId: string | null): boolean {
  return expectedUserId === activeUserId;
}

export function resolveCardUpdateSource(
  cardId: string,
  explicitSource: CardData | undefined,
  visibleCards: readonly CardData[],
  studyCards: readonly CardData[],
): CardData | null {
  return visibleCards.find(card => card.id === cardId)
    ?? studyCards.find(card => card.id === cardId)
    ?? (explicitSource?.id === cardId ? explicitSource : null)
    ?? null;
}

export function isCardUpdateLifecycleCurrent(
  expectedLifecycleVersion: string | number | undefined,
  currentLifecycleVersion: string | number,
): boolean {
  return expectedLifecycleVersion === undefined || expectedLifecycleVersion === currentLifecycleVersion;
}

export function isMissingFirestoreDocumentError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return code === 'not-found' || code === 'firestore/not-found';
}

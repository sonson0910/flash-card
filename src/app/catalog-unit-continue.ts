import { cardLogicalKey, cardWordKey, effectiveCardTargetLanguage } from '../lib/cardIdentity';
import type { CardData } from '../types/card';
import type { ConfirmedCatalogCardsResult } from '../features/intake/cardIntakeController';

export interface CatalogUnitScope {
  readonly ownerId: string | null;
  readonly libraryEpoch: number | null;
  readonly targetLanguage: string;
}

export interface CatalogUnitContinuePorts {
  readCards(lexemeIds: readonly string[], scope: CatalogUnitScope): Promise<Map<string, CardData>>;
  /** Plain English cards (no lexeme id) the learner already holds, keyed by their normalized word. */
  readPlainEnglishCards(words: readonly string[], scope: CatalogUnitScope): Promise<Map<string, CardData>>;
  createMissing(cards: readonly CardData[]): Promise<ConfirmedCatalogCardsResult>;
  startStudy(cards: readonly CardData[], isCurrent: () => boolean): Promise<boolean>;
  isCurrent(scope: CatalogUnitScope): boolean;
}

export type CatalogUnitContinueOutcome = 'started' | 'stale' | 'partial' | 'unavailable';

export async function continueCatalogUnitCards(
  candidates: readonly CardData[],
  scope: CatalogUnitScope,
  ports: CatalogUnitContinuePorts,
): Promise<CatalogUnitContinueOutcome> {
  const lexemeIds = candidates.map(card => card.lexemeId);
  if (!scope.ownerId || scope.libraryEpoch === null || !Number.isSafeInteger(scope.libraryEpoch)
    || scope.libraryEpoch < 0 || candidates.length < 1 || candidates.length > 20
    || lexemeIds.some(id => !id || id !== id.trim())
    || new Set(lexemeIds).size !== candidates.length
    || candidates.some(card => cardLogicalKey(card) !== `lexeme:${card.lexemeId}`
      || effectiveCardTargetLanguage(card) !== scope.targetLanguage)) return 'unavailable';
  if (!ports.isCurrent(scope)) return 'stale';

  try {
    const existing = await ports.readCards(lexemeIds as string[], scope);
    if (!ports.isCurrent(scope)) return 'stale';
    // A plain English card already stands for its catalog word, so study it rather than add a second card.
    const absent = candidates.filter(card => !existing.has(card.lexemeId!) && effectiveCardTargetLanguage(card) === 'en');
    if (absent.length > 0) {
      const plain = await ports.readPlainEnglishCards(absent.map(cardWordKey), scope);
      if (!ports.isCurrent(scope)) return 'stale';
      for (const card of absent) {
        const held = plain.get(cardWordKey(card));
        if (held && !held.lexemeId) existing.set(card.lexemeId!, held);
      }
    }
    const missing = candidates.filter(card => !existing.has(card.lexemeId!));
    if (missing.length > 0) {
      const created = await ports.createMissing(missing);
      if (!ports.isCurrent(scope) || created.status === 'stale') return 'stale';
      if (created.status !== 'completed' || created.cards.length !== missing.length) return 'partial';
      for (const card of created.cards) {
        if (!card.lexemeId || !lexemeIds.includes(card.lexemeId)
          || card.libraryEpoch !== scope.libraryEpoch
          || effectiveCardTargetLanguage(card) !== scope.targetLanguage) return 'partial';
        existing.set(card.lexemeId, card);
      }
    }
    const ordered = lexemeIds.map(id => existing.get(id!));
    if (ordered.some(card => !card) || !ports.isCurrent(scope)) return 'stale';
    const started = await ports.startStudy(ordered as CardData[], () => ports.isCurrent(scope));
    return started && ports.isCurrent(scope) ? 'started' : 'stale';
  } catch {
    return ports.isCurrent(scope) ? 'partial' : 'stale';
  }
}

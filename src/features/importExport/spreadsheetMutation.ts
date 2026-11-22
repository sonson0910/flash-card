import { createTargetAwareCardId, createWordCardId } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';
import { isReservedCustomDeckName, normalizeCustomDeckName } from '../library/customDecks';
import type { StructuredCardRow } from './spreadsheetModel';

export type SortableCardData = CardData & {
  lastOpenedAt?: string;
};

export interface StructuredImportOptions {
  /** The learner's deck names. A Deck cell naming any other deck imports the card as Unassigned. */
  deckNames?: readonly string[];
}

export type StructuredImportMutation =
  | {
      kind: 'create';
      card: SortableCardData;
      /** The row named a deck the learner does not have, so the new card is Unassigned. */
      deckUnassigned: boolean;
    }
  | {
      kind: 'patch';
      card: SortableCardData;
      fields: Pick<SortableCardData, 'lastOpenedAt' | 'partOfSpeech'>;
    };

/**
 * The deck a new card joins: the named deck when it is one of the learner's
 * decks, otherwise Unassigned. A blank cell or the reserved "Unassigned" name
 * is a deliberate Unassigned and is not reported as unknown.
 */
export const resolveImportedDeck = (
  requested: string | undefined,
  deckNames: readonly string[] = [],
): { customDeck: string | null; unknown: boolean } => {
  const name = normalizeCustomDeckName(requested ?? '');
  if (!name || isReservedCustomDeckName(name)) return { customDeck: null, unknown: false };
  return deckNames.includes(name) ? { customDeck: name, unknown: false } : { customDeck: null, unknown: true };
};

export function planStructuredImportMutation(
  imported: StructuredCardRow,
  existingCard: CardData | null,
  touchedAt = new Date().toISOString(),
  options: StructuredImportOptions = {},
): StructuredImportMutation {
  if (existingCard) {
    // A word already in the library keeps its deck, tags, star and difficulty.
    const fields = {
      lastOpenedAt: touchedAt,
      partOfSpeech: imported.partOfSpeech || existingCard.partOfSpeech,
    };
    return {
      kind: 'patch',
      card: { ...existingCard, ...fields },
      fields,
    };
  }

  const { deck, ...cardFields } = imported;
  const resolvedDeck = resolveImportedDeck(deck, options.deckNames);
  const card: SortableCardData = {
    id: imported.lexemeId || (imported.language
      ? createTargetAwareCardId(imported.word, imported.language)
      : createWordCardId(imported.word)),
    ...cardFields,
    origin: 'manual',
    normalizedWord: imported.word,
    createdAt: touchedAt,
    lastOpenedAt: touchedAt,
    customDeck: resolvedDeck.customDeck,
    difficulty: 'unrated',
    bookmarked: imported.bookmarked === true,
  };
  return { kind: 'create', card, deckUnassigned: resolvedDeck.unknown };
}

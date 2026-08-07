import { createWordCardId } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';
import type { StructuredCardRow } from './spreadsheetModel';

export type SortableCardData = CardData & {
  lastOpenedAt?: string;
};

export type StructuredImportMutation =
  | {
      kind: 'create';
      card: SortableCardData;
    }
  | {
      kind: 'patch';
      card: SortableCardData;
      fields: Pick<SortableCardData, 'lastOpenedAt' | 'partOfSpeech'>;
    };

export function planStructuredImportMutation(
  imported: StructuredCardRow,
  existingCard: CardData | null,
  touchedAt = new Date().toISOString(),
): StructuredImportMutation {
  if (existingCard) {
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

  const card: SortableCardData = {
    id: createWordCardId(imported.word),
    ...imported,
    normalizedWord: imported.word,
    createdAt: touchedAt,
    lastOpenedAt: touchedAt,
    customDeck: null,
    difficulty: 'unrated',
    bookmarked: false,
  };
  return { kind: 'create', card };
}

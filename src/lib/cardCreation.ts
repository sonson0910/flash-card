import type { CardData } from '../types/card';
import { selectMutableCardPatch } from './cardMutationProtocol';

export function applySuccessfulPatchMetadata(
  card: CardData,
  fields: Partial<CardData>,
  metadata: {
    revision: number;
    libraryEpoch: number;
    updatedAt: string;
  },
  fieldMask: readonly (keyof CardData)[] = Object.keys(fields) as Array<keyof CardData>,
): CardData {
  const patch = selectMutableCardPatch(fields, fieldMask);
  return {
    ...card,
    ...patch,
    schemaVersion: 2,
    revision: metadata.revision,
    libraryEpoch: metadata.libraryEpoch,
    updatedAt: metadata.updatedAt,
    id: card.id,
  };
}

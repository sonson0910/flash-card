import {
  applyCategoryDeltas,
  CardHeadwordRenameError,
  deriveLibraryFacetOperationId,
  renameCardHeadword,
} from '../../lib/cardRepository';
import { auth, db, isFirebaseConfigured } from '../../lib/firebase';
import type { CardData } from '../../types/card';
import { buildCategoryFacetDelta } from './editCardModel';

export { CardHeadwordRenameError };

export const cardEditCloudAvailable = isFirebaseConfigured;

export class CardEditSignedOutError extends Error {
  constructor() {
    super('Card edit needs a signed-in account.');
    this.name = 'CardEditSignedOutError';
  }
}

export async function renameOwnCardHeadword(card: CardData, word: string): Promise<CardData> {
  const uid = auth?.currentUser?.uid;
  if (!uid) throw new CardEditSignedOutError();
  return renameCardHeadword(uid, card.id, word, card.revision ?? 0, card.libraryEpoch ?? 0);
}

// The category->count mirror is a display aid, so a failed update is logged and
// never surfaces to the learner; it matches the delete path's fire-and-forget.
export function mirrorCardCategoryEdit(card: CardData, nextCategory: string): void {
  const delta = buildCategoryFacetDelta(card.category, nextCategory);
  const uid = auth?.currentUser?.uid;
  if (!delta || !uid || !db || !isFirebaseConfigured) return;
  void applyCategoryDeltas(
    db,
    uid,
    delta,
    deriveLibraryFacetOperationId(`card-edit:${card.id}:${card.revision ?? 0}`, 'category-edit'),
  ).catch(facetError => {
    console.error('Category facets mirror could not be updated after a card edit.', facetError);
  });
}

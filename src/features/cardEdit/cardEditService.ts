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

// `ownerId` is the account the editor was opened for, not whoever is signed in now: the
// repository refuses to run the rename when another account has signed in since.
export async function renameOwnCardHeadword(card: CardData, word: string, ownerId: string | null): Promise<CardData> {
  if (!ownerId) throw new CardEditSignedOutError();
  return renameCardHeadword(ownerId, card.id, word, card.revision ?? 0, card.libraryEpoch ?? 0);
}

/** The signed-in account a card edit is made for, read when the edit starts. */
export const cardEditOwnerId = (): string | null => auth?.currentUser?.uid ?? null;

// The category->count mirror is a display aid, so a failed update is logged and
// never surfaces to the learner; it matches the delete path's fire-and-forget.
// `ownerId` is the account the edit was saved for: when another account is signed in
// by the time the save is confirmed, the counts of that account are left alone.
export function mirrorCardCategoryEdit(card: CardData, nextCategory: string, ownerId: string | null): void {
  const delta = buildCategoryFacetDelta(card.category, nextCategory);
  const uid = auth?.currentUser?.uid;
  if (!delta || !uid || uid !== ownerId || !db || !isFirebaseConfigured) return;
  void applyCategoryDeltas(
    db,
    uid,
    delta,
    deriveLibraryFacetOperationId(`card-edit:${card.id}:${card.revision ?? 0}`, 'category-edit'),
    undefined,
    card.libraryEpoch,
  ).catch(facetError => {
    console.error('Category facets mirror could not be updated after a card edit.', facetError);
  });
}

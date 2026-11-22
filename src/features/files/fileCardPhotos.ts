import { ownStorageImageFileId } from '../../lib/mediaUrlPolicy';

/**
 * Cards that show a stored file as their photo. Deleting such a file takes the photo off those
 * cards first, so no card is left pointing at a file that is gone; the confirmation says how many.
 */
export interface FileCardPhotos {
  /** How many of the learner's loaded cards show this file. */
  count(fileId: string): number;
  /** Removes the photo from those cards; rejects when a card could not be saved. */
  clear(fileId: string): Promise<void>;
}

/**
 * Finds the cards among those already loaded, so counting reads nothing; clearing saves each
 * card once. `removePhoto` resolves false when the card could not be saved.
 */
export const createFileCardPhotos = (
  cards: readonly { readonly id: string; readonly imageUrl?: string | null }[],
  removePhoto: (cardId: string) => Promise<boolean>,
): FileCardPhotos => {
  const showing = (fileId: string) => cards.filter(card => ownStorageImageFileId(card.imageUrl) === fileId);
  return {
    count: fileId => showing(fileId).length,
    clear: async fileId => {
      for (const card of showing(fileId)) {
        if (!await removePhoto(card.id)) throw new Error('The photo could not be removed from a card.');
      }
    },
  };
};

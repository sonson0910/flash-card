/**
 * Cards that show a stored file as their photo. Deleting such a file takes the photo off those
 * cards first, so no card is left pointing at a file that is gone; the confirmation says how many.
 */
export interface FileCardPhotos {
  /** Looks up the learner's cards, in every course, that show this file as their photo. */
  find(fileId: string): Promise<FileCardPhotoMatch>;
}

/** The cards one lookup found. */
export interface FileCardPhotoMatch {
  readonly count: number;
  /** Removes the photo from exactly the cards found; rejects when one could not be saved. */
  clear(): Promise<void>;
}

/** A card the lookup found, at the revision it was read. */
export interface FileCardPhotoCard {
  readonly id: string;
  readonly revision: number;
}

/** Where the cards are read and saved; `firestoreCardPhotoStore` is the app's. */
export interface FileCardPhotoStore {
  /** The owner's cards whose photo is this file, in any course. */
  find(fileId: string): Promise<readonly FileCardPhotoCard[]>;
  /** Removes this file's photo from cards the open library does not hold; resolves false when a card could not be saved. */
  clear(fileId: string, cards: readonly FileCardPhotoCard[]): Promise<boolean>;
}

/** The open course's library: its cards are saved through it, so what it shows stays current. */
export interface LoadedCardPhotos {
  has(cardId: string): boolean;
  /** Resolves false when the card could not be saved. */
  removePhoto(cardId: string): Promise<boolean>;
}

const saveFailed = () => new Error('The photo could not be removed from a card.');

/**
 * Finds the cards with one store lookup and clears exactly those: the ones the open library holds
 * through the library, one at a time, and the rest through the store.
 */
export const createFileCardPhotos = (store: FileCardPhotoStore, loaded: LoadedCardPhotos): FileCardPhotos => ({
  find: async fileId => {
    const cards = await store.find(fileId);
    return {
      count: cards.length,
      clear: async () => {
        const held = cards.filter(card => loaded.has(card.id));
        const others = cards.filter(card => !loaded.has(card.id));
        for (const card of held) {
          if (!await loaded.removePhoto(card.id)) throw saveFailed();
        }
        if (others.length > 0 && !await store.clear(fileId, others)) throw saveFailed();
      },
    };
  },
});

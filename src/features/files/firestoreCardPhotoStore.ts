import { and, collection, doc, getDoc, getDocs, or, query, where, type Firestore } from 'firebase/firestore';
import { applyCardPatchIfCurrent, getLibraryEpoch } from '../../lib/cardRepository';
import { cloudPageCacheKey, removeLocalValue } from '../library/libraryStorage';
import { OWN_STORAGE_BUCKETS, ownStorageImageFileId } from '../../lib/mediaUrlPolicy';
import type { CardData } from '../../types/card';
import type { FileCardPhotoCard, FileCardPhotoStore } from './fileCardPhotos';

const STORAGE_DOWNLOAD_ORIGIN = 'https://firebasestorage.googleapis.com';
// Download tokens use letters, digits and hyphens, which all sort below this character.
const PREFIX_END = '\uf8ff';
const PHOTO_REMOVED: Partial<CardData> = { imageUrl: null, imageSearchQuery: '' };
const PHOTO_FIELDS: readonly (keyof CardData)[] = ['imageUrl', 'imageSearchQuery'];
const PATCH_ATTEMPTS = 3;

const revisionOf = (value: unknown): number => (Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0);

/**
 * The start of each download URL a card photo of this file can have, one per project bucket, up to
 * the download token. A card keeps the token it was given, so the lookup matches on this prefix.
 */
export const fileDownloadUrlPrefixes = (ownerId: string, fileId: string): string[] => [...OWN_STORAGE_BUCKETS].map(bucket => (
  `${STORAGE_DOWNLOAD_ORIGIN}/v0/b/${bucket}/o/${encodeURIComponent(`users/${ownerId}/files/${fileId}`)}?alt=media&token=`
));

/**
 * Card photos in Firestore. `find` is one range query over `users/{uid}/cards` on `imageUrl`.
 * A Standard database answers it from its single-field index on the field: a read per card found,
 * and one read when none is. An Enterprise database has no such index and scans the owner's
 * cards, billed by the bytes it reads. `clear` reads the library epoch once,
 * then saves each card with the same transaction a card edit uses (the library state and the card
 * read, the card written), re-reading a card that changed since the lookup.
 */
export const firestoreCardPhotoStore = (db: Firestore, ownerId: string): FileCardPhotoStore => {
  const removePhoto = async (fileId: string, card: FileCardPhotoCard, libraryEpoch: number): Promise<boolean> => {
    let baseRevision = card.revision;
    for (let attempt = 0; attempt < PATCH_ATTEMPTS; attempt += 1) {
      const result = await applyCardPatchIfCurrent(db, ownerId, {
        cardId: card.id, fields: PHOTO_REMOVED, fieldMask: PHOTO_FIELDS, baseRevision, libraryEpoch,
      });
      if (result.applied || result.reason === 'missing') return true;
      if (result.reason !== 'revision-conflict') return false;
      const current = await getDoc(doc(db, 'users', ownerId, 'cards', card.id));
      if (!current.exists() || ownStorageImageFileId(current.get('imageUrl')) !== fileId) return true;
      baseRevision = revisionOf(current.get('revision'));
    }
    return false;
  };

  return {
    async find(fileId) {
      const ranges = fileDownloadUrlPrefixes(ownerId, fileId)
        .map(prefix => and(where('imageUrl', '>=', prefix), where('imageUrl', '<', `${prefix}${PREFIX_END}`)));
      if (ranges.length === 0) return [];
      const cards = collection(db, 'users', ownerId, 'cards');
      const snapshot = await getDocs(query(cards, ranges.length === 1 ? ranges[0]! : or(...ranges)));
      return snapshot.docs
        .filter(card => ownStorageImageFileId(card.get('imageUrl')) === fileId)
        .map(card => ({ id: card.id, revision: revisionOf(card.get('revision')) }));
    },
    async clear(fileId, cards) {
      const libraryEpoch = await getLibraryEpoch(db, ownerId);
      try {
        for (const card of cards) {
          if (!await removePhoto(fileId, card, libraryEpoch)) return false;
        }
        return true;
      } finally {
        // These cards are saved straight in Firestore, so the cached library page, which can still hold
        // one of them with the old photo, is dropped and read again from the cloud.
        removeLocalValue(cloudPageCacheKey(ownerId));
      }
    },
  };
};

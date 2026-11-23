import { ownStorageImageFileId } from '../../lib/mediaUrlPolicy';
import type { CardData } from '../../types/card';

/**
 * Card saves in this tab that are putting an uploaded photo on a card, per file. The cloud lookup
 * of a photo's cards cannot see a save that has not landed yet, so deleting the file waits for
 * them first; otherwise the save could land after the delete and leave the card showing a file
 * that is gone. Only this tab's saves are known here: a save from another tab or device that lands
 * after the delete's last lookup is not seen.
 */
const savesByFile = new Map<string, Set<Promise<unknown>>>();

/** Returns the save unchanged; while it runs, a delete of the photo file it puts on a card waits for it. */
export const trackCardPhotoSave = <T>(imageUrl: unknown, save: Promise<T>): Promise<T> => {
  const fileId = typeof imageUrl === 'string' ? ownStorageImageFileId(imageUrl) : null;
  if (!fileId) return save;
  const saves = savesByFile.get(fileId) ?? new Set<Promise<unknown>>();
  savesByFile.set(fileId, saves);
  saves.add(save);
  const settle = () => {
    saves.delete(save);
    if (saves.size === 0 && savesByFile.get(fileId) === saves) savesByFile.delete(fileId);
  };
  save.then(settle, settle);
  return save;
};

/** Resolves once no card save in this tab is still putting this file's photo on a card, whether it landed or failed. */
export const cardPhotoSavesSettled = async (fileId: string): Promise<void> => {
  for (let saves = savesByFile.get(fileId); saves && saves.size > 0; saves = savesByFile.get(fileId)) {
    await Promise.allSettled([...saves]);
  }
};

/** Files whose photo this tab has started taking off every card, before deleting the file. */
const photosTakenOff = new Set<string>();

/** From now on a card put back in this tab (an undo of its delete) comes back without this file's photo. */
export const takeCardPhotoOff = (fileId: string): void => {
  photosTakenOff.add(fileId);
};

/** The card to put back: without its photo when that photo's file is being or has been deleted in this tab. */
export const withoutTakenOffPhoto = (card: CardData): CardData => {
  const fileId = ownStorageImageFileId(card.imageUrl);
  return fileId && photosTakenOff.has(fileId) ? { ...card, imageUrl: null, imageSearchQuery: '' } : card;
};

import { describe, expect, it, vi } from 'vitest';
import { createFileCardPhotos, type FileCardPhotoCard, type FileCardPhotoStore, type LoadedCardPhotos } from './fileCardPhotos';

const fileA = 'a'.repeat(24);
const found: readonly FileCardPhotoCard[] = [
  { id: 'card-open-1', revision: 3 },
  { id: 'card-other-course', revision: 7 },
  { id: 'card-open-2', revision: 1 },
];

const storeWith = (cards: readonly FileCardPhotoCard[], saved = true) => ({
  find: vi.fn(async (_fileId: string) => cards),
  clear: vi.fn(async (_fileId: string, _cards: readonly FileCardPhotoCard[]) => saved),
}) satisfies FileCardPhotoStore;

const openLibrary = (saved: (cardId: string) => boolean = () => true) => ({
  has: (cardId: string) => cardId.startsWith('card-open'),
  removePhoto: vi.fn(async (cardId: string) => saved(cardId)),
}) satisfies LoadedCardPhotos;

describe('cards that show a stored photo', () => {
  it('counts the cards one lookup finds in every course', async () => {
    const store = storeWith(found);
    const match = await createFileCardPhotos(store, openLibrary()).find(fileA);
    expect(match.count).toBe(3);
    expect(store.find).toHaveBeenCalledExactlyOnceWith(fileA);
  });

  it('clears exactly the cards found: the open library saves its own, the store the rest', async () => {
    const store = storeWith(found);
    const library = openLibrary();
    const match = await createFileCardPhotos(store, library).find(fileA);
    await match.clear();
    expect(library.removePhoto.mock.calls.map(([cardId]) => cardId)).toEqual(['card-open-1', 'card-open-2']);
    expect(store.clear).toHaveBeenCalledExactlyOnceWith(fileA, [{ id: 'card-other-course', revision: 7 }]);
    // Clearing reuses the lookup instead of reading the cards again.
    expect(store.find).toHaveBeenCalledTimes(1);
  });

  it('reads and saves nothing more when no card shows the photo', async () => {
    const store = storeWith([]);
    const library = openLibrary();
    const match = await createFileCardPhotos(store, library).find(fileA);
    expect(match.count).toBe(0);
    await match.clear();
    expect(library.removePhoto).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('rejects when a card in the open library could not be saved, so the file is kept', async () => {
    const store = storeWith(found);
    const library = openLibrary(cardId => cardId !== 'card-open-1');
    await expect((await createFileCardPhotos(store, library).find(fileA)).clear()).rejects.toThrow();
    expect(library.removePhoto).toHaveBeenCalledTimes(1);
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('rejects when a card in another course could not be saved', async () => {
    const store = storeWith(found, false);
    await expect((await createFileCardPhotos(store, openLibrary()).find(fileA)).clear()).rejects.toThrow();
  });
});

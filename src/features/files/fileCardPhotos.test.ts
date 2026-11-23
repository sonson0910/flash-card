import { describe, expect, it, vi } from 'vitest';
import { OWN_STORAGE_BUCKETS } from '../../lib/mediaUrlPolicy';
import { trackCardPhotoSave } from './cardPhotoSaves';
import { clearFileCardPhotos, createFileCardPhotos, type FileCardPhotoCard, type FileCardPhotoStore, type LoadedCardPhotos } from './fileCardPhotos';

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

  it('looks the cards up only after a card save still putting this photo on a card has ended, even a failed one', async () => {
    const photo = `https://firebasestorage.googleapis.com/v0/b/${[...OWN_STORAGE_BUCKETS][0]}/o/users%2Flearner-1%2Ffiles%2F${fileA}?alt=media&token=0123456789abcdef-0123`;
    let failSave!: (cause: Error) => void;
    const save = trackCardPhotoSave(photo, new Promise<void>((_resolve, reject) => { failSave = reject; }));
    void save.catch(() => undefined);
    const store = storeWith([]);

    const lookup = createFileCardPhotos(store, openLibrary()).find(fileA);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.find).not.toHaveBeenCalled();
    failSave(new Error('offline'));

    await expect(lookup).resolves.toMatchObject({ count: 0 });
    expect(store.find).toHaveBeenCalledExactlyOnceWith(fileA);
  });

  it('does not wait for a card save putting a different photo on a card', async () => {
    const otherPhoto = `https://firebasestorage.googleapis.com/v0/b/${[...OWN_STORAGE_BUCKETS][0]}/o/users%2Flearner-1%2Ffiles%2F${'b'.repeat(24)}?alt=media&token=0123456789abcdef-0123`;
    let endSave!: () => void;
    trackCardPhotoSave(otherPhoto, new Promise<void>(resolve => { endSave = resolve; }));
    const store = storeWith([]);

    await createFileCardPhotos(store, openLibrary()).find(fileA);

    expect(store.find).toHaveBeenCalledExactlyOnceWith(fileA);
    endSave();
  });

  describe('clearing before a file is deleted', () => {
    it('clears a card that gained the photo after the confirmation counted the cards', async () => {
      const lookups = [[{ id: 'card-open-1', revision: 3 }], [{ id: 'card-open-1', revision: 3 }, { id: 'card-other-course', revision: 2 }]];
      const store = {
        find: vi.fn(async (_fileId: string) => lookups.shift() ?? []),
        clear: vi.fn(async (_fileId: string, _cards: readonly FileCardPhotoCard[]) => true),
      } satisfies FileCardPhotoStore;
      const photos = createFileCardPhotos(store, openLibrary());
      const counted = photos.find(fileA);

      await clearFileCardPhotos(photos, fileA, counted);

      expect(store.find).toHaveBeenCalledTimes(2);
      expect(store.clear).toHaveBeenCalledExactlyOnceWith(fileA, [{ id: 'card-other-course', revision: 2 }]);
    });

    it('rejects, so the file is kept, when a card found late could not be saved', async () => {
      const lookups = [[], [{ id: 'card-other-course', revision: 2 }]];
      const store = {
        find: vi.fn(async (_fileId: string) => lookups.shift() ?? []),
        clear: vi.fn(async (_fileId: string, _cards: readonly FileCardPhotoCard[]) => false),
      } satisfies FileCardPhotoStore;
      const photos = createFileCardPhotos(store, openLibrary());

      await expect(clearFileCardPhotos(photos, fileA, photos.find(fileA))).rejects.toThrow();
    });

    it('looks the cards up once when no confirmation counted them, since that lookup is current', async () => {
      const store = storeWith([{ id: 'card-other-course', revision: 2 }]);

      await clearFileCardPhotos(createFileCardPhotos(store, openLibrary()), fileA, undefined);

      expect(store.find).toHaveBeenCalledTimes(1);
      expect(store.clear).toHaveBeenCalledTimes(1);
    });

    it('looks the cards up now when the confirmation lookup failed', async () => {
      const find = vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ count: 0, clear: async () => undefined });

      await clearFileCardPhotos({ find }, fileA, find(fileA));

      expect(find).toHaveBeenCalledTimes(2);
    });
  });
});

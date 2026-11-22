import { describe, expect, it, vi } from 'vitest';
import { OWN_STORAGE_BUCKETS } from '../../lib/mediaUrlPolicy';
import { createFileCardPhotos } from './fileCardPhotos';

const bucket = [...OWN_STORAGE_BUCKETS][0]!;
const fileA = 'a'.repeat(24);
const fileB = 'b'.repeat(24);
const photoUrl = (fileId: string) => (
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/users%2Flearner-1%2Ffiles%2F${fileId}?alt=media&token=0123456789abcdef-0123`
);

const cards = [
  { id: 'card-1', imageUrl: photoUrl(fileA) },
  { id: 'card-2', imageUrl: 'https://images.unsplash.com/photo-1' },
  { id: 'card-3', imageUrl: photoUrl(fileA) },
  { id: 'card-4', imageUrl: photoUrl(fileB) },
  { id: 'card-5' },
];

describe('cards that show a stored photo', () => {
  it('counts only the cards whose photo is that file', () => {
    const photos = createFileCardPhotos(cards, vi.fn());
    expect(photos.count(fileA)).toBe(2);
    expect(photos.count(fileB)).toBe(1);
    expect(photos.count('c'.repeat(24))).toBe(0);
  });

  it('removes the photo from each of those cards and from no other', async () => {
    const removePhoto = vi.fn(async (_cardId: string) => true);
    await createFileCardPhotos(cards, removePhoto).clear(fileA);
    expect(removePhoto.mock.calls.map(([cardId]) => cardId)).toEqual(['card-1', 'card-3']);
  });

  it('rejects when a card could not be saved, so the file is kept', async () => {
    const removePhoto = vi.fn(async (cardId: string) => cardId !== 'card-1');
    await expect(createFileCardPhotos(cards, removePhoto).clear(fileA)).rejects.toThrow();
    expect(removePhoto).toHaveBeenCalledTimes(1);
  });
});

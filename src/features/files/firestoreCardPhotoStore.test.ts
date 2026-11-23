import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  applyCardPatchIfCurrent: vi.fn(),
  getLibraryEpoch: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  or: vi.fn((...args: unknown[]) => ({ type: 'or', args })),
  collection: vi.fn((...args: unknown[]) => ({ type: 'collection', path: args.slice(1).join('/') })),
  doc: vi.fn((...args: unknown[]) => ({ type: 'doc', path: args.slice(1).join('/') })),
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  query: vi.fn((...args: unknown[]) => ({ type: 'query', args })),
  where: vi.fn((...args: unknown[]) => ({ type: 'where', args })),
}));
vi.mock('../../lib/cardRepository', () => ({
  applyCardPatchIfCurrent: mocks.applyCardPatchIfCurrent,
  getLibraryEpoch: mocks.getLibraryEpoch,
}));

import { or, query, where } from 'firebase/firestore';
import { OWN_STORAGE_BUCKETS } from '../../lib/mediaUrlPolicy';
import { cloudPageCacheKey } from '../library/libraryStorage';
import { fileDownloadUrlPrefixes, firestoreCardPhotoStore } from './firestoreCardPhotoStore';

const db = {} as never;
const owner = 'learner-1';
const fileA = 'a'.repeat(24);
const buckets = [...OWN_STORAGE_BUCKETS];
const photoUrl = (fileId: string, bucket = buckets[0]!, token = '0123456789abcdef-0123') => (
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/users%2F${owner}%2Ffiles%2F${fileId}?alt=media&token=${token}`
);
const cardDoc = (id: string, data: Record<string, unknown>) => ({ id, exists: () => true, get: (field: string) => data[field] });

describe('card photos in Firestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLibraryEpoch.mockResolvedValue(4);
  });

  it('matches the download URL of the file in each project bucket up to its token', () => {
    const prefixes = fileDownloadUrlPrefixes(owner, fileA);
    expect(prefixes).toHaveLength(buckets.length);
    for (const [index, bucket] of buckets.entries()) {
      expect(photoUrl(fileA, bucket).startsWith(prefixes[index]!)).toBe(true);
      expect(prefixes[index]).toMatch(/\?alt=media&token=$/);
    }
  });

  it('finds the cards in one query on the photo field and keeps only the ones showing this file', async () => {
    mocks.getDocs.mockResolvedValueOnce({ docs: [
      cardDoc('card-ko', { imageUrl: photoUrl(fileA), revision: 2 }),
      cardDoc('card-en', { imageUrl: photoUrl(fileA, buckets.at(-1), 'fedcba9876543210-9999'), revision: 5 }),
      // A value the range can return that is not a stored download URL of this file.
      cardDoc('card-odd', { imageUrl: `${photoUrl(fileA)}&extra=1`, revision: 1 }),
    ] });

    const cards = await firestoreCardPhotoStore(db, owner).find(fileA);

    expect(cards).toEqual([{ id: 'card-ko', revision: 2 }, { id: 'card-en', revision: 5 }]);
    expect(mocks.getDocs).toHaveBeenCalledTimes(1);
    const [collectionRef] = vi.mocked(query).mock.calls[0]!;
    expect(collectionRef).toMatchObject({ path: `users/${owner}/cards` });
    // Every condition is a range on the photo field: one per bucket, from the prefix to its end.
    expect(vi.mocked(where).mock.calls.every(([field]) => field === 'imageUrl')).toBe(true);
    for (const prefix of fileDownloadUrlPrefixes(owner, fileA)) {
      expect(where).toHaveBeenCalledWith('imageUrl', '>=', prefix);
      expect(where).toHaveBeenCalledWith('imageUrl', '<', `${prefix}\uf8ff`);
    }
    expect(or).toHaveBeenCalledTimes(buckets.length > 1 ? 1 : 0);
  });

  it('drops the cached library page after saving cards behind the open library, so it cannot show the old photo', async () => {
    const stored = new Map([[cloudPageCacheKey(owner), '{"items":[]}'], ['unrelated', 'kept']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
    try {
      mocks.applyCardPatchIfCurrent.mockResolvedValue({ applied: true, revision: 9 });

      await expect(firestoreCardPhotoStore(db, owner).clear(fileA, [{ id: 'card-ko', revision: 2 }])).resolves.toBe(true);

      expect(stored.has(cloudPageCacheKey(owner))).toBe(false);
      expect(stored.get('unrelated')).toBe('kept');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('removes the photo from each card with the card edit transaction at the revision it was read', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValue({ applied: true, revision: 9 });

    await expect(firestoreCardPhotoStore(db, owner).clear(fileA, [{ id: 'card-ko', revision: 2 }, { id: 'card-en', revision: 5 }])).resolves.toBe(true);

    expect(mocks.getLibraryEpoch).toHaveBeenCalledTimes(1);
    expect(mocks.applyCardPatchIfCurrent.mock.calls.map(([, , command]) => command)).toEqual([
      { cardId: 'card-ko', fields: { imageUrl: null, imageSearchQuery: '' }, fieldMask: ['imageUrl', 'imageSearchQuery'], baseRevision: 2, libraryEpoch: 4 },
      { cardId: 'card-en', fields: { imageUrl: null, imageSearchQuery: '' }, fieldMask: ['imageUrl', 'imageSearchQuery'], baseRevision: 5, libraryEpoch: 4 },
    ]);
  });

  it('patches the newer revision of a card that changed after the lookup while it still shows the photo', async () => {
    mocks.applyCardPatchIfCurrent
      .mockResolvedValueOnce({ applied: false, reason: 'revision-conflict', currentRevision: 3 })
      .mockResolvedValueOnce({ applied: true, revision: 4 });
    mocks.getDoc.mockResolvedValueOnce(cardDoc('card-ko', { imageUrl: photoUrl(fileA), revision: 3 }));

    await expect(firestoreCardPhotoStore(db, owner).clear(fileA, [{ id: 'card-ko', revision: 2 }])).resolves.toBe(true);
    expect(mocks.applyCardPatchIfCurrent.mock.calls.map(([, , command]) => command.baseRevision)).toEqual([2, 3]);
  });

  it('leaves a card that no longer shows the photo, or is gone, as it is', async () => {
    mocks.applyCardPatchIfCurrent
      .mockResolvedValueOnce({ applied: false, reason: 'revision-conflict', currentRevision: 3 })
      .mockResolvedValueOnce({ applied: false, reason: 'missing' });
    mocks.getDoc.mockResolvedValueOnce(cardDoc('card-ko', { imageUrl: null, revision: 3 }));

    await expect(firestoreCardPhotoStore(db, owner).clear(fileA, [{ id: 'card-ko', revision: 2 }, { id: 'card-gone', revision: 1 }])).resolves.toBe(true);
    expect(mocks.applyCardPatchIfCurrent).toHaveBeenCalledTimes(2);
  });

  it('reports a card it could not save, so the file is kept', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValueOnce({ applied: false, reason: 'stale-library-epoch' });

    await expect(firestoreCardPhotoStore(db, owner).clear(fileA, [{ id: 'card-ko', revision: 2 }, { id: 'card-en', revision: 5 }])).resolves.toBe(false);
    expect(mocks.applyCardPatchIfCurrent).toHaveBeenCalledTimes(1);
  });
});

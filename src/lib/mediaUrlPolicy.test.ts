import { describe, expect, it } from 'vitest';
import {
  isStockImageUrl,
  isSupportedAudioUrl,
  isSupportedImageUrl,
  OWN_STORAGE_BUCKETS,
  ownStorageImageOwner,
} from './mediaUrlPolicy';

describe('media URL policy', () => {
  it('accepts only absolute HTTPS URLs on trusted audio hosts', () => {
    expect(isSupportedAudioUrl('https://api.dictionaryapi.dev/media/word.mp3')).toBe(true);
    expect(isSupportedAudioUrl('//ssl.gstatic.com/dictionary/word.mp3')).toBe(false);
    expect(isSupportedAudioUrl('http://ssl.gstatic.com/dictionary/word.mp3')).toBe(false);
    expect(isSupportedAudioUrl('https://ssl.gstatic.com.evil.example/word.mp3')).toBe(false);
  });

  it('accepts only absolute HTTPS URLs on trusted image hosts', () => {
    expect(isSupportedImageUrl('https://images.pexels.com/word.jpg')).toBe(true);
    expect(isSupportedImageUrl('//images.pexels.com/word.jpg')).toBe(false);
    expect(isSupportedImageUrl('https://evil.example/word.jpg')).toBe(false);
  });
});

describe('own uploaded card photos', () => {
  const bucket = 'encoded-hangout-433912-h2.firebasestorage.app';
  const download = (overrides: { bucket?: string; path?: string; query?: string } = {}) =>
    `https://firebasestorage.googleapis.com/v0/b/${overrides.bucket ?? bucket}/o/${overrides.path ?? 'users%2Fuser-1%2Ffiles%2FAbCdEfGhIjKlMnOpQrSt'}${overrides.query ?? '?alt=media&token=0b0f1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d'}`;

  it('names the production and staging buckets from the app config', () => {
    expect([...OWN_STORAGE_BUCKETS].sort()).toEqual([bucket, 'sonflash-staging-20260906.firebasestorage.app']);
  });

  it('accepts a download URL for a file under the learner files folder of a project bucket', () => {
    expect(ownStorageImageOwner(download())).toBe('user-1');
    expect(isSupportedImageUrl(download())).toBe(true);
    expect(isSupportedImageUrl(download({ bucket: 'sonflash-staging-20260906.firebasestorage.app' }))).toBe(true);
    expect(isStockImageUrl(download())).toBe(false);
  });

  it('rejects every other object, bucket, host or spelling on the storage host', () => {
    for (const url of [
      download({ bucket: 'someone-else.appspot.com' }),
      download({ bucket: 'demo-lingoflash.appspot.com' }),
      download({ path: 'users%2Fuser-1%2Fprofile%2FAbCdEfGhIjKlMnOpQrSt' }),
      download({ path: 'shared%2Fuser-1%2Ffiles%2FAbCdEfGhIjKlMnOpQrSt' }),
      download({ path: 'users%2Fuser-1%2Ffiles%2FAbCdEfGhIjKlMnOpQrSt%2Fextra' }),
      download({ path: 'users%2Fuser-1%2Ffiles%2Fshort' }),
      download({ path: 'users%2F..%2Ffiles%2FAbCdEfGhIjKlMnOpQrSt' }),
      download({ path: 'users/user-1/files/AbCdEfGhIjKlMnOpQrSt' }),
      download({ path: 'users%2fuser-1%2ffiles%2fAbCdEfGhIjKlMnOpQrSt' }),
      download({ query: '' }),
      download({ query: '?alt=media' }),
      download({ query: '?token=0b0f1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d&alt=media' }),
      download({ query: '?alt=media&token=0b0f1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d&x=1' }),
      `${download()}#fragment`,
      download().replace('https://', 'http://'),
      download().replace('firebasestorage.googleapis.com', 'firebasestorage.googleapis.com:443'),
      download().replace('firebasestorage.googleapis.com', 'user@firebasestorage.googleapis.com'),
      download().replace('firebasestorage.googleapis.com', 'storage.googleapis.com'),
      download().replace('firebasestorage.googleapis.com', 'firebasestorage.googleapis.com.evil.example'),
      'http://127.0.0.1:9199/v0/b/demo-lingoflash.appspot.com/o/users%2Fuser-1%2Ffiles%2FAbCdEfGhIjKlMnOpQrSt?alt=media&token=0b0f1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
      `${download()}${'a'.repeat(2_048)}`,
    ]) {
      expect(ownStorageImageOwner(url), url).toBeNull();
      expect(isSupportedImageUrl(url), url).toBe(false);
    }
  });
});

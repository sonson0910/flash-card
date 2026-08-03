import { describe, expect, it } from 'vitest';
import { isSupportedAudioUrl, isSupportedImageUrl } from './mediaUrlPolicy';

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

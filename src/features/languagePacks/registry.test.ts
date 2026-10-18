import { describe, expect, it, vi } from 'vitest';
import { getCachedLanguagePack, loadLanguagePack, resolveLanguagePackId, speechLocaleForPack } from './registry';

const zhLoadFailure = vi.hoisted(() => ({ remaining: 1 }));

vi.mock('./packs/zh', async importOriginal => {
  const actual = await importOriginal<typeof import('./packs/zh')>();
  return {
    get zhLanguagePack() {
      if (zhLoadFailure.remaining > 0) {
        zhLoadFailure.remaining -= 1;
        throw new Error('temporary language pack load failure');
      }
      return actual.zhLanguagePack;
    },
  };
});

describe('resolveLanguagePackId', () => {
  it('maps bare and subtagged language codes to their pack', () => {
    expect(resolveLanguagePackId('ko')).toBe('ko');
    expect(resolveLanguagePackId('ja')).toBe('ja');
    expect(resolveLanguagePackId('zh')).toBe('zh');
    expect(resolveLanguagePackId('zh-Hans')).toBe('zh');
    expect(resolveLanguagePackId('zh-Hant')).toBe('zh');
  });

  it('falls back to English for legacy omission and unlaunched languages', () => {
    expect(resolveLanguagePackId(undefined)).toBe('en');
    expect(resolveLanguagePackId('en')).toBe('en');
    expect(resolveLanguagePackId('fr')).toBe('en');
    expect(resolveLanguagePackId(42)).toBe('en');
  });
});

describe('speechLocaleForPack', () => {
  it('returns a distinct BCP-47 locale per pack', () => {
    expect(speechLocaleForPack('en')).toBe('en-US');
    expect(speechLocaleForPack('ko')).toBe('ko-KR');
    expect(speechLocaleForPack('ja')).toBe('ja-JP');
    expect(speechLocaleForPack('zh')).toBe('zh-CN');
  });
});

describe('loadLanguagePack', () => {
  it('evicts a failed load so the next attempt can succeed and cache', async () => {
    const failedAttempt = loadLanguagePack('zh');
    await expect(failedAttempt).rejects.toThrow('temporary language pack load failure');

    const successfulAttempt = loadLanguagePack('zh');
    expect(successfulAttempt).not.toBe(failedAttempt);
    const pack = await successfulAttempt;

    expect(pack.id).toBe('zh');
    expect(loadLanguagePack('zh')).toBe(successfulAttempt);
    expect(getCachedLanguagePack('zh')).toBe(pack);
  });

  it('lazily loads, caches, and exposes each pack synchronously once resolved', async () => {
    expect(getCachedLanguagePack('ko')).toBeUndefined();
    const pack = await loadLanguagePack('ko');
    expect(pack.id).toBe('ko');
    expect(getCachedLanguagePack('ko')).toBe(pack);
    // A second call returns the same in-flight/resolved promise instance.
    expect(await loadLanguagePack('ko')).toBe(pack);
  });

  it('loads every wave-1 pack with matching capabilities', async () => {
    const packs = await Promise.all((['en', 'ko', 'ja', 'zh'] as const).map(loadLanguagePack));
    for (const pack of packs) {
      expect(pack.speech.speechLocale).toBeTruthy();
      expect(pack.goalCatalog.goals.length).toBeGreaterThan(0);
      expect(pack.tokenization.segmentGraphemes('word').length).toBeGreaterThan(0);
    }
  });
});

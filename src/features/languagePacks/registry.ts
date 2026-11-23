import { normalizeCardLanguage } from '../../lib/cardIdentity';
import { LEGACY_CARD_LANGUAGE } from '../../types/card';
import type { LanguagePack, LanguagePackId } from './types';

export { LANGUAGE_PACK_IDS } from './types';
export type { LanguagePack, LanguagePackId } from './types';

/**
 * Maps a card's stored language (any BCP-47-shaped string, including legacy
 * omission) to the pack this phase ships. Unknown or unlaunched languages
 * fall back to the English pack rather than throwing, since a target
 * language wave not yet opened must never break rendering.
 */
export function resolveLanguagePackId(cardLanguage: unknown): LanguagePackId {
  const normalized = normalizeCardLanguage(cardLanguage) || LEGACY_CARD_LANGUAGE;
  const primary = normalized.split('-')[0];
  if (primary === 'ko') return 'ko';
  if (primary === 'ja') return 'ja';
  if (primary === 'zh' || primary === 'cmn' || primary === 'yue') return 'zh';
  return 'en';
}

/** BCP-47 locale for SpeechSynthesis/SpeechRecognition, independent of pack loading. */
const SPEECH_LOCALE_BY_PACK: Readonly<Record<LanguagePackId, string>> = {
  en: 'en-US',
  ko: 'ko-KR',
  ja: 'ja-JP',
  zh: 'zh-CN',
};

export function speechLocaleForPack(packId: LanguagePackId): string {
  return SPEECH_LOCALE_BY_PACK[packId];
}

type LanguagePackLoader = () => Promise<LanguagePack>;

const packLoaders: Readonly<Record<LanguagePackId, LanguagePackLoader>> = {
  en: () => import('./packs/en').then(module => module.enLanguagePack),
  ko: () => import('./packs/ko').then(module => module.koLanguagePack),
  ja: () => import('./packs/ja').then(module => module.jaLanguagePack),
  zh: () => import('./packs/zh').then(module => module.zhLanguagePack),
};

const packPromiseCache = new Map<LanguagePackId, Promise<LanguagePack>>();
const resolvedPackCache = new Map<LanguagePackId, LanguagePack>();

/**
 * Lazily imports and caches a language pack module. None of the four packs
 * are statically imported anywhere, so none of them enter the initial
 * bundle; each is only fetched the first time a card in that language is
 * actually rendered.
 */
export function loadLanguagePack(id: LanguagePackId): Promise<LanguagePack> {
  const cached = packPromiseCache.get(id);
  if (cached) return cached;
  const promise = packLoaders[id]().then(pack => {
    resolvedPackCache.set(id, pack);
    return pack;
  });
  packPromiseCache.set(id, promise);
  void promise.catch(() => {
    if (packPromiseCache.get(id) === promise) packPromiseCache.delete(id);
  });
  return promise;
}

/** Synchronous accessor for a pack a prior loadLanguagePack call already resolved. */
export function getCachedLanguagePack(id: LanguagePackId): LanguagePack | undefined {
  return resolvedPackCache.get(id);
}

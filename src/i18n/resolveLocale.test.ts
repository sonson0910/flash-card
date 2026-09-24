import { describe, expect, it } from 'vitest';
import { ENABLED_UI_LOCALES, UI_LOCALES, documentLanguage, type UiLocale } from './locales';
import { resolveLocale } from './resolveLocale';

const allLocales = Object.keys(UI_LOCALES) as UiLocale[];

describe('UI locale resolution', () => {
  it('ships English and Vietnamese first', () => {
    expect(ENABLED_UI_LOCALES).toEqual(['en', 'vi']);
    expect(resolveLocale({ navigatorLanguages: ['es-MX', 'vi-VN'] })).toBe('vi');
    expect(resolveLocale({ navigatorLanguages: ['pt-BR'] })).toBe('en');
  });

  it('uses QA query, stored choice, profile, browser languages, then English', () => {
    const input = {
      search: '?locale=vi', storedLocale: 'en', profileLocale: 'vi', navigatorLanguages: ['vi-VN'],
      allowQueryOverride: true,
    };
    expect(resolveLocale(input)).toBe('vi');
    expect(resolveLocale({ ...input, allowQueryOverride: false })).toBe('en');
    expect(resolveLocale({ ...input, storedLocale: null, allowQueryOverride: false })).toBe('vi');
    expect(resolveLocale({ ...input, storedLocale: null, profileLocale: null, allowQueryOverride: false })).toBe('vi');
    expect(resolveLocale({ navigatorLanguages: ['zh-TW'] })).toBe('en');
  });

  it('matches only a region with an available catalog', () => {
    expect(resolveLocale({ navigatorLanguages: ['pt-BR'], enabledLocales: allLocales })).toBe('pt-BR');
    expect(resolveLocale({ navigatorLanguages: ['pt-PT'], enabledLocales: allLocales })).toBe('en');
    expect(resolveLocale({ navigatorLanguages: ['es-MX'], enabledLocales: allLocales })).toBe('es');
    expect(resolveLocale({ navigatorLanguages: ['ja-JP'], enabledLocales: allLocales })).toBe('ja');
  });

  it('keeps pseudo localization limited to a permitted query', () => {
    expect(resolveLocale({ search: '?locale=pseudo', profileLocale: 'vi', allowQueryOverride: true })).toBe('pseudo');
    expect(resolveLocale({ search: '?locale=pseudo', allowQueryOverride: false })).toBe('en');
    expect(resolveLocale({ storedLocale: 'pseudo' })).toBe('en');
    expect(documentLanguage('pseudo')).toBe('en-XA');
  });
});

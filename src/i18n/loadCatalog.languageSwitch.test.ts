import { i18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import { activateCatalogLocale, getActiveUiLocale, loadCatalog, loadVisitedCatalogs, setActiveUiLocale } from './loadCatalog';

// Runs in its own file so no earlier test has loaded the Vietnamese catalogs into the shared i18n instance.
describe('language switch while a screen opens', () => {
  it('loads the new locale for an area first opened while the switch was loading', async () => {
    setActiveUiLocale('en');
    await Promise.all(['shell', 'landing', 'components', 'today'].map(area => loadCatalog('en', area)));

    const switching = loadVisitedCatalogs('vi');
    const opened = loadCatalog(getActiveUiLocale(), 'progress');
    await Promise.all([switching, opened]);
    setActiveUiLocale('vi');
    activateCatalogLocale('vi');

    const progressIds = Object.keys((await import('./locales/vi/progress.po')).messages);
    expect(progressIds.length).toBeGreaterThan(0);
    expect(i18n.locale).toBe('vi');
    expect(progressIds.filter(id => !(id in i18n.messages))).toEqual([]);
  });
});

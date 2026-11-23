import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { i18n } from '@lingui/core';
import { afterEach, describe, expect, it } from 'vitest';
import { messages as viCatalog } from '../../i18n/locales/vi/catalog.po';
import { catalogAddNotice } from './useCatalogLibraryActions';

describe('useCatalogLibraryActions', () => {
  afterEach(() => { i18n.loadAndActivate({ locale: 'en', messages: {} }); });

  it('words the add notice in the active locale', () => {
    i18n.loadAndActivate({ locale: 'en', messages: {} });
    expect(catalogAddNotice(true, 'run')).toBe('“run” was added to your library and today’s plan.');
    expect(catalogAddNotice(false, 'run')).toBe('“run” is already in your library.');
    i18n.load('vi', viCatalog);
    i18n.activate('vi');
    expect(catalogAddNotice(true, 'run')).not.toMatch(/was added to your library/);
    expect(catalogAddNotice(false, 'run')).not.toMatch(/already in your library/);
    expect(catalogAddNotice(true, 'run')).toContain('run');
  });

  it('memoizes a normalized identity index instead of scanning the library for every catalog card', () => {
    const source = readFileSync(fileURLToPath(new URL('./useCatalogLibraryActions.ts', import.meta.url)), 'utf8');

    expect(source).toContain('useMemo');
    expect(source).toContain('createCatalogLibraryIdentityIndex(cards)');
    expect(source).toContain('catalogEntryIsInLibrary(libraryIdentityIndex, entry)');
    expect(source).not.toContain('catalogEntryIsInLibrary(cards, entry)');
  });
});

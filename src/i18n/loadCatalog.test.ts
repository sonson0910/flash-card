import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { describe, expect, it } from 'vitest';
import { activateCatalogLocale, loadCatalog, setActiveUiLocale } from './loadCatalog';

const areas = ['landing', 'shell', 'components', 'today', 'practice', 'rewards', 'library', 'catalog', 'progress', 'billing', 'account', 'settings'];
const cardCount = msg({ context: 'shell.share.cards-count', message: '{count, plural, one {# card} other {# cards}}' });

describe('lazy locale catalogs', () => {
  it('loads all landing and workspace areas and formats plurals after switching locale', async () => {
    for (const locale of ['en', 'vi'] as const) {
      setActiveUiLocale(locale);
      await Promise.all(areas.map(area => loadCatalog(locale, area)));
      activateCatalogLocale(locale);
      expect(i18n._(cardCount.id, { count: 2 })).toBe(locale === 'en' ? '2 cards' : '2 thẻ');
      expect(i18n._('landing.meta.title')).not.toBe('landing.meta.title');
    }
  });

  it('rejects missing areas on repeated attempts instead of caching a failed import', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(loadCatalog('en', 'does-not-exist')).rejects.toThrow('Missing UI catalog: en/does-not-exist');
    }
  });
});

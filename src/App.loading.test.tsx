import { i18n } from '@lingui/core';
import { I18nProvider as LinguiProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { loadCatalog, setActiveUiLocale } from './i18n/loadCatalog';

vi.mock('./features/navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({ viewMode: 'today', setViewMode: vi.fn() }),
}));
vi.mock('./app/AppRuntimeInitial.virtual', () => new Promise(() => undefined));

describe('App runtime loading fallback', () => {
  it('reads from the shell catalog while the workspace catalogs are still loading', async () => {
    setActiveUiLocale('vi');
    await Promise.all([loadCatalog('vi', 'shell'), loadCatalog('vi', 'landing')]);
    const { default: App } = await import('./App');

    const html = renderToStaticMarkup(<LinguiProvider i18n={i18n}><App /></LinguiProvider>);

    expect(html).toContain('workspace-loading-label');
    expect(html).toContain('Đang tải không gian học tập…');
    expect(html).not.toContain('Loading workspace');
  });
});

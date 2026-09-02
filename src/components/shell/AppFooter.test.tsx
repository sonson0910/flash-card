import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppFooter } from './AppFooter';

const indexCssSource = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8');

describe('AppFooter', () => {
  it('renders online library status without announcing its decorative dot', () => {
    const html = renderToStaticMarkup(
      <AppFooter
        viewMode="library"
        libraryCountLabel="12 WORDS"
        syncStatus={{ isOnline: true, isSyncing: false, pendingCount: 0, error: null, cloudUnavailable: false }}
      />,
    );

    expect(html).toContain('LIBRARY: 12 WORDS');
    expect(html).toContain('app-footer-bar');
    expect(html).toContain('STATUS:');
    expect(html).toContain('Online');
    expect(html).toContain('aria-hidden="true"');
  });

  it('gives the library status strip a raised surface and a visible edge', () => {
    expect(indexCssSource).toMatch(/\.app-footer-bar\s*\{[^}]*border-top:\s*1px\s+solid\s+var\(--sf-border\)/s);
    expect(indexCssSource).toMatch(/\.app-footer-bar\s*\{[^}]*background:\s*var\(--sf-surface-raised\)/s);
  });

  it('preserves the cache fallback labels', () => {
    const offlineHtml = renderToStaticMarkup(
      <AppFooter
        viewMode="library"
        libraryCountLabel="12 WORDS"
        syncStatus={{ isOnline: false, isSyncing: false, pendingCount: 0, error: null, cloudUnavailable: true }}
      />,
    );
    const pausedHtml = renderToStaticMarkup(
      <AppFooter
        viewMode="library"
        libraryCountLabel="12 WORDS"
        syncStatus={{ isOnline: true, isSyncing: false, pendingCount: 0, error: null, cloudUnavailable: true }}
      />,
    );

    expect(offlineHtml).toContain('Offline, using cache');
    expect(pausedHtml).toContain('Cloud paused, using cache');
  });

  it('shows pending sync work instead of a generic online label', () => {
    const html = renderToStaticMarkup(
      <AppFooter
        viewMode="library"
        libraryCountLabel="12 WORDS"
        syncStatus={{ isOnline: true, isSyncing: false, pendingCount: 12, error: null, cloudUnavailable: false }}
      />,
    );

    expect(html).toContain('Waiting to sync');
    expect(html).not.toContain('>Online<');
  });
});

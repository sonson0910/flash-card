import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppFooter } from './AppFooter';

describe('AppFooter', () => {
  it('renders online library status without announcing its decorative dot', () => {
    const html = renderToStaticMarkup(
      <AppFooter viewMode="library" libraryCountLabel="12 WORDS" isBrowserOnline cloudReadUnavailable={false} />,
    );

    expect(html).toContain('LIBRARY: 12 WORDS');
    expect(html).toContain('STATUS:');
    expect(html).toContain('Online');
    expect(html).toContain('aria-hidden="true"');
  });

  it('preserves the cache fallback labels', () => {
    const offlineHtml = renderToStaticMarkup(
      <AppFooter viewMode="library" libraryCountLabel="12 WORDS" isBrowserOnline={false} cloudReadUnavailable />,
    );
    const pausedHtml = renderToStaticMarkup(
      <AppFooter viewMode="library" libraryCountLabel="12 WORDS" isBrowserOnline cloudReadUnavailable />,
    );

    expect(offlineHtml).toContain('Offline, using cache');
    expect(pausedHtml).toContain('Cloud paused, using cache');
  });
});

import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppViewFallback } from './AppDeferredViews';

describe('AppDeferredViews', () => {
  it('keeps the library and practice screens behind app-owned lazy boundaries', () => {
    const deferredViewsSource = readFileSync(new URL('./AppDeferredViews.tsx', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

    expect(deferredViewsSource).toContain("lazy(() => import('../features/library/LibraryScreen')");
    expect(deferredViewsSource).toContain("lazy(() => import('../features/practice/PracticeScreen')");
    expect(deferredViewsSource.match(/fallback={<AppViewFallback label=/g)).toHaveLength(2);
    expect(appSource).not.toContain("lazy(() => import('./features/library/LibraryScreen')");
    expect(appSource).not.toContain("lazy(() => import('./features/practice/PracticeScreen')");
  });

  it('provides one accessible fallback presentation for deferred core views', () => {
    const html = renderToStaticMarkup(<AppViewFallback label="Loading library" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('skeleton-sheen');
    expect(html).toContain('<span class="sr-only">Loading library</span>');
  });
});

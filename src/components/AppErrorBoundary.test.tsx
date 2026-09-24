import { i18n } from '@lingui/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

describe('AppErrorBoundary', () => {
  it('keeps the reload action readable when the locale provider fails', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const boundary = new AppErrorBoundary({ children: null });
    boundary.state = AppErrorBoundary.getDerivedStateFromError();

    const html = renderToStaticMarkup(boundary.render());

    expect(html).toContain('SonFlash needs a reload');
    expect(html).toContain('Reload app');
    expect(html).toContain('role="alert"');
  });

  it('renders Crystal recovery without loading another code chunk', () => {
    vi.stubGlobal('document', { documentElement: { dataset: { themeFamily: 'crystal' } } });
    try {
      const boundary = new AppErrorBoundary({ children: null });
      boundary.state = AppErrorBoundary.getDerivedStateFromError();
      const html = renderToStaticMarkup(boundary.render());
      expect(html).toContain('lumi-oops.webp');
      expect(html).toContain('Reload app');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

import { i18n } from '@lingui/core';
import { readFileSync } from 'node:fs';
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

    expect(html).toContain('Something went');
    expect(html).toContain('sideways.');
    expect(html).toContain('This screen hit an error. Reloading may restore the interface.');
    expect(html).toContain('Reload app');
    expect(html).toContain('role="alert"');
    expect(html).toContain('mailto:sonlearn155@gmail.com?subject=SonFlash%20issue');
    expect(html).toContain('Report issue');
    expect(html).not.toContain('Your saved data is safe');
  });

  it('renders the shared recovery panel without loading a visual asset', () => {
    vi.stubGlobal('document', { documentElement: { dataset: { themeFamily: 'crystal' } } });
    try {
      const boundary = new AppErrorBoundary({ children: null });
      boundary.state = AppErrorBoundary.getDerivedStateFromError();
      const html = renderToStaticMarkup(boundary.render());
      expect(html).toContain('application-error-panel');
      expect(html).toContain('lumi-sad.webp');
      expect(html).toContain('data-lumi-pose="sad"');
      expect(html).toContain('Reload app');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses Canvas primary action colors for classic error recovery in both modes', () => {
    const css = readFileSync(new URL('./system-feedback.css', import.meta.url), 'utf8');
    const darkAction = css.match(/html\[data-theme-family='classic'\] \.application-error-actions button\s*\{([^}]+)\}/)?.[1] ?? '';
    const lightAction = css.match(/html\[data-theme-family='classic'\]:not\(\.dark\) \.application-error-actions button\s*\{([^}]+)\}/)?.[1] ?? '';

    expect(darkAction).toContain('background: #28d3f4;');
    expect(darkAction).toContain('color: #04141c;');
    expect(lightAction).toContain('background: #1d1a16;');
    expect(lightAction).toContain('color: #fbf6ec;');
  });
});

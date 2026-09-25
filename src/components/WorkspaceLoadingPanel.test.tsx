import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import { WorkspaceLoadingPanel } from './WorkspaceLoadingPanel';

describe('WorkspaceLoadingPanel', () => {
  it('shows only loading placeholders and a live loading label', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <WorkspaceLoadingPanel />
      </I18nProvider>,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading workspace');
    expect(html.match(/workspace-loading-card skeleton-sheen/g)).toHaveLength(3);
    expect(html).toContain('workspace-loading-spinner');
    expect(html).toContain('data-lumi-pose="thinking"');
    expect(html).toContain('width="110" height="110" loading="lazy"');
    expect(html).not.toContain('Flash card');
  });

  it('allows a caller to supply the loading context', () => {
    const html = renderToStaticMarkup(<WorkspaceLoadingPanel>Loading library</WorkspaceLoadingPanel>);

    expect(html).toContain('Loading library');
    expect(html).not.toContain('Loading workspace');
  });

  it('places thinking Lumi only on crystal loading panels at the Canvas offset', () => {
    const css = readFileSync(new URL('./system-feedback.css', import.meta.url), 'utf8');
    const crystalRule = css.match(/html\[data-theme-family='crystal'\] \.workspace-loading-lumi\s*\{([^}]+)\}/)?.[1] ?? '';

    expect(css).toContain('.workspace-loading-lumi {\n  display: none;');
    expect(crystalRule).toContain('right: 8px;');
    expect(crystalRule).toContain('bottom: 6px;');
    expect(crystalRule).toContain('display: block;');
    expect(css).toContain('animation: system-feedback-lumi-float 3.2s ease-in-out infinite;');
    expect(css).toContain('0%, 100% { transform: translate3d(0, 0, 0) rotate(-2deg); }');
    expect(css).toContain('50% { transform: translate3d(0, -10px, 0) rotate(2deg); }');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain("html[data-motion='reduced'] .workspace-loading-lumi");

    const classicLightSkeleton = css.match(/html\[data-theme-family='classic'\] \.workspace-loading-panel \.skeleton-sheen\s*\{([^}]+)\}/)?.[1] ?? '';
    const classicDarkSkeleton = css.match(/html\[data-theme-family='classic'\]\.dark \.workspace-loading-panel \.skeleton-sheen\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(classicLightSkeleton).toContain('rgb(29 26 22 / 0.05)');
    expect(classicLightSkeleton).toContain('rgb(29 26 22 / 0.1)');
    expect(classicDarkSkeleton).toContain('rgb(255 255 255 / 0.04)');
    expect(classicDarkSkeleton).toContain('rgb(255 255 255 / 0.09)');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import { setFormatLocale } from '../lib/format';
import type { CardData } from '../types/card';
import { WorkspaceSyncPanel, type WorkspaceSyncPanelProps } from './WorkspaceSyncPanel';

const card = (id: string, word: string): CardData => ({
  id,
  word,
  translation: `meaning of ${word}`,
  explanation: '',
  phonetic: `/${word}/`,
  emoji: '',
  category: 'test',
  audioUrl: null,
  imageUrl: null,
});

const baseProps: WorkspaceSyncPanelProps = {
  status: {
    kind: 'needs-attention',
    detail: 'Cloud access needs attention. Changes may not be up to date.',
    canRetry: true,
  },
  cloudSyncEnabled: true,
  pendingCount: 0,
  dueCards: [],
  canReview: true,
  isRetrying: false,
  onReview: () => undefined,
  onRetry: () => undefined,
  onReturnHome: () => undefined,
};

const renderPanel = (props: WorkspaceSyncPanelProps) => {
  i18n.load('en', {});
  i18n.activate('en');
  setFormatLocale('en');
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <WorkspaceSyncPanel {...props} />
    </I18nProvider>,
  );
};

describe('WorkspaceSyncPanel', () => {
  it('shows actual sync details and pending count without invented recovery claims', () => {
    const html = renderPanel({
      ...baseProps,
      pendingCount: 1234,
    });

    expect(html).toContain('Sync needs attention.');
    expect(html).toMatch(/class="workspace-sync-detail" role="status" aria-labelledby="[^"]+" tabindex="0"/);
    expect(html).toContain('Cloud access needs attention. Changes may not be up to date.');
    expect(html.replace(/<[^>]*>/g, '')).toContain('1,234 changes queued');
    expect(html).toContain('Retry sync');
    expect(html).toContain('Return home');
    expect(html).not.toContain('Nothing was overwritten');
    expect(html).not.toContain('retries 5/5');
    expect(html).not.toContain('14:32:08');
  });

  it('does not promise cloud sync or show queued cloud operations in a local-only offline session', () => {
    const html = renderPanel({
      ...baseProps,
      status: { kind: 'offline', detail: 'Your library is available offline.', canRetry: false },
      cloudSyncEnabled: false,
      pendingCount: 2,
    });

    expect(html).toContain('Offline · still usable');
    expect(html).toContain('Your local library is available on this device.');
    expect(html).toContain('Keep reviewing');
    expect(html).not.toContain('changes queued');
    expect(html).not.toContain('will sync');
  });

  it('uses localized cloud status, queues, and only the runtime due-card previews', () => {
    const html = renderPanel({
      ...baseProps,
      status: { kind: 'saving-offline', detail: '3 changes are waiting until this device reconnects.', canRetry: false },
      pendingCount: 3,
      dueCards: [card('due-a', 'resilient'), card('due-b', 'permanent'), card('not-shown', 'third-word')],
    });

    expect(html).toContain('3 changes are waiting until this device reconnects.');
    expect(html.replace(/<[^>]*>/g, '')).toContain('3 changes queued');
    expect(html).toContain('resilient');
    expect(html).toContain('meaning of resilient');
    expect(html).toContain('/resilient/');
    expect(html).toContain('permanent');
    expect(html).not.toContain('third-word');
    expect(html.match(/workspace-sync-due-card"/g)).toHaveLength(2);
  });

  it('does not invent due cards when the runtime has no preview cards and respects unavailable actions', () => {
    const html = renderPanel({
      ...baseProps,
      status: { kind: 'offline', detail: 'Offline.', canRetry: false },
      dueCards: [],
      canReview: false,
    });

    expect(html).not.toContain('workspace-sync-due-card');
    expect(html).not.toContain('Re silient');
    expect(html).toContain('Keep reviewing</button>');
    expect(html).toMatch(/Keep reviewing<\/button><\/div>/);
    expect(html).toContain('disabled=""');
  });

  it('renders no panel for shell statuses outside the requested recovery states', () => {
    const html = renderPanel({
      ...baseProps,
      status: { kind: 'synced', detail: 'All changes are saved.', canRetry: false },
    });

    expect(html).toBe('');
  });

  it('matches both Canvas panel geometries and preserves theme, responsive, Lumi, and reduced-motion rules', () => {
    const css = readFileSync(new URL('./workspace-sync-panel.css', import.meta.url), 'utf8');

    expect(css).toContain('width: min(100%, 424px);');
    expect(css).toContain('height: 314px;');
    expect(css).toContain("html[data-theme-family='crystal'] .workspace-sync-panel {\n  height: 300px;");
    expect(css).toContain('min-height: 44px;');
    expect(css).toContain("html[data-theme-family='crystal']:not(.dark) .workspace-sync-panel--failure::before");
    expect(css).toContain('linear-gradient(155deg, #ff5470, rgb(224 23 63 / 0.3) 45%, #c40f35)');
    expect(css).toContain("html[data-theme-family='crystal'].dark .workspace-sync-panel--offline::before");
    expect(css).toContain("html[data-theme-family='crystal']:not(.dark) .workspace-sync-panel--offline::before");
    expect(css).toContain('linear-gradient(155deg, #ffc233, rgb(200 140 0 / 0.3) 45%, #c98a00)');
    expect(css).toContain('.workspace-sync-detail:focus-visible {\n  outline: 3px solid var(--sf-brand-text);');
    expect(css).toContain('box-shadow: inset 0 0 0 3px var(--sf-brand-text);');
    expect(css).toContain('clip-path: var(--nk-chamfer);');
    expect(css).toContain("@media (max-width: 420px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("html[data-motion='reduced'] .workspace-sync-lumi");
    expect(css).toContain('display: none;\n  pointer-events: none;');
  });
});

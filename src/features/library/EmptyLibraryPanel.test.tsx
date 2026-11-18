import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EmptyLibraryPanel } from './EmptyLibraryPanel';

const appearance = vi.hoisted(() => ({ family: 'classic' as 'classic' | 'crystal', lumiEnabled: true }));

vi.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ family: appearance.family }),
}));

vi.mock('../settings/lumi-preference', () => ({
  readLumiEnabled: () => appearance.lumiEnabled,
}));

vi.mock('../../components/lumi/Lumi', () => ({
  Lumi: ({ pose, size, className }: { pose: string; size: number; className: string }) => (
    <span data-lumi-pose={pose} data-lumi-size={size} className={className} />
  ),
}));

beforeEach(() => {
  i18n.load('en', {});
  i18n.activate('en');
  appearance.family = 'classic';
  appearance.lumiEnabled = true;
});

const createProps = (overrides: Partial<React.ComponentProps<typeof EmptyLibraryPanel>> = {}) => ({
  fileInputRef: { current: null },
  wordInput: '',
  onWordInputChange: vi.fn(),
  onGenerate: vi.fn(async () => undefined),
  onImport: vi.fn(),
  importFile: vi.fn(),
  onOpenPaths: vi.fn(),
  isLoading: false,
  isGenerating: false,
  isImporting: false,
  generationAccess: { available: true as const },
  importProgress: null,
  importResult: null,
  cards: [],
  ...overrides,
}) as React.ComponentProps<typeof EmptyLibraryPanel>;

function renderPanel(overrides: Partial<React.ComponentProps<typeof EmptyLibraryPanel>> = {}) {
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <EmptyLibraryPanel {...createProps(overrides)} />
    </I18nProvider>,
  );
}

describe('EmptyLibraryPanel', () => {
  it('uses the shared guard for its typed generation form', () => {
    const source = readFileSync(fileURLToPath(new URL('./EmptyLibraryPanel.tsx', import.meta.url)), 'utf8');

    expect(source).toContain("import { createImeSubmitGuard } from '../../lib/imeSubmitGuard'");
    expect(source).toContain('shouldBlockSubmit(event.nativeEvent');
    expect(source).toContain('onCompositionEnd={imeSubmitGuard.onCompositionEnd}');
    expect(source).toContain('shouldBlockKeyDown(event.nativeEvent)');
    expect(source).toContain('onPointerDown={onPointerSubmit}');
  });

  it('renders the classic Canvas first-use card with an editable draft and the real actions', () => {
    const html = renderPanel();

    expect(html).toContain('empty-library--classic');
    expect(html).toContain('Start with your');
    expect(html).toContain('Generate card');
    expect(html).toContain('Type a word or phrase');
    expect(html).toContain('Scan a text');
    expect(html).toContain('Import CSV / Excel');
    expect(html).toContain('Browse paths');
    expect(html).toContain('accept=".csv,.xlsx"');
    expect(html).toContain('id="empty-library-word"');
    expect(html).toContain('type="submit"');
  });

  it('uses the crystal frame and sleepy Lumi only when that preference is enabled', () => {
    appearance.family = 'crystal';
    const enabled = renderPanel();

    expect(enabled).toContain('empty-library__crystal-frame');
    expect(enabled).toContain('LUMI · LINK');
    expect(enabled).toContain('data-lumi-pose="sleepy"');
    expect(enabled).toContain('data-lumi-size="108"');

    appearance.lumiEnabled = false;
    const disabled = renderPanel();
    expect(disabled).toContain('empty-library__lumi-space');
    expect(disabled).not.toContain('data-lumi-pose="sleepy"');
  });

  it('prevents unavailable or busy generation and keeps input plus file paths disabled while busy', () => {
    const unavailable = renderPanel({
      wordInput: 'focus',
      generationAccess: {
        available: false,
        reason: 'authentication-required',
        message: 'Sign in to generate smart cards.',
      },
    });
    expect(unavailable).toContain('Sign in to generate smart cards.');
    expect(unavailable.match(/<button class="empty-library__generate"[^>]*disabled=""/)).not.toBeNull();

    const busy = renderPanel({ wordInput: 'focus', isLoading: true });
    expect(busy.match(/id="empty-library-word"[^>]*disabled=""/)).not.toBeNull();
    expect(busy.match(/<button class="empty-library__generate"[^>]*disabled=""/)).not.toBeNull();
    expect(busy.match(/type="file"[^>]*disabled=""/)).not.toBeNull();
  });

  it('keeps the measured source dimensions and reduced-motion behavior in the panel stylesheet', () => {
    const css = readFileSync(fileURLToPath(new URL('./empty-library-panel.css', import.meta.url)), 'utf8');

    expect(css).toContain('height: 19.625rem');
    expect(css).toContain('height: 18.75rem');
    expect(css).toContain('clip-path: var(--nk-chamfer)');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain("html[data-motion='reduced'] .empty-library__lumi");
  });
});

import { PassThrough } from 'node:stream';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryFilePort } from '../files/memoryFileAdapter';
import { ThemeProvider } from '../theme/ThemeProvider';
import { SETTINGS_SECTIONS } from './settings-sections';
import SettingsScreen from './settings-screen';

i18n.load('en', {}); i18n.activate('en');

/** Renders after every lazy section and catalog has loaded. */
const renderAll = (node: ReactNode) => new Promise<string>((resolve, reject) => {
  const { pipe } = renderToPipeableStream(<I18nProvider i18n={i18n}><ThemeProvider>{node}</ThemeProvider></I18nProvider>, {
    onAllReady() {
      const stream = new PassThrough();
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
      pipe(stream);
    },
    onShellError: reject,
    onError: reject,
  });
});

describe('SettingsScreen', () => {
  it('offers accessible appearance controls and preserves 44px targets', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><ThemeProvider><SettingsScreen /></ThemeProvider></I18nProvider>);
    expect(html).toContain('Midnight Aurora');
    expect(html).toContain('Ink &amp; Paper');
    expect(html).toContain('Crystal Star');
    expect(html).toContain('Study sounds');
    expect(html).toContain('Haptics');
    expect(html).toContain('role="switch"');
    expect(html).toContain('type="radio"');
    expect(html).toContain('min-h-11');
    for (const preview of ['classic-dark', 'classic-light', 'crystal-dark', 'crystal-light']) {
      expect(html).toContain(`data-theme-preview="${preview}"`);
    }
  });

  it('opens the requested section with one page heading and marks it current in the section menu', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><ThemeProvider><SettingsScreen initialSection="sounds" /></ThemeProvider></I18nProvider>);
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toMatch(/aria-current="page"[^>]*>.*?Sounds &amp; haptics/);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Study sounds');
    expect(html).not.toContain('data-theme-preview');
  });

  it('lists storage and files before data as its own linkable section', () => {
    expect(SETTINGS_SECTIONS).toEqual(['appearance', 'language', 'reminders', 'sounds', 'files', 'data']);
  });

  it('opens the storage section with the learner’s file service and a way into My files', async () => {
    const port = createMemoryFilePort({ limits: { tier: 'free', limitBytes: 8 * 1024 * 1024, maxFileBytes: 4 * 1024 * 1024 } });
    const html = await renderAll(<SettingsScreen initialSection="files" filePort={port} onOpenFiles={vi.fn()} />);
    expect(html).toMatch(/aria-current="page"><span class="ss-menu__label"><svg[^]*?<\/svg>Storage &amp; files<\/span>/);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Storage &amp; <em>files</em>');
    expect(html).toMatch(/<h2 id="[^"]+" class="ss-eyebrow">Storage and files<\/h2>/);
    expect(html).toContain('Open My files');
  });

  it('keeps the storage section heading but no storage block without a file service', async () => {
    const html = await renderAll(<SettingsScreen initialSection="files" />);
    expect(html).toContain('Storage &amp; <em>files</em>');
    expect(html).not.toContain('Storage and files');
    expect(html).not.toContain('Open My files');
  });
});

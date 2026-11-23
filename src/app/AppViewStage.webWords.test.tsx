import { PassThrough } from 'node:stream';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createRef, type ComponentProps } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../features/theme/ThemeProvider';
import { setActiveUiLocale } from '../i18n/loadCatalog';
import type { WebWordsPageState } from '../features/webWords/useWebWordsPage';

const mocks = vi.hoisted(() => ({ useWebWordsPage: vi.fn() }));
vi.mock('../features/webWords/useWebWordsPage', () => ({ useWebWordsPage: mocks.useWebWordsPage }));

import { AppViewStage } from './AppViewStage';

i18n.load('en', {});
i18n.activate('en');

const readyState: WebWordsPageState = {
  status: 'ready', groups: [], filters: { site: null, day: null, tier: null },
  availableSites: [], availableDays: ['Today', 'Yesterday', 'Older'], statusScopeCount: 0, hasNext: false, isLoadingMore: false,
  selectedCardIds: new Set(), addToTodayStatus: 'idle', addToTodayHasNormallyScheduledCards: false,
};

const renderWebWords = () => new Promise<string>((resolve, reject) => {
  const props = {
    viewMode: 'web-words', ownerId: 'owner-a', headingRef: createRef<HTMLHeadingElement>(), focusIntent: 0,
    languageProfile: { source: { code: 'en' }, target: { code: 'vi' } }, webWordsReturnView: 'today', returnFromWebWords: vi.fn(),
  } as unknown as ComponentProps<typeof AppViewStage>;
  const { pipe } = renderToPipeableStream(<I18nProvider i18n={i18n}><ThemeProvider><AppViewStage {...props} /></ThemeProvider></I18nProvider>, {
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

describe('AppViewStage web words', () => {
  it('translates the day filter labels when the page is the first view opened in the tab', async () => {
    setActiveUiLocale('vi');
    mocks.useWebWordsPage.mockReturnValue({ state: readyState, actions: {} });
    const html = await renderWebWords();
    expect(html).toContain('data-async-content="web-words"');
    expect(html).not.toContain('library.date.');
    expect(html).toContain('<option value="Today">Hôm nay</option>');
    expect(html).toContain('<option value="Yesterday">Hôm qua</option>');
  });
});

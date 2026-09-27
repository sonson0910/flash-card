import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRadixDialogPassthroughMock } from '../../testing/radix-dialog-passthrough';
import type { CardData } from '../../types/card';
import type { WebWordsPageState, WebWordsPageActions } from './useWebWordsPage';

vi.mock('@radix-ui/react-dialog', () => createRadixDialogPassthroughMock());

const mocks = vi.hoisted(() => ({ useWebWordsPage: vi.fn() }));
vi.mock('./useWebWordsPage', () => ({ useWebWordsPage: mocks.useWebWordsPage }));

import { WebWordsPage } from './WebWordsPage';

i18n.load('en', {});
i18n.activate('en');

const render = () => renderToStaticMarkup(<I18nProvider i18n={i18n}><WebWordsPage onClose={vi.fn()} /></I18nProvider>);

const noopActions: WebWordsPageActions = {
  setSiteFilter: vi.fn(), setDayFilter: vi.fn(), setTierFilter: vi.fn(),
  toggleSelected: vi.fn(), clearSelection: vi.fn(), loadMore: vi.fn(), addSelectedToToday: vi.fn(), retry: vi.fn(),
};

const baseState: WebWordsPageState = {
  status: 'loading', groups: [], filters: { site: null, day: null, tier: null },
  availableSites: [], availableDays: [], hasNext: false, isLoadingMore: false,
  selectedCardIds: new Set(), addToTodayStatus: 'idle',
};

const setState = (overrides: Partial<WebWordsPageState>) =>
  mocks.useWebWordsPage.mockReturnValue({ state: { ...baseState, ...overrides }, actions: noopActions });

const webCard = (overrides: Partial<CardData> = {}): CardData => ({
  id: 'card-1', word: 'ephemeral', translation: 'thoáng qua', language: 'en',
  createdAt: '2026-09-27T00:00:00.000Z', reviews: 0,
  ...overrides,
} as CardData);

describe('WebWordsPage', () => {
  beforeEach(() => mocks.useWebWordsPage.mockReset());

  it('shows a loading message while the first page is in flight', () => {
    setState({ status: 'loading' });
    expect(render()).toContain('Loading your web words');
  });

  it('prompts to sign in when there is no owner', () => {
    setState({ status: 'signed-out' });
    expect(render()).toContain('Sign in to see words you saved from the web.');
  });

  it('shows the empty state when the owner has no web-sourced cards yet', () => {
    setState({ status: 'empty' });
    expect(render()).toContain('No web words yet');
  });

  it('offers a retry action on error', () => {
    setState({ status: 'error' });
    const html = render();
    expect(html).toContain('Web words could not load');
    expect(html).toContain('Try again');
  });

  it('links a displayable http(s) source with rel="noopener noreferrer", and never as anything but plain text otherwise', () => {
    setState({
      status: 'ready',
      groups: [{
        key: 'url:https://example.com/piece',
        site: 'example.com',
        title: 'A piece',
        url: 'https://example.com/piece',
        day: 'Today',
        cards: [webCard()],
      }],
    });

    const html = render();
    expect(html).toContain('href="https://example.com/piece"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('renders a group with no displayable url as plain text, with no anchor tag at all', () => {
    setState({
      status: 'ready',
      groups: [{ key: 'card:card-1', site: null, title: null, url: null, day: 'Today', cards: [webCard()] }],
    });

    const html = render();
    expect(html).not.toContain('<a ');
    expect(html).toContain('Untitled capture');
  });

  it('shows the selection footer and count only once at least one word is selected', () => {
    setState({
      status: 'ready',
      groups: [{ key: 'card:card-1', site: null, title: null, url: null, day: 'Today', cards: [webCard()] }],
      selectedCardIds: new Set(['card-1']),
    });

    const html = render();
    expect(html).toContain('1 word selected');
    expect(html).toContain('Add to today');
  });

  it('surfaces the "session not started" outcome distinctly from a plain success', () => {
    setState({ status: 'ready', groups: [], addToTodayStatus: 'added-session-not-started' });
    expect(render()).toContain('these words will appear once you start today&#x27;s session');
  });
});

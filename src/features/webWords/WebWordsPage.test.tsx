import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { WebWordsPageState, WebWordsPageActions } from './useWebWordsPage';

const mocks = vi.hoisted(() => ({ useWebWordsPage: vi.fn() }));
vi.mock('./useWebWordsPage', () => ({ useWebWordsPage: mocks.useWebWordsPage }));

import { closeWebWordsWorkspaceOnEscape, WebWordsPage } from './WebWordsPage';

i18n.load('en', {});
i18n.activate('en');

const render = () => renderToStaticMarkup(<I18nProvider i18n={i18n}><WebWordsPage ownerId="owner-1" targetLanguage="en" translationLanguage="vi" onClose={vi.fn()} /></I18nProvider>);

const noopActions: WebWordsPageActions = {
  setSiteFilter: vi.fn(), setDayFilter: vi.fn(), setTierFilter: vi.fn(),
  toggleSelected: vi.fn(), clearSelection: vi.fn(), addAllFilteredToToday: vi.fn(), loadMore: vi.fn(), addSelectedToToday: vi.fn(), retry: vi.fn(),
};

const baseState: WebWordsPageState = {
  status: 'loading', groups: [], filters: { site: null, day: null, tier: null },
  availableSites: [], availableDays: [], hasNext: false, isLoadingMore: false,
  selectedCardIds: new Set(), addToTodayStatus: 'idle',
  addToTodayHasNormallyScheduledCards: false,
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
    expect(mocks.useWebWordsPage).toHaveBeenCalledWith({ ownerId: 'owner-1', targetLanguage: 'en', translationLanguage: 'vi' });
  });

  it('closes the workspace only for Escape and prevents the browser default', () => {
    const onClose = vi.fn();
    const preventDefault = vi.fn();
    closeWebWordsWorkspaceOnEscape({ key: 'Enter', preventDefault }, onClose);
    closeWebWordsWorkspaceOnEscape({ key: 'Escape', preventDefault }, onClose);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('prompts to sign in when there is no owner', () => {
    setState({ status: 'signed-out' });
    expect(render()).toContain('Sign in to see words you saved from the web.');
  });

  it('shows the empty state when the owner has no web-sourced cards yet', () => {
    setState({ status: 'empty' });
    expect(render()).toContain('No web words yet');
  });

  it('keeps an empty filtered batch loadable when another bounded page exists', () => {
    setState({ status: 'ready', groups: [], hasNext: true });
    const html = render();
    expect(html).toContain('No web words for this course are in this batch. Load more to keep looking.');
    expect(html).toContain('Load more');
    expect(html).not.toContain('No web words yet');
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

  it('renders persisted source context as plain text without fabricating one when it is absent', () => {
    setState({
      status: 'ready',
      groups: [{
        key: 'url:https://example.com/piece', site: 'example.com', title: 'A piece', url: 'https://example.com/piece', day: 'Today',
        cards: [webCard({ source: { context: 'The <mark>ephemeral</mark> bloom lasted one morning.' } }), webCard({ id: 'card-2' })],
      }],
    });

    const html = render();
    expect(html).toContain('The &lt;mark&gt;ephemeral&lt;/mark&gt; bloom lasted one morning.');
    expect(html).not.toContain('<mark>ephemeral</mark>');
    expect(html).toContain('ephemeral');
    expect(html).not.toContain('Sentence unavailable');
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

  it('uses a full-screen route surface and discloses the loaded filtered count for Add all', () => {
    setState({
      status: 'ready',
      groups: [{ key: 'card:card-1', site: null, title: null, url: null, day: 'Today', cards: [webCard()] }],
    });

    const html = render();
    expect(html).toContain('fixed inset-0');
    expect(html).toContain('Add all 1 to today');
    expect(html).not.toContain('role="dialog"');
  });

  it('does not promise future admission for deferred new-word outcomes', () => {
    for (const addToTodayStatus of ['added-capped', 'added-unloaded', 'added-session-not-started', 'added-after-new-stage'] as const) {
      setState({ status: 'ready', groups: [], addToTodayStatus });
      const html = render();
      expect(html).toContain('were not added to today&#x27;s new-word stage');
      expect(html).toContain('study them elsewhere or try again later');
      expect(html).not.toContain('queue for a later session');
    }
  });

  it('explains that learned cards remain on their normal review schedule', () => {
    setState({ status: 'ready', groups: [], addToTodayStatus: 'scheduled-normal-review', addToTodayHasNormallyScheduledCards: true });
    expect(render()).toContain('already follow their normal review schedule');
  });
});

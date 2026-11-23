import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { WebWordsPageState, WebWordsPageActions } from './useWebWordsPage';

const mocks = vi.hoisted(() => ({ useWebWordsPage: vi.fn() }));
vi.mock('./useWebWordsPage', () => ({ useWebWordsPage: mocks.useWebWordsPage }));

import { closeWebWordsWorkspaceOnEscape, splitContextAtWord, WebWordsPage, type WebWordsPageProps } from './WebWordsPage';

i18n.load('en', {});
i18n.activate('en');

const render = (returnView?: WebWordsPageProps['returnView']) => renderToStaticMarkup(<I18nProvider i18n={i18n}><WebWordsPage ownerId="owner-1" targetLanguage="en" translationLanguage="vi" onClose={vi.fn()} returnView={returnView} /></I18nProvider>);

const noopActions: WebWordsPageActions = {
  setSiteFilter: vi.fn(), setDayFilter: vi.fn(), setTierFilter: vi.fn(),
  toggleSelected: vi.fn(), clearSelection: vi.fn(), addAllFilteredToToday: vi.fn(), loadMore: vi.fn(), addSelectedToToday: vi.fn(), retry: vi.fn(),
};

const baseState: WebWordsPageState = {
  status: 'loading', groups: [], filters: { site: null, day: null, tier: null },
  availableSites: [], availableDays: [], statusScopeCount: 0, hasNext: false, isLoadingMore: false,
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
    // The saved markup stays text; only the page's own highlight around the word becomes an element.
    expect(html).toContain('The &lt;mark&gt;<mark class="ww-row__hit">ephemeral</mark>&lt;/mark&gt; bloom lasted one morning.');
    expect(html).not.toContain('<mark>ephemeral</mark>');
    expect(html.match(/<mark\b/g)).toHaveLength(1);
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

  it('renders in the workspace flow, links back to its opener, and discloses the loaded filtered count for Add all', () => {
    setState({
      status: 'ready',
      groups: [{ key: 'card:card-1', site: null, title: null, url: null, day: 'Today', cards: [webCard()] }],
      statusScopeCount: 1,
    });

    const html = render();
    expect(html).not.toContain('data-placement');
    expect(html).toMatch(/class="ww-back"><span aria-hidden="true">←<\/span> Vocabulary/);
    expect(html).toContain('Add all 1 to today');
    expect(html).not.toContain('role="dialog"');
    expect(render('today')).toMatch(/class="ww-back"><span aria-hidden="true">←<\/span> Today/);
  });

  it('filters by status with labelled tabs and keeps the site and day filters', () => {
    setState({
      status: 'ready',
      groups: [{ key: 'card:card-1', site: 'example.com', title: 'A piece', url: null, day: 'Today', cards: [webCard()] }],
      availableSites: ['example.com'], availableDays: ['Today'], statusScopeCount: 7,
      filters: { site: null, day: null, tier: 'learning' },
    });

    const html = render();
    expect(html).toContain('role="radiogroup" aria-label="Status"');
    expect(html).toContain('All 7');
    expect(html).toContain('data-checked="true"><input type="radio" class="sr-only" name="web-words-status" checked=""/><span class="ww-tab__face">Learning');
    expect(html).toContain('>Site<');
    expect(html).toContain('>Day<');
    expect(html).toContain('Close web words');
  });

  it('marks the saved word inside its sentence, widening to the whole token, and never by guess', () => {
    expect(splitContextAtWord('Engineers warned the embankments were temporary.', 'embankment'))
      .toEqual(['Engineers warned the ', 'embankments', ' were temporary.']);
    expect(splitContextAtWord('Unprecedented temperatures changed the currents.', 'unprecedented'))
      .toEqual(['', 'Unprecedented', ' temperatures changed the currents.']);
    expect(splitContextAtWord('The resilient community rebuilt the bridge.', 'scrutiny')).toBeNull();
    expect(splitContextAtWord('오늘 결심을 했다.', '결심')).toEqual(['오늘 ', '결심', '을 했다.']);
  });

  it('says queued words are queued and only reports not added when nothing was queued', () => {
    for (const addToTodayStatus of ['added-capped', 'added-unloaded', 'added-session-not-started'] as const) {
      setState({ status: 'ready', groups: [], addToTodayStatus });
      const html = render();
      expect(html).toContain('queued and get priority in your next new-word session');
      expect(html).not.toContain('were not added');
    }
    setState({ status: 'ready', groups: [], addToTodayStatus: 'added-after-new-stage' });
    const html = render();
    expect(html).toContain('were not added to today&#x27;s new-word stage');
    expect(html).toContain('study them elsewhere or try again later');
  });

  it('explains that learned cards remain on their normal review schedule', () => {
    setState({ status: 'ready', groups: [], addToTodayStatus: 'scheduled-normal-review', addToTodayHasNormallyScheduledCards: true });
    expect(render()).toContain('already follow their normal review schedule');
  });
});

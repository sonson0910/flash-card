import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';

const recapDialog = vi.hoisted(() => vi.fn(() => null));
vi.mock('./ProgressScreen', () => ({ ProgressScreen: () => null }));
vi.mock('../weeklyRecap/WeeklyRecapDialog', () => ({ default: recapDialog }));

import ProgressWorkspace from './ProgressWorkspace';

i18n.load('en', {});
i18n.activate('en');

const stats: LibraryStatsViewModel = {
  total: 1, reviewed: 1, learned: 0, learning: 1, dueToday: 0,
  categoryChart: [], categoryChartIsPartial: false, difficultyChart: [], xpChartData: [],
};

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis,
  };
  const container = {
    nodeType: 1, ownerDocument: documentLike, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

afterEach(() => {
  vi.unstubAllGlobals();
  recapDialog.mockClear();
});

it('opens a requested recap once only after current-owner stats settle', async () => {
  const onConsumed = vi.fn();
  const root = createRoot(installMinimalReactDom());
  const render = async (ownerId: string, loading: boolean, settled: boolean, targetLanguage = 'en') => {
    await act(async () => {
      root.render(<ProgressWorkspace
        key={ownerId} ownerId={ownerId} targetLanguage={targetLanguage} darkMode={false} isOffline={false}
        stats={stats} isStatsLoading={loading} statsError={null}
        continueReview={vi.fn()} openVocabulary={vi.fn()}
        weeklyRecapRequestOwnerId="owner-a" weeklyRecapRequestSettled={settled}
        onWeeklyRecapRequestConsumed={onConsumed}
      />);
      await Promise.resolve();
    });
  };

  await render('owner-a', false, false);
  await render('owner-a', true, false);
  expect(onConsumed).not.toHaveBeenCalled();
  expect(recapDialog).not.toHaveBeenCalled();

  await render('owner-b', false, true);
  expect(onConsumed).not.toHaveBeenCalled();

  await render('owner-a', false, true);
  expect(onConsumed).toHaveBeenCalledOnce();
  expect(recapDialog).toHaveBeenCalledWith(expect.objectContaining({ open: true, stats }), undefined);

  await render('owner-a', false, false, 'vi');
  expect(recapDialog).toHaveBeenCalledOnce();

  await act(async () => { root.unmount(); });
});

it('opens the saved recap after a failed refresh and marks its source', async () => {
  const onConsumed = vi.fn();
  const root = createRoot(installMinimalReactDom());
  await act(async () => {
    root.render(<ProgressWorkspace
      ownerId="owner-a" darkMode={false} isOffline={false}
      stats={stats} isStatsLoading={false} statsError="Cloud unavailable"
      continueReview={vi.fn()} openVocabulary={vi.fn()}
      weeklyRecapRequestOwnerId="owner-a" weeklyRecapRequestSettled
      onWeeklyRecapRequestConsumed={onConsumed}
    />);
    await Promise.resolve();
  });

  expect(onConsumed).toHaveBeenCalledOnce();
  expect(recapDialog).toHaveBeenCalledWith(expect.objectContaining({ open: true, showingSavedStats: true }), undefined);
  await act(async () => { root.unmount(); });
});

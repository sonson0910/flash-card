import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRadixDialogPassthroughMock } from '../../testing/radix-dialog-passthrough';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import type { WeeklyRecapScreenProps } from './WeeklyRecapScreen';
import WeeklyRecapDialog from './WeeklyRecapDialog';

vi.mock('@radix-ui/react-dialog', () => createRadixDialogPassthroughMock());

const screenCapture = vi.hoisted(() => ({ enabled: false, props: null as WeeklyRecapScreenProps | null }));
const exportCapture = vi.hoisted(() => ({
  render: vi.fn(),
  download: vi.fn(async () => 'downloaded' as const),
}));

vi.mock('./weeklyRecapExport', async importOriginal => ({
  ...await importOriginal<typeof import('./weeklyRecapExport')>(),
  renderWeeklyRecapPng: exportCapture.render,
}));

vi.mock('./weeklyRecapShare', async importOriginal => ({
  ...await importOriginal<typeof import('./weeklyRecapShare')>(),
  downloadWeeklyRecapPng: exportCapture.download,
}));

vi.mock('./WeeklyRecapScreen', async importOriginal => {
  const actual = await importOriginal<typeof import('./WeeklyRecapScreen')>();
  return {
    ...actual,
    WeeklyRecapScreen: (props: WeeklyRecapScreenProps) => {
      if (screenCapture.enabled) {
        screenCapture.props = props;
        return null;
      }
      return <actual.WeeklyRecapScreen {...props} />;
    },
  };
});

i18n.load('en', {});
i18n.activate('en');

const render = (node: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const stats = (overrides: Partial<LibraryStatsViewModel> = {}): LibraryStatsViewModel => ({
  total: 10, reviewed: 10, learned: 4, learning: 6, dueToday: 2,
  categoryChart: [], categoryChartIsPartial: false, difficultyChart: [], xpChartData: [],
  ...overrides,
});

const fixedNow = () => new Date('2026-09-27T09:00:00.000Z');

const installMinimalReactDom = () => {
  class ElementNode {
    readonly nodeType = 1;
    readonly nodeName: string;
    readonly tagName: string;
    readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
    readonly childNodes: ElementNode[] = [];
    parentNode: ElementNode | null = null;
    ownerDocument!: DocumentLike;
    style = {};
    constructor(tagName: string) { this.nodeName = tagName.toUpperCase(); this.tagName = this.nodeName; }
    appendChild(child: ElementNode) { child.parentNode = this; this.childNodes.push(child); return child; }
    insertBefore(child: ElementNode, before: ElementNode | null) {
      child.parentNode = this;
      const index = before ? this.childNodes.indexOf(before) : -1;
      if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child);
      return child;
    }
    removeChild(child: ElementNode) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child; }
    setAttribute() {}
    removeAttribute() {}
    addEventListener() {}
    removeEventListener() {}
  }
  type DocumentLike = {
    nodeType: number;
    activeElement: null;
    defaultView: typeof globalThis;
    documentElement: ElementNode;
    createElement(tagName: string): ElementNode;
    createElementNS(_namespace: string, tagName: string): ElementNode;
    createTextNode(_text: string): ElementNode;
    addEventListener(): void;
    removeEventListener(): void;
  };
  const documentLike: DocumentLike = {
    nodeType: 9, activeElement: null, defaultView: globalThis, documentElement: null!,
    createElement: tagName => { const element = new ElementNode(tagName); element.ownerDocument = documentLike; return element; },
    createElementNS: (_namespace, tagName) => { const element = new ElementNode(tagName); element.ownerDocument = documentLike; return element; },
    createTextNode: () => { const element = new ElementNode('#text'); element.ownerDocument = documentLike; return element; },
    addEventListener() {}, removeEventListener() {},
  };
  const container = documentLike.createElement('div');
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('top', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLElement', ElementNode);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement extends ElementNode {});
  vi.stubGlobal('Node', ElementNode);
  return container as unknown as Element;
};

afterEach(() => {
  screenCapture.enabled = false;
  screenCapture.props = null;
  exportCapture.render.mockReset();
  exportCapture.download.mockClear();
  vi.unstubAllGlobals();
});

describe('WeeklyRecapDialog', () => {
  it('renders nothing while closed, matching the real Radix Dialog contract', () => {
    const html = render(<WeeklyRecapDialog open={false} onOpenChange={vi.fn()} stats={stats()} now={fixedNow} />);
    expect(html).toBe('');
  });

  it('computes the visible date range and totals from the real xp chart data when open', () => {
    const html = render(<WeeklyRecapDialog
      open onOpenChange={vi.fn()} now={fixedNow}
      stats={stats({
        reviewed: 60, learned: 50,
        xpChartData: [{ date: '2026-09-25', XP: 40 }, { date: '2026-09-26', XP: 60 }],
      })}
    />);

    expect(html).toContain('Sep 21');
    expect(html).toContain('Sep 27');
    expect(html).toContain('100'); // 40 + 60 XP inside the window.
    expect(html).toContain('weekly-recap-screen');
    expect(html).toContain('weekly-recap-card');
    expect(html).toContain('weekly-recap-controls');
  });

  it('uses the already hydrated review activity only after it covers the entire local week', () => {
    const html = render(<WeeklyRecapDialog
      open onOpenChange={vi.fn()} now={fixedNow}
      stats={stats({
        reviewActivity: {
          coverageStartedOn: '2026-09-21',
          days: {
            '2026-09-21': { reviewed: 4, again: 0, hard: 1, good: 2, easy: 1 },
            '2026-09-27': { reviewed: 3, again: 1, hard: 0, good: 2, easy: 0 },
          },
        },
        rewardTimeZone: 'Asia/Ho_Chi_Minh',
      })}
    />);

    expect(html).toContain('Reviews this week');
    expect(html).toContain('7');

    const partial = render(<WeeklyRecapDialog
      open onOpenChange={vi.fn()} now={fixedNow}
      stats={stats({ reviewActivity: { coverageStartedOn: '2026-09-22', days: {} }, rewardTimeZone: 'Asia/Ho_Chi_Minh' })}
    />);
    expect(partial).toContain('Reviews this week are unavailable until activity covers all seven days.');
  });

  it('surfaces how many of the real (all-time) milestone badges are unlocked', () => {
    const html = render(<WeeklyRecapDialog
      open onOpenChange={vi.fn()} now={fixedNow}
      stats={stats({ reviewed: 60, learned: 50 })} // clears mastery_10 and mastery_50 thresholds.
    />);

    expect(html).toContain('2 of 6 milestones unlocked');
  });

  it('warns when a direct recap route can only show saved stats', () => {
    const html = render(<WeeklyRecapDialog open onOpenChange={vi.fn()} stats={stats()} showingSavedStats now={fixedNow} />);
    expect(html).toContain('Showing saved recap. Recent reviews may not be included.');
  });

  it('keeps a typed caption through a same-week refresh, while refreshing an untouched suggestion', async () => {
    screenCapture.enabled = true;
    const root = createRoot(installMinimalReactDom());
    const nextWeekNow = () => new Date('2026-10-04T09:00:00.000Z');
    const renderDialog = async (open: boolean, totalXp: number, now = fixedNow, date = '2026-09-26') => act(async () => {
      root.render(<I18nProvider i18n={i18n}><WeeklyRecapDialog open={open} onOpenChange={vi.fn()} now={now}
        stats={stats({ xpChartData: [{ date, XP: totalXp }] })} />
      </I18nProvider>);
      await Promise.resolve();
    });
    try {
      await renderDialog(true, 40);
      expect(screenCapture.props?.caption).toBe('40 XP and 1 active day this week.');

      await act(async () => { screenCapture.props!.actions.setCaption('My own caption'); });
      await renderDialog(true, 60);
      expect(screenCapture.props?.caption).toBe('My own caption');

      await renderDialog(false, 60);
      await renderDialog(true, 80);
      expect(screenCapture.props?.caption).toBe('80 XP and 1 active day this week.');

      await renderDialog(true, 100);
      expect(screenCapture.props?.caption).toBe('100 XP and 1 active day this week.');

      await act(async () => { screenCapture.props!.actions.setCaption('Another custom caption'); });
      await renderDialog(true, 120, nextWeekNow, '2026-10-03');
      expect(screenCapture.props?.caption).toBe('120 XP and 1 active day this week.');
    } finally {
      await act(async () => { root.unmount(); });
    }
  });

  it('ignores an export that finishes after close', async () => {
    screenCapture.enabled = true;
    const root = createRoot(installMinimalReactDom());
    let finishRender!: (blob: Blob) => void;
    exportCapture.render.mockReturnValue(new Promise(resolve => { finishRender = resolve; }));
    const renderDialog = async (open: boolean, now: () => Date, date: string) => act(async () => {
      root.render(<I18nProvider i18n={i18n}><WeeklyRecapDialog open={open} onOpenChange={vi.fn()} now={now}
        stats={stats({ xpChartData: [{ date, XP: 40 }] })} />
      </I18nProvider>);
      await Promise.resolve();
    });
    try {
      await renderDialog(true, fixedNow, '2026-09-26');
      await act(async () => {
        screenCapture.props!.actions.setCaption('Old course caption');
        screenCapture.props!.actions.toggleSelection('totalXp');
        screenCapture.props!.actions.download();
        await vi.waitFor(() => expect(exportCapture.render).toHaveBeenCalledTimes(1));
      });
      expect(screenCapture.props?.isBusy).toBe(true);

      await renderDialog(false, fixedNow, '2026-09-26');

      await act(async () => { finishRender(new Blob(['old recap'], { type: 'image/png' })); });
      expect(exportCapture.download).not.toHaveBeenCalled();
    } finally {
      await act(async () => { root.unmount(); });
    }
  });
});

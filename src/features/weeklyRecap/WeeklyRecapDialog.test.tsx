import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRadixDialogPassthroughMock } from '../../testing/radix-dialog-passthrough';
import { VerifiedStatsProvider, type VerifiedStatsSource } from '../../components/stats/VerifiedStatsContext';
import { stateFromFixture, wordWeeksFixture } from '../gamification/testing/verifiedStatsFixtures';
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

    expect(html).toMatch(/21\s?–\s?27 Sept?</); // the Monday week, day first as on the board.
    expect(html).toContain('100'); // 40 + 60 XP inside the week.
    expect(html).toContain('weekly-recap-screen');
    expect(html).toContain('weekly-recap-card');
    expect(html).toContain('weekly-recap-controls');
  });

  it('draws the verified week: words, streak, recall, studied time and the best-week headline', () => {
    const source: VerifiedStatsSource = { state: stateFromFixture(wordWeeksFixture), language: 'en' };
    const html = render(<VerifiedStatsProvider source={source}><WeeklyRecapDialog
      open onOpenChange={vi.fn()} now={() => wordWeeksFixture.now}
      stats={stats({ xpChartData: [{ date: '2026-11-16', XP: 120 }], rewardTimeZone: 'Asia/Ho_Chi_Minh' })}
    /></VerifiedStatsProvider>);

    expect(html).toMatch(/16\s?–\s?22 Nov</);
    expect(html).toContain('<strong>146</strong>');
    expect(html).toContain('words <em>this week</em>');
    expect(html).toContain('12 d');
    expect(html).toContain('91%'); // 130 graded, 12 Again: Hard counts as recalled.
    expect(html).toContain('Your best week <em>since 2 Nov.</em>');
    expect(html).toContain('<strong>+38 words</strong> compared with last week.');
    // Without a card loader the word of the week cannot be shown, so its toggle is left out.
    expect(html).not.toContain('data-selection-key="wordOfWeek"');
    expect(html).not.toContain('Weekly word counts started on');
  });

  it('reads the word of the week only after the learner turns it on, and hides it when the card is gone', async () => {
    screenCapture.enabled = true;
    const root = createRoot(installMinimalReactDom());
    const loadCard = vi.fn(async (cardId: string) => (cardId === 'word-immediate' ? { id: cardId, word: 'immediate' } : null));
    const renderDialog = async (load: VerifiedStatsSource['loadCard']) => act(async () => {
      root.render(<I18nProvider i18n={i18n}><VerifiedStatsProvider source={{ state: stateFromFixture(wordWeeksFixture), language: 'en', loadCard: load }}>
        <WeeklyRecapDialog open onOpenChange={vi.fn()} now={() => wordWeeksFixture.now} stats={stats({ rewardTimeZone: 'Asia/Ho_Chi_Minh' })} />
      </VerifiedStatsProvider></I18nProvider>);
      await Promise.resolve();
    });
    try {
      await renderDialog(loadCard);
      expect(screenCapture.props?.selection.wordOfWeek).toBe(false);
      expect(screenCapture.props?.selectionKeys).toContain('wordOfWeek');
      expect(loadCard).not.toHaveBeenCalled();

      await act(async () => { screenCapture.props!.actions.toggleSelection('wordOfWeek'); });
      await act(async () => { await Promise.resolve(); });
      expect(loadCard).toHaveBeenCalledTimes(1);
      expect(loadCard).toHaveBeenCalledWith('word-immediate');
      expect(screenCapture.props?.content.wordOfWeek).toEqual({ label: 'Word of the week', word: 'immediate', detail: 'Reviewed 4 times this week' });

      const missing = vi.fn(async () => null);
      await act(async () => { root.unmount(); });
      const next = createRoot(installMinimalReactDom());
      await act(async () => {
        next.render(<I18nProvider i18n={i18n}><VerifiedStatsProvider source={{ state: stateFromFixture(wordWeeksFixture), language: 'en', loadCard: missing }}>
          <WeeklyRecapDialog open onOpenChange={vi.fn()} now={() => wordWeeksFixture.now} stats={stats({ rewardTimeZone: 'Asia/Ho_Chi_Minh' })} />
        </VerifiedStatsProvider></I18nProvider>);
        await Promise.resolve();
      });
      await act(async () => { screenCapture.props!.actions.toggleSelection('wordOfWeek'); });
      await act(async () => { await Promise.resolve(); });
      expect(missing).toHaveBeenCalledTimes(1);
      expect(screenCapture.props?.selectionKeys).not.toContain('wordOfWeek');
      expect(screenCapture.props?.content.wordOfWeek).toBeNull();
      await act(async () => { next.unmount(); });
    } finally {
      await act(async () => { root.unmount(); });
    }
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
      expect(screenCapture.props?.caption).toBe('40 XP this week.');

      await act(async () => { screenCapture.props!.actions.setCaption('My own caption'); });
      await renderDialog(true, 60);
      expect(screenCapture.props?.caption).toBe('My own caption');

      await renderDialog(false, 60);
      await renderDialog(true, 80);
      expect(screenCapture.props?.caption).toBe('80 XP this week.');

      await renderDialog(true, 100);
      expect(screenCapture.props?.caption).toBe('100 XP this week.');

      await act(async () => { screenCapture.props!.actions.setCaption('Another custom caption'); });
      await renderDialog(true, 120, nextWeekNow, '2026-10-03');
      expect(screenCapture.props?.caption).toBe('120 XP this week.');
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
        screenCapture.props!.actions.toggleSelection('words');
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

import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildWeeklyRecapCardContent, type WeeklyRecapCardContent } from './weeklyRecapCard';
import type { WeeklyRecapData, WeeklyRecapStats } from './weeklyRecapModel';
import { defaultWeeklyRecapSelection, type WeeklyRecapSelection } from './weeklyRecapSelection';
import {
  drawWeeklyRecapCard,
  renderWeeklyRecapPng,
  WeeklyRecapExportUnavailableError,
  WEEKLY_RECAP_EXPORT_HEIGHT,
  WEEKLY_RECAP_EXPORT_WIDTH,
  type WeeklyRecapExportCopy,
  type WeeklyRecapExportTheme,
} from './weeklyRecapExport';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const theme: WeeklyRecapExportTheme = {
  background: '#0b1220', text: '#f5f7fb', textMuted: '#9aa5b8', brand: '#38bdf8',
  heatLevels: ['#111827', '#164e63', '#0e7490', '#0891b2', '#22d3ee'], cardChip: 'chip-tint',
};

const copy: WeeklyRecapExportCopy = {
  weeklyRecap: 'Weekly recap',
  privacy: 'The image includes the selected metrics and your caption. Private words are never added automatically.',
};

const recap = (overrides: Partial<WeeklyRecapData> = {}): WeeklyRecapData => ({
  rangeStart: '2026-11-16',
  rangeEnd: '2026-11-22',
  days: [
    { dateKey: '2026-11-16', xp: 0 }, { dateKey: '2026-11-17', xp: 40 }, { dateKey: '2026-11-18', xp: 0 },
    { dateKey: '2026-11-19', xp: 90 }, { dateKey: '2026-11-20', xp: 0, future: true },
    { dateKey: '2026-11-21', xp: 0, future: true }, { dateKey: '2026-11-22', xp: 0, future: true },
  ],
  totalXp: 130,
  activeDays: 2,
  bestDay: { dateKey: '2026-11-19', xp: 90 },
  reviewedCount: null,
  hasActivity: true,
  ...overrides,
});

const verified: WeeklyRecapStats = {
  weekStart: '2026-11-16',
  words: { started: 146, mastered: 10, since: null },
  bestWeek: { since: null },
  aheadOfLastWeek: 38,
  streakDays: 12,
  recall: { percent: 91, since: null },
  studied: { activeMs: 9_600_000, since: null },
  wordOfWeek: { cardId: 'word-immediate', reviews: 4 },
};

const content = (selection: WeeklyRecapSelection = defaultWeeklyRecapSelection(), stats: WeeklyRecapStats | null = verified, data = recap()): WeeklyRecapCardContent =>
  buildWeeklyRecapCardContent({ data, stats, selection, wordOfWeek: { word: 'immediate', reviews: 4 }, locale: 'en' });

function createMockContext() {
  const calls: {
    fillText: string[];
    fillTextY: Array<{ text: string; y: number }>;
    fillRect: number;
    fillStyle: string[];
  } = { fillText: [], fillTextY: [], fillRect: 0, fillStyle: [] };
  const context = {
    clearRect: vi.fn(),
    fillRect: vi.fn(() => { calls.fillRect += 1; }),
    fillText: vi.fn((text: string, _x: number, y: number) => {
      calls.fillText.push(text);
      calls.fillTextY.push({ text, y });
    }),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    set fillStyle(value: string) { calls.fillStyle.push(value); },
    get fillStyle() { return calls.fillStyle.at(-1) ?? ''; },
    font: '',
  } as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

describe('drawWeeklyRecapCard', () => {
  it('draws the same fields the card shows, and always the privacy footer', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, { content: content(), caption: '146 new words this week on SonFlash.', dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme });
    const text = calls.fillText.join(' | ');

    expect(text).toContain('SONFLASH · MY WEEK');
    expect(text).toContain('16 – 22 Nov');
    expect(text).toContain('146');
    expect(text).toContain('this week');
    for (const value of ['12 d', 'streak', '91%', 'recall', '2 h 40', 'studied']) expect(text).toContain(value);
    expect(text).toContain('146 new words this week on SonFlash.');
    expect(calls.fillText.join(' ')).toContain(copy.privacy);
  });

  it('leaves the word of the week off the image until the learner turns it on', () => {
    const off = createMockContext();
    drawWeeklyRecapCard(off.context, { content: content(), caption: '', dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme });
    expect(off.calls.fillText).not.toContain('immediate');

    const on = createMockContext();
    drawWeeklyRecapCard(on.context, { content: content({ ...defaultWeeklyRecapSelection(), wordOfWeek: true }), caption: '', dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme });
    expect(on.calls.fillText).toContain('immediate');
    expect(on.calls.fillText).toContain('Reviewed 4 times this week');
  });

  it('omits a field entirely when the selection turns it off', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, {
      content: content({ ...defaultWeeklyRecapSelection(), streak: false, recall: false, heatmap: false }),
      caption: '', dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme,
    });
    expect(calls.fillText).not.toContain('12 d');
    expect(calls.fillText).not.toContain('91%');
    expect(calls.fillText).not.toContain('M');
    expect(calls.fillText).toContain('2 h 40');
  });

  it('draws days still to come empty, never as a heat step', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, { content: content(), caption: '', dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme });
    // Monday 0 XP, Tuesday 40, Wednesday 0, Thursday 90, then three future days.
    const cells = calls.fillStyle.filter(style => theme.heatLevels.includes(style as never) || style === 'chip-tint');
    expect(cells.slice(-7)).toEqual(['#111827', '#0e7490', '#111827', '#0891b2', 'chip-tint', 'chip-tint', 'chip-tint']);
  });

  it('draws the bloom garden only in Crystal', () => {
    const classic = createMockContext();
    drawWeeklyRecapCard(classic.context, { content: content(), caption: '', dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme });
    expect(classic.calls.fillText.join(' ')).not.toContain('BLOOM GARDEN');

    const crystal = createMockContext();
    drawWeeklyRecapCard(crystal.context, { content: content(), caption: '', dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme: { ...theme, family: 'crystal' } });
    const text = crystal.calls.fillText.join(' | ');
    expect(text).toContain('BLOOM GARDEN');
    expect(text).toContain('BUD → BLOOM');
    expect(text).toContain('BLOOM → STAR');
    expect(text).toContain('10');
  });

  it('draws the empty-week sentence instead of zero metrics', () => {
    const { context, calls } = createMockContext();
    const empty = content(defaultWeeklyRecapSelection(), null, recap({ days: recap().days.map(day => ({ ...day, xp: 0 })), totalXp: 0, activeDays: 0, bestDay: null, hasActivity: false }));
    drawWeeklyRecapCard(context, { content: empty, caption: '', dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme });
    const text = calls.fillText.join(' ');
    expect(text).toContain('No study activity yet this week.');
    expect(text).not.toContain('XP');
  });

  it('never draws an empty caption line', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, { content: content(), caption: '   ', dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme });
    expect(calls.fillTextY.filter(entry => entry.y === WEEKLY_RECAP_EXPORT_HEIGHT - 220)).toHaveLength(0);
  });
});

describe('renderWeeklyRecapPng', () => {
  it('sizes the canvas, draws, and resolves the PNG blob it produces', async () => {
    const { context } = createMockContext();
    const producedBlob = new Blob(['png-bytes'], { type: 'image/png' });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: (blob: Blob | null) => void) => callback(producedBlob)),
    } as unknown as HTMLCanvasElement;

    const blob = await renderWeeklyRecapPng({
      content: content(), caption: 'Hi',
      dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme,
    }, () => canvas);

    expect(canvas.width).toBe(WEEKLY_RECAP_EXPORT_WIDTH);
    expect(canvas.height).toBe(WEEKLY_RECAP_EXPORT_HEIGHT);
    expect(blob).toBe(producedBlob);
  });

  it('rejects with a clear error when the browser has no 2D canvas context', async () => {
    const canvas = {
      width: 0, height: 0,
      getContext: vi.fn(() => null),
      toBlob: vi.fn(),
    } as unknown as HTMLCanvasElement;

    await expect(renderWeeklyRecapPng({
      content: content(), caption: '',
      dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme,
    }, () => canvas)).rejects.toBeInstanceOf(WeeklyRecapExportUnavailableError);
  });

  it('falls back to synchronous PNG data URL encoding when async toBlob stalls', async () => {
    vi.useFakeTimers();
    try {
      const { context } = createMockContext();
      const canvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => context),
        toBlob: vi.fn(),
        toDataURL: vi.fn(() => 'data:image/png;base64,iVBORw0KGgo='),
      } as unknown as HTMLCanvasElement;

      const promise = renderWeeklyRecapPng({
        content: content(), caption: 'Hi',
        dateRangeLabel: '16 – 22 Nov', locale: 'en', copy, theme,
      }, () => canvas);

      await vi.advanceTimersByTimeAsync(250);
      const blob = await promise;
      expect(blob.type).toBe('image/png');
      expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    } finally {
      vi.useRealTimers();
    }
  });
});

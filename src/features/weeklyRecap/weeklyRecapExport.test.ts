import { describe, expect, it, vi } from 'vitest';
import type { WeeklyRecapData } from './weeklyRecapModel';
import { defaultWeeklyRecapSelection } from './weeklyRecapSelection';
import {
  drawWeeklyRecapCard,
  renderWeeklyRecapPng,
  WeeklyRecapExportUnavailableError,
  WEEKLY_RECAP_EXPORT_HEIGHT,
  WEEKLY_RECAP_EXPORT_WIDTH,
  type WeeklyRecapExportTheme,
} from './weeklyRecapExport';

const theme: WeeklyRecapExportTheme = {
  background: '#0b1220', text: '#f5f7fb', textMuted: '#9aa5b8', brand: '#38bdf8',
  heatLevels: ['#111827', '#164e63', '#0e7490', '#0891b2', '#22d3ee'],
};

const recap = (overrides: Partial<WeeklyRecapData> = {}): WeeklyRecapData => ({
  rangeStart: '2026-09-21',
  rangeEnd: '2026-09-27',
  days: [
    { dateKey: '2026-09-21', xp: 0 }, { dateKey: '2026-09-22', xp: 40 }, { dateKey: '2026-09-23', xp: 0 },
    { dateKey: '2026-09-24', xp: 90 }, { dateKey: '2026-09-25', xp: 0 }, { dateKey: '2026-09-26', xp: 20 },
    { dateKey: '2026-09-27', xp: 0 },
  ],
  totalXp: 150,
  activeDays: 3,
  bestDay: { dateKey: '2026-09-24', xp: 90 },
  hasActivity: true,
  ...overrides,
});

function createMockContext() {
  const calls: { fillText: string[]; fillRect: number; fillStyle: string[] } = { fillText: [], fillRect: 0, fillStyle: [] };
  const context = {
    clearRect: vi.fn(),
    fillRect: vi.fn(() => { calls.fillRect += 1; }),
    fillText: vi.fn((text: string) => { calls.fillText.push(text); }),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    set fillStyle(value: string) { calls.fillStyle.push(value); },
    get fillStyle() { return calls.fillStyle.at(-1) ?? ''; },
    font: '',
  } as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

describe('drawWeeklyRecapCard', () => {
  it('draws every selected field and always draws the privacy footer', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, {
      data: recap(), selection: defaultWeeklyRecapSelection(), caption: 'Great week!',
      milestones: { unlocked: 2, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', theme,
    });

    expect(calls.fillText).toContain('150');
    expect(calls.fillText).toContain('3 / 7 active days');
    expect(calls.fillText.some(text => text.includes('Best day'))).toBe(true);
    expect(calls.fillText).toContain('2 / 6 milestones unlocked (all-time)');
    expect(calls.fillText).toContain('Great week!');
    expect(calls.fillText).toContain('Private words are never included unless you add them yourself.');
    expect(calls.fillRect).toBe(8); // 1 background rect + 7 heatmap-day cells.
  });

  it('omits a field entirely when the selection turns it off', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, {
      data: recap(), selection: { ...defaultWeeklyRecapSelection(), totalXp: false, heatmap: false, milestones: false },
      caption: '', milestones: { unlocked: 2, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', theme,
    });

    expect(calls.fillText).not.toContain('150');
    expect(calls.fillText.some(text => text.includes('milestones unlocked'))).toBe(false);
    // Background fillRect only; no heatmap day cells were drawn.
    expect(calls.fillRect).toBe(1);
  });

  it('never draws an empty caption line', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, {
      data: recap({ hasActivity: false, totalXp: 0 }), selection: defaultWeeklyRecapSelection(), caption: '   ',
      milestones: { unlocked: 0, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', theme,
    });

    expect(calls.fillText).toContain('Private words are never included unless you add them yourself.');
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
      data: recap(), selection: defaultWeeklyRecapSelection(), caption: 'Hi', milestones: { unlocked: 1, total: 6 },
      dateRangeLabel: 'Sep 21 – Sep 27', theme,
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
      data: recap(), selection: defaultWeeklyRecapSelection(), caption: '', milestones: { unlocked: 0, total: 6 },
      dateRangeLabel: 'Sep 21 – Sep 27', theme,
    }, () => canvas)).rejects.toBeInstanceOf(WeeklyRecapExportUnavailableError);
  });
});

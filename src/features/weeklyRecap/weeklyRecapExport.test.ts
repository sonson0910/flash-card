import { describe, expect, it, vi } from 'vitest';
import type { WeeklyRecapData } from './weeklyRecapModel';
import { buildSuggestedWeeklyRecapCaption, defaultWeeklyRecapSelection } from './weeklyRecapSelection';
import {
  drawWeeklyRecapCard,
  renderWeeklyRecapPng,
  WeeklyRecapExportUnavailableError,
  WEEKLY_RECAP_EXPORT_HEIGHT,
  WEEKLY_RECAP_EXPORT_WIDTH,
  type WeeklyRecapExportCopy,
  type WeeklyRecapExportTheme,
} from './weeklyRecapExport';

const theme: WeeklyRecapExportTheme = {
  background: '#0b1220', text: '#f5f7fb', textMuted: '#9aa5b8', brand: '#38bdf8',
  heatLevels: ['#111827', '#164e63', '#0e7490', '#0891b2', '#22d3ee'],
};

const englishCopy: WeeklyRecapExportCopy = {
  weeklyRecap: 'Weekly recap',
  xpThisWeek: 'XP this week',
  reviewsThisWeek: 'Reviews this week',
  noStudyActivity: 'No study activity yet this week.',
  activeDays: 'active days',
  bestDay: 'Best day',
  dailyXp: 'Daily XP',
  milestones: (unlocked, total) => `${unlocked} / ${total} milestones unlocked (all-time)`,
  privacy: 'The image includes the selected metrics and your caption. Private words are never added automatically.',
};

const vietnameseCopy: WeeklyRecapExportCopy = {
  weeklyRecap: 'Tổng kết tuần',
  xpThisWeek: 'XP tuần này',
  reviewsThisWeek: 'Lượt ôn tuần này',
  noStudyActivity: 'Tuần này chưa có hoạt động học nào.',
  activeDays: 'Ngày học',
  bestDay: 'Ngày tốt nhất',
  dailyXp: 'XP mỗi ngày trong 7 ngày qua',
  milestones: (unlocked, total) => `Đã mở khóa ${unlocked} / ${total} cột mốc (từ trước đến nay)`,
  privacy: 'Ảnh chia sẻ gồm các chỉ số đã chọn và chú thích của bạn. Từ riêng tư không được tự động thêm vào.',
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
  reviewedCount: null,
  hasActivity: true,
  ...overrides,
});

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
  it('draws every selected field and always draws the privacy footer', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, {
      data: recap(), selection: defaultWeeklyRecapSelection(), caption: 'Great week!',
      milestones: { unlocked: 2, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', locale: 'en', copy: englishCopy, theme,
    });

    expect(calls.fillText).toContain('150');
    expect(calls.fillText).toContain('3 / 7 active days');
    expect(calls.fillText.some(text => text.includes('Best day'))).toBe(true);
    expect(calls.fillText).toContain('2 / 6 milestones unlocked (all-time)');
    expect(calls.fillText).toContain('Great week!');
    expect(calls.fillText.join(' ')).toContain(englishCopy.privacy);
    expect(calls.fillRect).toBe(8); // 1 background rect + 7 heatmap-day cells.

    const date = calls.fillTextY.find(call => call.text === 'Sep 21 – Sep 27');
    const xp = calls.fillTextY.find(call => call.text === '150');
    if (!date || !xp) throw new Error('Expected date and XP baselines in the export.');
    expect(xp.y - date.y).toBeGreaterThanOrEqual(136);
  });

  it('localizes labels and weekday abbreviations for the active locale', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, {
      data: recap(), selection: defaultWeeklyRecapSelection(), caption: '',
      milestones: { unlocked: 2, total: 6 }, dateRangeLabel: '21 thg 9 – 27 thg 9', locale: 'vi', copy: vietnameseCopy, theme,
    });

    expect(calls.fillText).toContain('SONFLASH · TỔNG KẾT TUẦN');
    expect(calls.fillText).toContain('XP TUẦN NÀY');
    expect(calls.fillText).toContain('3 / 7 Ngày học');
    expect(calls.fillText.some(text => text.includes('Ngày tốt nhất'))).toBe(true);
    expect(calls.fillText).toContain('XP MỖI NGÀY TRONG 7 NGÀY QUA');
    expect(calls.fillText).toContain('Đã mở khóa 2 / 6 cột mốc (từ trước đến nay)');
    expect(calls.fillText).toContain('Th');
    expect(calls.fillText).toContain('CN');
    expect(calls.fillText).not.toContain('Mo');
  });

  it('omits a field entirely when the selection turns it off', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, {
      data: recap(), selection: { ...defaultWeeklyRecapSelection(), totalXp: false, heatmap: false, milestones: false },
      caption: '', milestones: { unlocked: 2, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', locale: 'en', copy: englishCopy, theme,
    });

    expect(calls.fillText).not.toContain('150');
    expect(calls.fillText.some(text => text.includes('milestones unlocked'))).toBe(false);
    // Background fillRect only; no heatmap day cells were drawn.
    expect(calls.fillRect).toBe(1);
  });

  it('keeps reviewed count in parity with its selection toggle', () => {
    const selected = createMockContext();
    drawWeeklyRecapCard(selected.context, {
      data: recap({ reviewedCount: 14 }), selection: defaultWeeklyRecapSelection(), caption: '',
      milestones: { unlocked: 2, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', locale: 'en', copy: englishCopy, theme,
    });
    expect(selected.calls.fillText).toContain('14');
    expect(selected.calls.fillText).toContain('Reviews this week');

    const omitted = createMockContext();
    drawWeeklyRecapCard(omitted.context, {
      data: recap({ reviewedCount: 14 }), selection: { ...defaultWeeklyRecapSelection(), reviewed: false }, caption: '',
      milestones: { unlocked: 2, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', locale: 'en', copy: englishCopy, theme,
    });

    expect(omitted.calls.fillText).not.toContain('14');
    expect(omitted.calls.fillText).not.toContain('Reviews this week');
  });

  it('exports reviews without showing zero XP activity metrics', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, {
      data: recap({ totalXp: 0, activeDays: 0, bestDay: null, reviewedCount: 9 }),
      selection: defaultWeeklyRecapSelection(), caption: '',
      milestones: { unlocked: 2, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', locale: 'en', copy: englishCopy, theme,
    });
    expect(calls.fillText).toContain('9');
    expect(calls.fillText).toContain('Reviews this week');
    expect(calls.fillText).not.toContain('XP THIS WEEK');
    expect(calls.fillText.some(text => text.includes('active days'))).toBe(false);
    expect(calls.fillText).not.toContain('DAILY XP');
  });

  it('does not export unchecked metrics through the automatic caption', () => {
    const reviewOnly = recap({ totalXp: 0, activeDays: 0, bestDay: null, reviewedCount: 9 });
    const selection = { ...defaultWeeklyRecapSelection(), reviewed: false };
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, {
      data: reviewOnly, selection, caption: buildSuggestedWeeklyRecapCaption(reviewOnly, selection),
      milestones: { unlocked: 2, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', locale: 'en', copy: englishCopy, theme,
    });
    expect(calls.fillText).not.toContain('9');
    expect(calls.fillText).not.toContain('9 reviews this week.');

    const xpWeek = recap();
    const withoutXp = { ...defaultWeeklyRecapSelection(), totalXp: false, activeDays: false };
    const xpOutput = createMockContext();
    drawWeeklyRecapCard(xpOutput.context, {
      data: xpWeek, selection: withoutXp, caption: buildSuggestedWeeklyRecapCaption(xpWeek, withoutXp),
      milestones: { unlocked: 2, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', locale: 'en', copy: englishCopy, theme,
    });
    expect(xpOutput.calls.fillText).not.toContain('150 XP and 3 active days this week.');
    expect(xpOutput.calls.fillText).not.toContain('150');
    expect(xpOutput.calls.fillText).not.toContain('3 / 7 active days');
  });

  it('omits unavailable reviewed counts from the shared image', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, {
      data: recap(), selection: defaultWeeklyRecapSelection(), caption: '',
      milestones: { unlocked: 2, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', locale: 'en', copy: englishCopy, theme,
    });

    expect(calls.fillText).not.toContain('14');
    expect(calls.fillText).not.toContain('Reviews this week');
  });

  it('never draws an empty caption line', () => {
    const { context, calls } = createMockContext();
    drawWeeklyRecapCard(context, {
      data: recap({ hasActivity: false, totalXp: 0 }), selection: defaultWeeklyRecapSelection(), caption: '   ',
      milestones: { unlocked: 0, total: 6 }, dateRangeLabel: 'Sep 21 – Sep 27', locale: 'en', copy: englishCopy, theme,
    });

    expect(calls.fillText.join(' ')).toContain(englishCopy.privacy);
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
      dateRangeLabel: 'Sep 21 – Sep 27', locale: 'en', copy: englishCopy, theme,
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
      dateRangeLabel: 'Sep 21 – Sep 27', locale: 'en', copy: englishCopy, theme,
    }, () => canvas)).rejects.toBeInstanceOf(WeeklyRecapExportUnavailableError);
  });
});

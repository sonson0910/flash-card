import { describe, expect, it, vi } from 'vitest';
import type { WeeklyRecapExportTheme } from '../weeklyRecap/weeklyRecapExport';
import { drawRevealShareCard, renderRevealSharePng, shareRevealCard, type RevealShareCard } from './revealShareImage';

const theme: WeeklyRecapExportTheme = {
  background: '#0b1220', text: '#f5f7fb', textMuted: '#9aa5b8', brand: '#38bdf8',
  heatLevels: ['#111827', '#164e63', '#0e7490', '#0891b2', '#22d3ee'],
};

const tierCard: RevealShareCard = {
  kicker: 'Tier up', label: 'noun', hero: 'Instant', heroDetail: 'Khoảnh khắc',
  move: { from: 'New', to: 'Mastered' }, title: 'Mastered',
  description: 'This card is now mastered. Review it again when it is due.', chips: [],
};

const streakCard: RevealShareCard = {
  kicker: 'Streak milestone', label: null, hero: '30', heroDetail: null, move: null, title: '30-day streak',
  description: 'A full month of study. You earned 1 streak freeze, so one missed day will not break the chain. You now hold 2.',
  chips: ['+1 streak freeze', '+100 XP', 'Badge · Web Wanderer'],
};

/** Text is as wide as half its font size per character, so a smaller font measures narrower. */
function createMockContext() {
  const drawn: Array<{ text: string; font: string }> = [];
  const context = {
    font: '',
    fillStyle: '',
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(function (this: { font: string }, text: string) { drawn.push({ text, font: this.font }); }),
    measureText: vi.fn(function (this: { font: string }, text: string) {
      const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 20);
      return { width: text.length * size * .5 };
    }),
  };
  return { context: context as unknown as CanvasRenderingContext2D, drawn };
}

const words = (drawn: Array<{ text: string }>) => drawn.map(({ text }) => text).join(' ');

describe('drawRevealShareCard', () => {
  it('draws only what the tier-up reveal shows', () => {
    const { context, drawn } = createMockContext();
    drawRevealShareCard(context, tierCard, theme, 'en');

    expect(drawn[0].text).toBe('SONFLASH · TIER UP');
    expect(drawn.map(({ text }) => text)).toEqual(expect.arrayContaining(['NOUN', 'Instant', 'Khoảnh khắc', 'New', 'Mastered']));
    expect(words(drawn)).toContain('This card is now mastered. Review it again when it is due.');
    expect(words(drawn)).not.toMatch(/XP|streak|\d+%|rank/i);
  });

  it('draws the streak count, its sentence and the rewards the milestone reported', () => {
    const { context, drawn } = createMockContext();
    drawRevealShareCard(context, streakCard, theme, 'en');

    expect(drawn.map(({ text }) => text)).toEqual(expect.arrayContaining(['SONFLASH · STREAK MILESTONE', '30', '30-day streak', '+1 streak freeze', '+100 XP', 'Badge · Web Wanderer']));
    expect(words(drawn)).toContain('You now hold 2.');
  });

  it('shrinks a long headword to fit the card instead of running off it', () => {
    const { context, drawn } = createMockContext();
    drawRevealShareCard(context, { ...tierCard, hero: 'Responsibility' }, theme, 'en');

    const hero = drawn.find(({ text }) => text === 'Responsibility');
    expect(hero?.font).toMatch(/\b(\d+)px/);
    expect(Number(/(\d+)px/.exec(hero!.font)![1])).toBeLessThan(136);
  });

  it('shouts the title and the tier move in Crystal, as the reveal does on screen', () => {
    const { context, drawn } = createMockContext();
    drawRevealShareCard(context, tierCard, { ...theme, family: 'crystal' }, 'en');

    expect(drawn.map(({ text }) => text)).toEqual(expect.arrayContaining(['NEW', 'MASTERED']));
    expect(drawn.map(({ text }) => text)).not.toContain('Mastered');
  });
});

describe('shareRevealCard', () => {
  const createCanvas = (context: CanvasRenderingContext2D) => () => ({
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (done: (blob: Blob | null) => void) => done(new Blob(['png-bytes'], { type: 'image/png' })),
  }) as unknown as HTMLCanvasElement;

  it('hands the image to the share sheet under the reveal title, with no other request', async () => {
    const { context } = createMockContext();
    const share = vi.fn().mockResolvedValue(undefined);
    const outcome = await shareRevealCard(tierCard, {
      locale: 'en', filename: 'sonflash-tier-up.png', theme, createCanvas: createCanvas(context),
      deps: { share, canShare: () => true, triggerDownload: vi.fn() },
    });

    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'SonFlash · Tier up', text: 'Mastered' }));
    const file = (share.mock.calls[0][0] as { files: File[] }).files[0];
    expect(file.name).toBe('sonflash-tier-up.png');
    expect(file.type).toBe('image/png');
  });

  it('falls back to a download where the device cannot share or copy the image', async () => {
    const { context } = createMockContext();
    const triggerDownload = vi.fn();
    const outcome = await shareRevealCard(streakCard, {
      locale: 'en', filename: 'sonflash-streak.png', theme, createCanvas: createCanvas(context),
      deps: { share: undefined, canShare: () => false, triggerDownload },
    });

    expect(outcome).toBe('downloaded');
    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), 'sonflash-streak.png');
  });

  it('reports that the image could not be made when the browser has no 2D canvas', async () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    await expect(renderRevealSharePng(tierCard, 'en', theme, () => canvas)).rejects.toThrow();
  });
});

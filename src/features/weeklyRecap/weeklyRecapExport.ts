import { heatmapLevelForXp } from '../../components/stats/ActivityHeatmap';
import type { WeeklyRecapData } from './weeklyRecapModel';
import type { WeeklyRecapSelection } from './weeklyRecapSelection';

/**
 * Canvas-only PNG renderer (no image/html-to-canvas dependency). This module
 * is dynamically imported at export time — see `WeeklyRecapDialog` — so its
 * drawing code never lands in the initial bundle.
 */

export const WEEKLY_RECAP_EXPORT_WIDTH = 1080;
export const WEEKLY_RECAP_EXPORT_HEIGHT = 1350;

export interface WeeklyRecapExportTheme {
  readonly background: string;
  readonly text: string;
  readonly textMuted: string;
  readonly brand: string;
  readonly heatLevels: readonly [string, string, string, string, string];
}

export interface WeeklyRecapExportInput {
  readonly data: WeeklyRecapData;
  readonly selection: WeeklyRecapSelection;
  /** Already clamped by the caller; drawn verbatim. */
  readonly caption: string;
  readonly milestones: { readonly unlocked: number; readonly total: number };
  readonly dateRangeLabel: string;
  readonly theme: WeeklyRecapExportTheme;
}

export class WeeklyRecapExportUnavailableError extends Error {
  constructor() {
    super('Canvas 2D rendering is not available in this browser.');
    this.name = 'WeeklyRecapExportUnavailableError';
  }
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(/\s+/).filter(Boolean);
  let line = '';
  let cursorY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      context.fillText(line, x, cursorY);
      line = word;
      cursorY += lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line) context.fillText(line, x, cursorY);
}

/** Pure drawing pass; kept separate from canvas creation so tests can inject a mock 2D context. */
export function drawWeeklyRecapCard(context: CanvasRenderingContext2D, input: WeeklyRecapExportInput): void {
  const { data, selection, caption, milestones, dateRangeLabel, theme } = input;
  const width = WEEKLY_RECAP_EXPORT_WIDTH;
  const height = WEEKLY_RECAP_EXPORT_HEIGHT;
  const marginX = 72;

  context.clearRect(0, 0, width, height);
  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = theme.textMuted;
  context.font = '600 28px sans-serif';
  context.fillText('SONFLASH · WEEKLY RECAP', marginX, 96);

  context.fillStyle = theme.text;
  context.font = '800 48px sans-serif';
  context.fillText(dateRangeLabel, marginX, 160);

  let cursorY = 260;
  if (selection.totalXp) {
    context.fillStyle = theme.brand;
    context.font = '800 96px sans-serif';
    context.fillText(`${data.totalXp}`, marginX, cursorY);
    context.fillStyle = theme.textMuted;
    context.font = '600 32px sans-serif';
    context.fillText('XP THIS WEEK', marginX, cursorY + 56);
    cursorY += 140;
  }
  if (selection.activeDays) {
    context.fillStyle = theme.text;
    context.font = '700 40px sans-serif';
    context.fillText(`${data.activeDays} / ${data.days.length} active days`, marginX, cursorY);
    cursorY += 64;
  }
  if (selection.bestDay && data.bestDay) {
    context.fillStyle = theme.text;
    context.font = '700 40px sans-serif';
    context.fillText(`Best day: ${data.bestDay.dateKey} · ${data.bestDay.xp} XP`, marginX, cursorY);
    cursorY += 64;
  }
  if (selection.heatmap) {
    const cell = 64;
    const gap = 16;
    data.days.forEach((day, index) => {
      context.fillStyle = theme.heatLevels[heatmapLevelForXp(day.xp)];
      context.fillRect(marginX + index * (cell + gap), cursorY, cell, cell);
    });
    cursorY += cell + 48;
  }
  if (selection.milestones) {
    context.fillStyle = theme.text;
    context.font = '700 36px sans-serif';
    context.fillText(`${milestones.unlocked} / ${milestones.total} milestones unlocked (all-time)`, marginX, cursorY);
  }

  if (caption.trim()) {
    context.fillStyle = theme.text;
    context.font = '500 34px sans-serif';
    wrapText(context, caption.trim(), marginX, height - 220, width - marginX * 2, 44);
  }

  context.fillStyle = theme.textMuted;
  context.font = '500 22px sans-serif';
  context.fillText('Private words are never included unless you add them yourself.', marginX, height - 64);
}

export async function renderWeeklyRecapPng(
  input: WeeklyRecapExportInput,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): Promise<Blob> {
  const canvas = createCanvas();
  canvas.width = WEEKLY_RECAP_EXPORT_WIDTH;
  canvas.height = WEEKLY_RECAP_EXPORT_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new WeeklyRecapExportUnavailableError();
  drawWeeklyRecapCard(context, input);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new WeeklyRecapExportUnavailableError());
    }, 'image/png');
  });
}

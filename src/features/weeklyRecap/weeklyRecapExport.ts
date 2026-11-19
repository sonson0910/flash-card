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
  readonly cardBackground?: string;
  readonly cardBackgroundEnd?: string;
  readonly cardText?: string;
  readonly cardMuted?: string;
  readonly cardChip?: string;
  readonly cardAccent?: string;
  /** Selects the card's shapes and type treatment; classic when absent. */
  readonly family?: 'classic' | 'crystal';
  /** CSS font-family lists, so the image uses the same type as the card on screen. */
  readonly displayFont?: string;
  readonly bodyFont?: string;
}

export interface WeeklyRecapExportCopy {
  readonly weeklyRecap: string;
  readonly xpThisWeek: string;
  readonly reviewsThisWeek: string;
  readonly noStudyActivity: string;
  readonly activeDays: string;
  readonly bestDay: string;
  readonly dailyXp: string;
  readonly milestones: (unlocked: number, total: number) => string;
  readonly privacy: string;
}

export interface WeeklyRecapExportInput {
  readonly data: WeeklyRecapData;
  readonly selection: WeeklyRecapSelection;
  /** Already clamped by the caller; drawn verbatim. */
  readonly caption: string;
  readonly milestones: { readonly unlocked: number; readonly total: number };
  readonly dateRangeLabel: string;
  readonly locale: string;
  readonly copy: WeeklyRecapExportCopy;
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
): number {
  const words = text.split(/\s+/).filter(Boolean);
  let line = '';
  let cursorY = y;
  let lineCount = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      context.fillText(line, x, cursorY);
      lineCount += 1;
      line = word;
      cursorY += lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line) {
    context.fillText(line, x, cursorY);
    lineCount += 1;
  }
  return lineCount;
}

function fillPanel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
): void {
  context.fillStyle = fill;
  if (typeof context.beginPath !== 'function') return;
  context.beginPath();
  if (typeof context.roundRect === 'function') context.roundRect(x, y, width, height, radius);
  else if (typeof context.rect === 'function') context.rect(x, y, width, height);
  else return;
  context.fill();
}

/** A day cell: rounded in classic, slanted like the on-screen strip in Crystal; square without path support. */
function fillHeatCell(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  slanted: boolean,
): void {
  if (typeof context.beginPath !== 'function') {
    context.fillRect(x, y, size, size);
    return;
  }
  context.beginPath();
  if (slanted) {
    const lean = size * .14;
    context.moveTo(x + lean, y);
    context.lineTo(x + size, y);
    context.lineTo(x + size - lean, y + size);
    context.lineTo(x, y + size);
    context.closePath();
  } else if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, size, size, 12);
  } else {
    context.rect(x, y, size, size);
  }
  context.fill();
}

/** The fonts the card draws with, as canvas font shorthands. */
export function weeklyRecapExportFonts(theme: WeeklyRecapExportTheme) {
  const display = theme.displayFont ?? 'Georgia, serif';
  const body = theme.bodyFont ?? 'system-ui, sans-serif';
  const crystal = theme.family === 'crystal';
  const displayWeight = (classicWeight: number) => (crystal ? `italic 900` : `${classicWeight}`);
  return {
    kicker: `${crystal ? 'italic 800' : '700'} 28px ${crystal ? display : body}`,
    range: `${displayWeight(500)} 48px ${display}`,
    hero: `${displayWeight(300)} 136px ${display}`,
    heroLabel: `${displayWeight(400)} 34px ${display}`,
    metric: `${displayWeight(400)} 34px ${display}`,
    label: `600 22px ${body}`,
    weekday: `700 20px ${body}`,
    milestones: `700 32px ${body}`,
    caption: `600 34px ${body}`,
    empty: `600 34px ${body}`,
    privacy: `500 22px ${body}`,
  };
}

/** Waits briefly for the card fonts so the first export does not fall back to a default face. */
async function loadExportFonts(theme: WeeklyRecapExportTheme): Promise<void> {
  const fontSet = globalThis.document?.fonts;
  if (!fontSet || typeof fontSet.load !== 'function') return;
  const fonts = Object.values(weeklyRecapExportFonts(theme));
  const loaded = Promise.all(fonts.map(font => fontSet.load(font).catch(() => [])));
  await Promise.race([loaded, new Promise(resolve => setTimeout(resolve, 1500))]);
}

function fillBackdrop(context: CanvasRenderingContext2D, theme: WeeklyRecapExportTheme): void {
  const start = theme.cardBackground ?? theme.background;
  const end = theme.cardBackgroundEnd;
  if (end && end !== start && typeof context.createLinearGradient === 'function') {
    const gradient = context.createLinearGradient(0, 0, WEEKLY_RECAP_EXPORT_WIDTH, WEEKLY_RECAP_EXPORT_HEIGHT);
    gradient.addColorStop(0, start);
    gradient.addColorStop(1, end);
    context.fillStyle = gradient;
  } else {
    context.fillStyle = start;
  }
  context.fillRect(0, 0, WEEKLY_RECAP_EXPORT_WIDTH, WEEKLY_RECAP_EXPORT_HEIGHT);
}

/** Pure drawing pass; kept separate from canvas creation so tests can inject a mock 2D context. */
export function drawWeeklyRecapCard(context: CanvasRenderingContext2D, input: WeeklyRecapExportInput): void {
  const { data, selection, caption, milestones, dateRangeLabel, locale, copy, theme } = input;
  const width = WEEKLY_RECAP_EXPORT_WIDTH;
  const height = WEEKLY_RECAP_EXPORT_HEIGHT;
  const marginX = 72;
  const contentWidth = width - marginX * 2;
  const cardText = theme.cardText ?? theme.text;
  const cardMuted = theme.cardMuted ?? theme.textMuted;
  const cardChip = theme.cardChip ?? 'rgb(255 255 255 / .06)';
  const cardAccent = theme.cardAccent ?? theme.brand;
  const exportLocale = locale === 'pseudo' ? 'en' : locale || 'en';
  const uppercase = (value: string) => value.toLocaleUpperCase(exportLocale);
  const fonts = weeklyRecapExportFonts(theme);
  const setTextStyle = (fill: string, font: string) => Object.assign(context, { fillStyle: fill, font });
  const drawText = (text: string, y: number, fill: string, font: string, x = marginX) => {
    setTextStyle(fill, font);
    context.fillText(text, x, y);
  };

  context.clearRect(0, 0, width, height);
  fillBackdrop(context, theme);

  drawText(`SONFLASH · ${uppercase(copy.weeklyRecap)}`, 96, cardMuted, fonts.kicker);
  drawText(dateRangeLabel, 160, cardText, fonts.range);

  // Keep the large XP baseline below the date range's rendered box. A 136px
  // font reaches well above its baseline, so a small baseline delta still
  // overlaps the 48px date line.
  let cursorY = 320;
  if (selection.totalXp && data.totalXp > 0) {
    drawText(`${data.totalXp}`, cursorY, cardText, fonts.hero);
    drawText(theme.family === 'crystal' ? uppercase(copy.xpThisWeek) : copy.xpThisWeek, cursorY + 58, cardAccent, fonts.heroLabel);
    cursorY += 176;
  } else if (!data.hasActivity) {
    setTextStyle(cardMuted, fonts.empty);
    const lineCount = wrapText(context, copy.noStudyActivity, marginX, cursorY, contentWidth, 44);
    cursorY += Math.max(74, lineCount * 44 + 30);
  }

  const metricItems: Array<{ value: string; label: string }> = [];
  if (selection.activeDays && data.totalXp > 0) {
    metricItems.push({ value: `${data.activeDays} / ${data.days.length} ${copy.activeDays}`, label: '' });
  }
  if (selection.reviewed && typeof data.reviewedCount === 'number') {
    metricItems.push({ value: `${data.reviewedCount}`, label: copy.reviewsThisWeek });
  }
  if (selection.bestDay && data.bestDay && data.totalXp > 0) {
    metricItems.push({ value: `${data.bestDay.xp} XP`, label: `${copy.bestDay} · ${data.bestDay.dateKey}` });
  }
  if (metricItems.length > 0) {
    const gap = 16;
    const tileWidth = (contentWidth - gap * (metricItems.length - 1)) / metricItems.length;
    metricItems.forEach((metric, index) => {
      const x = marginX + index * (tileWidth + gap);
      fillPanel(context, x, cursorY, tileWidth, 92, 14, cardChip);
      drawText(metric.value, cursorY + 39, cardText, fonts.metric, x + 18);
      if (metric.label) {
        drawText(metric.label, cursorY + 70, cardMuted, fonts.label, x + 18);
      }
    });
    cursorY += 124;
  }

  if (selection.heatmap && data.totalXp > 0) {
    const cell = 64;
    const gap = 16;
    drawText(uppercase(copy.dailyXp), cursorY, cardMuted, fonts.label);
    cursorY += 34;
    data.days.forEach((day, index) => {
      context.fillStyle = theme.heatLevels[heatmapLevelForXp(day.xp)];
      fillHeatCell(context, marginX + index * (cell + gap), cursorY, cell, theme.family === 'crystal');
      const weekday = new Date(`${day.dateKey}T12:00:00`).toLocaleDateString(exportLocale, { weekday: 'narrow' });
      drawText(weekday, cursorY + cell + 30, cardMuted, fonts.weekday, marginX + index * (cell + gap) + 24);
    });
    cursorY += cell + 64;
  }
  if (selection.milestones) {
    drawText(copy.milestones(milestones.unlocked, milestones.total), cursorY, cardText, fonts.milestones);
    cursorY += 64;
  }

  if (caption.trim()) {
    setTextStyle(cardText, fonts.caption);
    wrapText(context, caption.trim(), marginX, height - 220, contentWidth, 44);
  }

  setTextStyle(cardMuted, fonts.privacy);
  wrapText(context, copy.privacy, marginX, height - 90, contentWidth, 28);
}

function pngBlobFromDataUrl(canvas: HTMLCanvasElement): Blob | null {
  if (typeof canvas.toDataURL !== 'function' || typeof atob !== 'function') return null;
  const dataUrl = canvas.toDataURL('image/png');
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) return null;
  const binary = atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: 'image/png' });
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
  await loadExportFonts(input.theme);
  drawWeeklyRecapCard(context, input);
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const retain: unknown[] = [canvas, context];
    const fallbackTimer = typeof canvas.toDataURL === 'function'
      ? setTimeout(() => {
          if (settled) return;
          try {
            const fallbackBlob = pngBlobFromDataUrl(canvas);
            if (fallbackBlob) {
              settled = true;
              retain.length = 0;
              resolve(fallbackBlob);
            }
          } catch {
            // Let the primary toBlob callback report any failure.
          }
        }, 250)
      : undefined;
    canvas.toBlob(blob => {
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
      retain.length = 0;
      if (settled) return;
      settled = true;
      if (blob) resolve(blob);
      else reject(new WeeklyRecapExportUnavailableError());
    }, 'image/png');
  });
}

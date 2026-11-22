import type { WeeklyRecapCardContent } from './weeklyRecapCard';

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
  readonly privacy: string;
}

export interface WeeklyRecapExportInput {
  /** The same content the card on screen shows, so the image never adds a field. */
  readonly content: WeeklyRecapCardContent;
  /** Already clamped by the caller; drawn verbatim. */
  readonly caption: string;
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
    metric: `${displayWeight(400)} 44px ${display}`,
    label: `600 22px ${body}`,
    weekday: `700 20px ${body}`,
    word: `${displayWeight(400)} 48px ${display}`,
    garden: `${displayWeight(400)} 40px ${display}`,
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
  const { content, caption, dateRangeLabel, locale, copy, theme } = input;
  const width = WEEKLY_RECAP_EXPORT_WIDTH;
  const height = WEEKLY_RECAP_EXPORT_HEIGHT;
  const marginX = 72;
  const contentWidth = width - marginX * 2;
  const crystal = theme.family === 'crystal';
  const cardText = theme.cardText ?? theme.text;
  const cardMuted = theme.cardMuted ?? theme.textMuted;
  const cardChip = theme.cardChip ?? 'rgb(255 255 255 / .06)';
  const cardAccent = theme.cardAccent ?? theme.brand;
  const exportLocale = locale === 'pseudo' ? 'en' : locale || 'en';
  const uppercase = (value: string) => value.toLocaleUpperCase(exportLocale);
  const shout = (value: string) => (crystal ? uppercase(value) : value);
  const fonts = weeklyRecapExportFonts(theme);
  const setTextStyle = (fill: string, font: string) => Object.assign(context, { fillStyle: fill, font });
  const drawText = (text: string, y: number, fill: string, font: string, x = marginX) => {
    setTextStyle(fill, font);
    context.fillText(text, x, y);
  };
  const textWidth = (text: string) => (typeof context.measureText === 'function' ? context.measureText(text).width : text.length * 18);

  context.clearRect(0, 0, width, height);
  fillBackdrop(context, theme);

  drawText(`SONFLASH · ${uppercase(content.kicker)}`, 96, cardMuted, fonts.kicker);
  drawText(shout(dateRangeLabel), 160, cardText, fonts.range);

  // Keep the large hero baseline below the date range's rendered box. A 136px
  // font reaches well above its baseline, so a small baseline delta still
  // overlaps the 48px date line.
  let cursorY = 320;
  if (content.empty !== null) {
    setTextStyle(cardMuted, fonts.empty);
    const lineCount = wrapText(context, content.empty, marginX, cursorY, contentWidth, 44);
    cursorY += Math.max(74, lineCount * 44 + 30);
  } else if (content.hero) {
    const { label } = content.hero;
    if (content.hero.value !== null) {
      drawText(content.hero.value, cursorY, cardText, fonts.hero);
      cursorY += 58;
    }
    // The label's emphasised run takes the accent, as on screen.
    let x = marginX;
    for (const [run, fill] of [[label.before, cardText], [label.em, cardAccent], [label.after, cardText]] as const) {
      if (!run) continue;
      drawText(shout(run), cursorY, fill, fonts.heroLabel, x);
      x += textWidth(shout(run));
    }
    cursorY += 118;
  }

  if (content.chips.length > 0) {
    const gap = 16;
    const columns = 3;
    const tileWidth = (contentWidth - gap * (columns - 1)) / columns;
    content.chips.forEach((chip, index) => {
      const x = marginX + index * (tileWidth + gap);
      fillPanel(context, x, cursorY, tileWidth, 104, 14, cardChip);
      drawText(chip.value, cursorY + 50, cardText, fonts.metric, x + 20);
      drawText(shout(chip.label), cursorY + 84, cardMuted, fonts.label, x + 20);
    });
    cursorY += 136;
  }

  if (content.wordOfWeek) {
    fillPanel(context, marginX, cursorY, contentWidth, 96, 14, cardChip);
    drawText(uppercase(content.wordOfWeek.label), cursorY + 42, cardMuted, fonts.label, marginX + 24);
    drawText(content.wordOfWeek.detail, cursorY + 74, cardMuted, fonts.label, marginX + 24);
    setTextStyle(cardText, fonts.word);
    const wordWidth = textWidth(content.wordOfWeek.word);
    context.fillText(content.wordOfWeek.word, marginX + contentWidth - 24 - wordWidth, cursorY + 64);
    cursorY += 128;
  }

  if (content.heatmap) {
    const gap = 16;
    const cell = Math.min(112, (contentWidth - gap * 6) / 7);
    content.heatmap.forEach((day, index) => {
      const x = marginX + index * (cell + gap);
      // Days still to come are drawn empty: the chip tint, never a heat step.
      context.fillStyle = day.future ? cardChip : theme.heatLevels[day.level];
      fillHeatCell(context, x, cursorY, cell, crystal);
      drawText(day.initial, cursorY + cell + 30, cardMuted, fonts.weekday, x + cell / 2 - 7);
    });
    cursorY += cell + 64;
  }

  if (crystal && content.garden) {
    drawText(uppercase(content.garden.label), cursorY, cardMuted, fonts.label);
    cursorY += 20;
    const gap = 16;
    const tileWidth = (contentWidth - gap) / 2;
    content.garden.cells.forEach((cell, index) => {
      const x = marginX + index * (tileWidth + gap);
      fillPanel(context, x, cursorY, tileWidth, 84, 8, cardChip);
      drawText(uppercase(`${cell.from} → ${cell.to}`), cursorY + 52, cardText, fonts.label, x + 20);
      setTextStyle(cardText, fonts.garden);
      context.fillText(cell.count, x + tileWidth - 20 - textWidth(cell.count), cursorY + 56);
    });
    cursorY += 116;
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

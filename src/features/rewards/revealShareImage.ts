import {
  WEEKLY_RECAP_EXPORT_HEIGHT as CARD_HEIGHT,
  WEEKLY_RECAP_EXPORT_WIDTH as CARD_WIDTH,
  WeeklyRecapExportUnavailableError,
  canvasToPngBlob,
  loadWeeklyRecapExportFonts,
  weeklyRecapExportFonts,
  type WeeklyRecapExportTheme,
} from '../weeklyRecap/weeklyRecapExport';
import { shareWeeklyRecapPng, type WeeklyRecapShareDeps, type WeeklyRecapShareOutcome } from '../weeklyRecap/weeklyRecapShare';
import { resolveWeeklyRecapExportTheme } from '../weeklyRecap/weeklyRecapTheme';

/**
 * The reward reveal as a shareable PNG, made the way the weekly recap makes its card: drawn on a
 * canvas on the device with the weekly card's size, fonts and theme palette, then handed to Web
 * Share, the clipboard or a download. Nothing leaves the device unless the learner shares it, and
 * no server is called. This module is imported only when the learner asks to share.
 */

/** The reveal's own values, already translated; the image draws these and nothing else. */
export interface RevealShareCard {
  readonly kicker: string;
  /** The word class above the headword. */
  readonly label: string | null;
  /** The large figure: the card's headword or the streak's day count. */
  readonly hero: string | null;
  /** The card's translation, under the headword. */
  readonly heroDetail: string | null;
  /** The tier the card moved from and to. */
  readonly move: { readonly from: string; readonly to: string } | null;
  readonly title: string;
  readonly description: string;
  readonly chips: readonly string[];
}

const MARGIN_X = 72;
const CONTENT_WIDTH = CARD_WIDTH - MARGIN_X * 2;

const sized = (font: string, size: number) => font.replace(/\d+px/, `${size}px`);

function fillPanel(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, fill: string): void {
  context.fillStyle = fill;
  if (typeof context.beginPath !== 'function') return;
  context.beginPath();
  if (typeof context.roundRect === 'function') context.roundRect(x, y, width, height, radius);
  else if (typeof context.rect === 'function') context.rect(x, y, width, height);
  else return;
  context.fill();
}

/** Pure drawing pass, so tests can pass a mock 2D context. */
export function drawRevealShareCard(context: CanvasRenderingContext2D, card: RevealShareCard, theme: WeeklyRecapExportTheme, locale: string): void {
  const crystal = theme.family === 'crystal';
  const cardText = theme.cardText ?? theme.text;
  const cardMuted = theme.cardMuted ?? theme.textMuted;
  const cardChip = theme.cardChip ?? 'rgb(255 255 255 / .06)';
  const cardAccent = theme.cardAccent ?? theme.brand;
  const exportLocale = locale === 'pseudo' ? 'en' : locale || 'en';
  const uppercase = (value: string) => value.toLocaleUpperCase(exportLocale);
  const shout = (value: string) => (crystal ? uppercase(value) : value);
  const fonts = weeklyRecapExportFonts(theme);
  const measure = (text: string) => (typeof context.measureText === 'function' ? context.measureText(text).width : text.length * 18);
  // The content is laid out once without painting to measure it, then painted centred on the card.
  let painting = true;
  const drawText = (text: string, baseline: number, fill: string, font: string, x = MARGIN_X) => {
    if (!painting) return;
    Object.assign(context, { fillStyle: fill, font });
    context.fillText(text, x, baseline);
  };
  const panel = (x: number, y: number, width: number, height: number, radius: number) => {
    if (painting) fillPanel(context, x, y, width, height, radius, cardChip);
  };
  /** Breaks text into lines of the content width; the last kept line ends with an ellipsis when text is cut. */
  const lines = (text: string, font: string, maxLines: number): string[] => {
    context.font = font;
    const result: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > CONTENT_WIDTH) {
        result.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) result.push(line);
    if (result.length <= maxLines) return result;
    const kept = result.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
    return kept;
  };
  const drawLines = (text: string, top: number, fill: string, font: string, size: number, lineHeight: number, maxLines: number) => {
    const rows = lines(text, font, maxLines);
    rows.forEach((row, index) => drawText(row, top + size * .8 + index * lineHeight, fill, font));
    return top + rows.length * lineHeight;
  };

  context.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const start = theme.cardBackground ?? theme.background;
  const end = theme.cardBackgroundEnd;
  if (end && end !== start && typeof context.createLinearGradient === 'function') {
    const gradient = context.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    gradient.addColorStop(0, start);
    gradient.addColorStop(1, end);
    context.fillStyle = gradient;
  } else {
    context.fillStyle = start;
  }
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  drawText(`SONFLASH · ${uppercase(card.kicker)}`, 96, cardMuted, fonts.kicker);

  const content = (start: number): number => {
    let cursor = start;
    if (card.label) cursor = drawLines(uppercase(card.label), cursor, cardMuted, fonts.label, 22, 40, 1);
    if (card.hero) {
      // The headword keeps one line by shrinking; only a long phrase wraps, at the smallest size.
      let size = 136;
      while (size > 72) {
        context.font = sized(fonts.hero, size);
        if (measure(card.hero) <= CONTENT_WIDTH) break;
        size -= 8;
      }
      cursor = drawLines(card.hero, cursor, cardText, sized(fonts.hero, size), size, Math.round(size * 1.08), 2);
    }
    if (card.heroDetail) cursor = drawLines(card.heroDetail, cursor + 4, cardMuted, fonts.heroLabel, 34, 48, 2);
    if (card.move) {
      const moveFont = sized(fonts.label, 26);
      const from = shout(card.move.from);
      const to = shout(card.move.to);
      const arrow = '  →  ';
      context.font = moveFont;
      const width = measure(from) + measure(arrow) + measure(to) + 48;
      const top = cursor + 24;
      panel(MARGIN_X, top, Math.min(width, CONTENT_WIDTH), 64, crystal ? 4 : 14);
      let x = MARGIN_X + 24;
      for (const [run, fill] of [[from, cardMuted], [arrow, cardMuted], [to, cardAccent]] as const) {
        drawText(run, top + 42, fill, moveFont, x);
        x += measure(run);
      }
      cursor = top + 64;
    }

    cursor = drawLines(shout(card.title), cursor + 56, cardAccent, fonts.range, 48, 60, 2);
    cursor = drawLines(card.description, cursor + 24, cardText, fonts.caption, 34, 46, 6);

    if (card.chips.length > 0) {
      const chipFont = fonts.label;
      const gap = 12;
      const height = 56;
      let x = MARGIN_X;
      let top = cursor + 36;
      let row = 0;
      context.font = chipFont;
      for (const chip of card.chips) {
        const label = shout(chip);
        const width = Math.min(measure(label) + 48, CONTENT_WIDTH);
        if (x > MARGIN_X && x + width > MARGIN_X + CONTENT_WIDTH) {
          row += 1;
          if (row > 1) break;
          x = MARGIN_X;
          top += height + gap;
        }
        panel(x, top, width, height, crystal ? 4 : height / 2);
        drawText(label, top + 36, cardText, chipFont, x + 24);
        x += width + gap;
      }
      cursor = top + height;
    }
    return cursor;
  };

  // Between the kicker and a bottom margin of the same size, the content sits in the middle.
  const regionTop = 176;
  const regionBottom = CARD_HEIGHT - 120;
  painting = false;
  const used = content(regionTop) - regionTop;
  painting = true;
  content(regionTop + Math.max(0, Math.round((regionBottom - regionTop - used) / 2)));
}

export async function renderRevealSharePng(
  card: RevealShareCard,
  locale: string,
  theme: WeeklyRecapExportTheme = resolveWeeklyRecapExportTheme(),
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): Promise<Blob> {
  const canvas = createCanvas();
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new WeeklyRecapExportUnavailableError();
  await loadWeeklyRecapExportFonts(theme);
  drawRevealShareCard(context, card, theme, locale);
  return canvasToPngBlob(canvas);
}

/** Draws the reveal and delivers it through the weekly recap's share path, under the reveal's own title. */
export async function shareRevealCard(
  card: RevealShareCard,
  options: {
    readonly locale: string;
    readonly filename: string;
    readonly deps?: WeeklyRecapShareDeps;
    readonly theme?: WeeklyRecapExportTheme;
    readonly createCanvas?: () => HTMLCanvasElement;
  },
): Promise<WeeklyRecapShareOutcome> {
  const blob = await renderRevealSharePng(card, options.locale, options.theme, options.createCanvas);
  return shareWeeklyRecapPng(blob, options.filename, card.title, options.deps, `SonFlash · ${card.kicker}`);
}

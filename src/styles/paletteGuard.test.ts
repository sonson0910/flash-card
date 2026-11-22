import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The palette and the font families live in the theme token stylesheets (themes/classic.css,
// public/theme-crystal.css and app-bootstrap.css). The stylesheets below take every colour and
// font family from those --sf-* tokens, so a theme change reaches them without a local copy.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const section = (css: string, startMarker: string, endMarker?: string) => {
  const start = css.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing the "${startMarker}" section.`);
  if (!endMarker) return css.slice(start);
  const end = css.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Missing the end of the "${startMarker}" section.`);
  return css.slice(start, end + endMarker.length);
};

const flashcardCanvas = read('../components/flashcard/flashcard-canvas.css');
const flashcardEffects = read('./flashcard-effects.css');

// The language-pack card runs from its section comment to the end of the canvas stylesheet.
const languageCard = section(flashcardCanvas, 'Language-pack card (Korean, Japanese, Chinese)');
// The Crystal tier label and reveal button rules, up to the end of the reveal button rule.
const crystalTierLabel = section(flashcardEffects, 'Crystal label and reveal button.', '  font-size: 0.875rem;\n}');

const colourSheets: Record<string, string> = {
  'stats-board.css': read('../components/stats/stats-board.css'),
  'achievements-board.css': read('../components/stats/achievements-board.css'),
  'web-words.css': read('../features/webWords/web-words.css'),
  'catalog-workspace.css': read('../features/catalogWorkspace/catalog-workspace.css'),
  'the language card in flashcard-canvas.css': languageCard,
  'the Crystal tier label in flashcard-effects.css': crystalTierLabel,
};

// The language card is left out: its Noto CJK faces have no theme font token.
const fontSheets: Record<string, string> = {
  'landing-page.css': read('../features/landing/landing-page.css'),
  'empty-library-panel.css': read('../features/library/empty-library-panel.css'),
  'today-ready-hero.css': read('../features/dailyLearning/today-ready-hero.css'),
  'streak-dialog.css': read('../features/dailyLearning/streak-dialog.css'),
  'catalog-workspace.css': colourSheets['catalog-workspace.css'],
  'stats-board.css': colourSheets['stats-board.css'],
  'achievements-board.css': colourSheets['achievements-board.css'],
  'web-words.css': colourSheets['web-words.css'],
  'the Crystal tier label in flashcard-effects.css': crystalTierLabel,
};

const paletteLiteral = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black)(?![\w-])/gi;
const fontName = /(?<![\w-])(?:Fraunces|Geist|Kanit|Nunito|Georgia|Inter|Playfair|Instrument|Noto|Segoe|Roboto|Helvetica|Arial|serif|sans-serif|monospace|ui-monospace|system-ui)(?![\w-])/g;
const fontTokenFallback = /var\(--sf-font-[\w-]+\s*,/g;

describe('theme token stylesheets', () => {
  it.each(Object.entries(colourSheets))('%s takes every colour from a theme token', (_, css) => {
    expect(withoutComments(css).match(paletteLiteral) ?? []).toEqual([]);
  });

  it.each(Object.entries(fontSheets))('%s names no font family directly', (_, css) => {
    const declarations = withoutComments(css);
    expect(declarations.match(fontName) ?? []).toEqual([]);
    expect(declarations.match(fontTokenFallback) ?? []).toEqual([]);
  });

  it('catches the literals it is meant to keep out', () => {
    expect('a { color: #fbf6ec; background: rgb(0 0 0 / .5); border-color: white; }'.match(paletteLiteral)).toHaveLength(3);
    expect('a { white-space: nowrap; background: color-mix(in srgb, var(--sf-flare) 8%, transparent); }'.match(paletteLiteral)).toBeNull();
    expect('a { font-family: var(--sf-font-display, Fraunces, Georgia, serif); }'.match(fontName)).toHaveLength(3);
    expect('a { --td-serif: var(--sf-font-display); font-family: var(--td-serif); }'.match(fontName)).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import canvasTokens from '../../../docs/design/sonflash-redesign/canvas/tokens.json';

const classic = readFileSync(new URL('../../styles/themes/classic.css', import.meta.url), 'utf8');
const crystal = readFileSync(new URL('../../../public/theme-crystal.css', import.meta.url), 'utf8');

const declarations = (stylesheet: string, selector: string) => {
  const start = stylesheet.indexOf(selector);
  const bodyStart = stylesheet.indexOf('{', start);
  const bodyEnd = stylesheet.indexOf('}', bodyStart);
  if (start < 0 || bodyStart < 0 || bodyEnd < 0) throw new Error(`Missing ${selector}.`);
  return Object.fromEntries([...stylesheet.slice(bodyStart + 1, bodyEnd).matchAll(/(--[\w-]+):\s*([^;]+);/g)]
    .map(([, token, value]) => [token, value.trim()]));
};

const sourceValue = (tokens: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((value, key) => {
  if (Array.isArray(value)) return value[Number(key)];
  return (value as Record<string, unknown>)[key];
}, tokens);

const mappings: Record<string, Record<string, string>> = {
  'classic-light': {
    '--sf-canvas': 'pageBg', '--sf-surface': 'surfaceSolid', '--sf-surface-raised': 'chipBg', '--sf-surface-muted': 'chipBg',
    '--sf-text': 'text', '--sf-text-muted': 'text2', '--sf-border': 'line', '--sf-brand': 'accent', '--sf-brand-hover': 'accentText', '--sf-brand-text': 'accentText',
    '--sf-on-brand': 'primaryText', '--sf-on-brand-hover': 'primaryText', '--sf-reward': 'gold', '--sf-success': 'good', '--sf-danger': 'danger',
    '--sf-surface-glass': 'surface', '--sf-surface-control': 'inputBg', '--sf-edge-highlight': 'lineStrong', '--sf-panel-shadow': 'surfaceShadow', '--sf-second': 'second',
    '--sf-rim-new': 'rimNew', '--sf-rim-learning': 'rimLearning', '--sf-gold-rim': 'goldRim', '--sf-card-bg': 'cardBg', '--sf-dialog-bg': 'dlgBg', '--sf-scrim': 'scrim',
    '--sf-grain-blend': 'grainBlend', '--sf-grain-opacity': 'grainOpacity', '--sf-rating-again': 'again', '--sf-rating-hard': 'hard', '--sf-rating-good': 'good', '--sf-rating-easy': 'warn',
    '--sf-heat-0': 'heat.0', '--sf-heat-1': 'heat.1', '--sf-heat-2': 'heat.2', '--sf-heat-3': 'heat.3', '--sf-heat-4': 'heat.4',
    '--sf-confetti-0': 'confetti.0', '--sf-confetti-1': 'confetti.1', '--sf-confetti-2': 'confetti.2', '--sf-confetti-3': 'confetti.3', '--sf-confetti-4': 'confetti.4',
  },
  'classic-dark': {
    '--sf-canvas': 'pageBg', '--sf-surface': 'surfaceSolid', '--sf-surface-raised': 'chipBg', '--sf-surface-muted': 'chipBg',
    '--sf-text': 'text', '--sf-text-muted': 'text2', '--sf-border': 'line', '--sf-brand': 'accent', '--sf-brand-hover': 'accentText', '--sf-brand-text': 'accentText',
    '--sf-on-brand': 'primaryText', '--sf-on-brand-hover': 'primaryText', '--sf-reward': 'gold', '--sf-success': 'good', '--sf-danger': 'danger',
    '--sf-surface-glass': 'surface', '--sf-surface-control': 'inputBg', '--sf-edge-highlight': 'lineStrong', '--sf-panel-shadow': 'surfaceShadow', '--sf-second': 'second',
    '--sf-rim-new': 'rimNew', '--sf-rim-learning': 'rimLearning', '--sf-gold-rim': 'goldRim', '--sf-card-bg': 'cardBg', '--sf-dialog-bg': 'dlgBg', '--sf-scrim': 'scrim',
    '--sf-grain-blend': 'grainBlend', '--sf-grain-opacity': 'grainOpacity', '--sf-rating-again': 'again', '--sf-rating-hard': 'hard', '--sf-rating-good': 'good', '--sf-rating-easy': 'warn',
    '--sf-heat-0': 'heat.0', '--sf-heat-1': 'heat.1', '--sf-heat-2': 'heat.2', '--sf-heat-3': 'heat.3', '--sf-heat-4': 'heat.4',
    '--sf-confetti-0': 'confetti.0', '--sf-confetti-1': 'confetti.1', '--sf-confetti-2': 'confetti.2', '--sf-confetti-3': 'confetti.3', '--sf-confetti-4': 'confetti.4',
  },
  'crystal-light': {
    '--sf-canvas': 'pageBg', '--sf-surface': 'panelSolid', '--sf-surface-raised': 'chip', '--sf-surface-muted': 'chip', '--sf-text': 'text', '--sf-text-muted': 'text2', '--sf-border': 'line',
    '--sf-brand': 'crimson', '--sf-brand-hover': 'crimsonDeep', '--sf-brand-text': 'crimsonText', '--sf-reward': 'gold', '--sf-success': 'good', '--sf-danger': 'crimsonText',
    '--sf-surface-glass': 'panel', '--sf-surface-control': 'chip', '--sf-edge-highlight': 'lineStrong', '--sf-panel-shadow': 'panelShadow', '--sf-second': 'holo', '--sf-rim-new': 'tier.new.rim', '--sf-rim-learning': 'tier.learning.rim', '--sf-gold-rim': 'tier.mastered.rim', '--sf-card-bg': 'cardBack', '--sf-dialog-bg': 'panel', '--sf-scrim': 'scrim',
    '--sf-rating-again': 'again', '--sf-rating-hard': 'hard', '--sf-rating-good': 'good', '--sf-rating-easy': 'easy', '--nk-chamfer': 'chamfer', '--nk-chamfer-sm': 'chamferSm', '--nk-snap': 'snap', '--nk-stars': 'stars', '--nk-wing-opacity': 'wingOpacity',
  },
  'crystal-dark': {
    '--sf-canvas': 'pageBg', '--sf-surface': 'panelSolid', '--sf-surface-raised': 'chip', '--sf-surface-muted': 'chip', '--sf-text': 'text', '--sf-text-muted': 'text2', '--sf-border': 'line',
    '--sf-brand': 'crimson', '--sf-brand-hover': 'crimsonDeep', '--sf-brand-text': 'crimsonText', '--sf-reward': 'gold', '--sf-success': 'good', '--sf-danger': 'crimsonText',
    '--sf-surface-glass': 'panel', '--sf-surface-control': 'chip', '--sf-edge-highlight': 'lineStrong', '--sf-panel-shadow': 'panelShadow', '--sf-second': 'holo', '--sf-rim-new': 'tier.new.rim', '--sf-rim-learning': 'tier.learning.rim', '--sf-gold-rim': 'tier.mastered.rim', '--sf-card-bg': 'cardFront', '--sf-dialog-bg': 'panel', '--sf-scrim': 'scrim',
    '--sf-rating-again': 'again', '--sf-rating-hard': 'hard', '--sf-rating-good': 'good', '--sf-rating-easy': 'easy', '--nk-chamfer': 'chamfer', '--nk-chamfer-sm': 'chamferSm', '--nk-snap': 'snap', '--nk-stars': 'stars', '--nk-wing-opacity': 'wingOpacity',
  },
};

const tokenSets = {
  'classic-light': declarations(classic, ':root[data-theme-family="classic"]'),
  'classic-dark': declarations(classic, ':root[data-theme-family="classic"].dark'),
  'crystal-light': declarations(crystal, ':root[data-theme-family="crystal"]'),
  'crystal-dark': declarations(crystal, ':root[data-theme-family="crystal"].dark'),
};

describe('Canvas token parity', () => {
  it('keeps the normalized variable set identical for every family and mode', () => {
    const expected = Object.keys(tokenSets['classic-light']).sort();
    for (const tokens of Object.values(tokenSets)) expect(Object.keys(tokens).sort()).toEqual(expected);
  });

  it.each(Object.keys(tokenSets) as Array<keyof typeof tokenSets>)('maps %s values from the Canvas source', name => {
    for (const [cssToken, sourcePath] of Object.entries(mappings[name])) {
      expect(tokenSets[name][cssToken]).toBe(String(sourceValue(canvasTokens[name], sourcePath)));
    }
  });

  it.each(Object.entries(tokenSets))('uses a color for %s shadow consumers', (_, tokens) => {
    expect(tokens['--sf-shadow']).toMatch(/^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\()/i);
  });
});

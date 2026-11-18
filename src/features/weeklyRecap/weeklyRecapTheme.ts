import type { WeeklyRecapExportTheme } from './weeklyRecapExport';

/**
 * Resolves the current theme's real CSS custom properties so the exported
 * PNG matches whatever the learner is actually looking at (Classic/Crystal,
 * light/dark), instead of a single hardcoded palette. Falls back to a
 * readable dark palette when a custom property cannot be resolved (for
 * example, outside a browser document).
 */
const FALLBACK_THEME: WeeklyRecapExportTheme = {
  background: '#0b1220',
  text: '#f5f7fb',
  textMuted: '#9aa5b8',
  brand: '#38bdf8',
  heatLevels: ['#111827', '#164e63', '#0e7490', '#0891b2', '#22d3ee'],
  cardBackground: '#1c2a21',
  cardBackgroundEnd: '#1c2a21',
  cardText: '#fbf6ec',
  cardMuted: '#aab3a6',
  cardChip: 'rgb(251 246 236 / .06)',
  cardAccent: '#e8a075',
};

const CARD_PALETTES = {
  classicLight: {
    cardBackground: '#1c2a21', cardBackgroundEnd: '#1c2a21', cardText: '#fbf6ec', cardMuted: '#aab3a6',
    cardChip: 'rgb(251 246 236 / .06)', cardAccent: '#e8a075',
    heatLevels: ['rgb(251 246 236 / .08)', 'rgb(232 160 117 / .3)', 'rgb(232 160 117 / .55)', '#e8a075', '#f3c7a4'] as const,
  },
  classicDark: {
    cardBackground: '#0f2a38', cardBackgroundEnd: '#07161f', cardText: '#f1f6f9', cardMuted: '#99a7b0',
    cardChip: 'rgb(255 255 255 / .05)', cardAccent: '#28d3f4',
    heatLevels: ['rgb(255 255 255 / .06)', 'rgb(40 211 244 / .3)', 'rgb(40 211 244 / .55)', '#28d3f4', '#7ee6fa'] as const,
  },
  crystalLight: {
    cardBackground: '#f7fcff', cardBackgroundEnd: '#cfe9ff', cardText: '#081329', cardMuted: '#3f5272',
    cardChip: 'rgb(255 255 255 / .6)', cardAccent: '#e0173f',
    heatLevels: ['rgb(13 40 80 / .1)', 'rgb(26 167 201 / .35)', 'rgb(26 167 201 / .7)', '#ff5470', '#e0173f'] as const,
  },
  crystalDark: {
    cardBackground: '#141a2c', cardBackgroundEnd: '#06070d', cardText: '#ffffff', cardMuted: '#aab3c5',
    cardChip: 'rgb(255 255 255 / .07)', cardAccent: '#ff5470',
    heatLevels: ['rgb(255 255 255 / .08)', 'rgb(94 242 255 / .3)', 'rgb(94 242 255 / .6)', '#ff5470', '#ff2a4d'] as const,
  },
} as const;

export function resolveWeeklyRecapExportTheme(
  readRoot: () => HTMLElement | null = () => globalThis.document?.documentElement ?? null,
): WeeklyRecapExportTheme {
  const root = readRoot();
  if (!root) return FALLBACK_THEME;
  const computed = globalThis.getComputedStyle?.(root);
  const family = root.dataset?.themeFamily === 'crystal' ? 'crystal' : 'classic';
  const dark = root.classList?.contains('dark') ?? false;
  const card = CARD_PALETTES[`${family}${dark ? 'Dark' : 'Light'}` as keyof typeof CARD_PALETTES] ?? CARD_PALETTES.classicLight;
  const read = (variable: string, fallback: string): string => {
    const value = computed?.getPropertyValue(variable)?.trim();
    return value ? value : fallback;
  };
  return {
    ...card,
    background: read('--sf-surface', FALLBACK_THEME.background),
    text: read('--sf-text', FALLBACK_THEME.text),
    textMuted: read('--sf-text-muted', FALLBACK_THEME.textMuted),
    brand: read('--sf-brand', FALLBACK_THEME.brand),
  };
}

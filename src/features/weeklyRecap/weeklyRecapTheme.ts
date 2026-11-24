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
  displayFont: 'Georgia, serif',
  bodyFont: 'system-ui, sans-serif',
};

/** Mirrors the on-screen card tokens in weekly-recap-dialog.css. */
const CARD_PALETTES = {
  classicLight: {
    cardBackground: '#1c2a21', cardBackgroundEnd: '#1c2a21', cardText: '#fbf6ec', cardMuted: '#aab3a6',
    cardChip: 'rgb(251 246 236 / .06)', cardAccent: '#e8a075',
    heatLevels: ['rgb(251 246 236 / .08)', 'rgb(232 160 117 / .3)', 'rgb(232 160 117 / .55)', '#e8a075', '#f3c7a4'] as const,
  },
  classicDark: {
    cardBackground: '#0f2a38', cardBackgroundEnd: '#07161f', cardText: '#f1f6f9', cardMuted: '#99a7b0',
    cardChip: 'rgb(255 255 255 / .05)', cardAccent: '#28d3f4',
    heatLevels: ['#13495a', '#1a6f84', '#1f8ca6', '#28d3f4', '#7ee6fa'] as const,
  },
  crystalLight: {
    cardBackground: '#fff6f8', cardBackgroundEnd: '#f1ecfb', cardText: '#0d1a33', cardMuted: '#3f5272',
    cardChip: 'rgb(255 255 255 / .72)', cardAccent: '#c40f35',
    heatLevels: ['#9fdde8', '#4fc0d4', '#ff5470', '#e0173f', '#b30f33'] as const,
  },
  crystalDark: {
    cardBackground: '#1a1424', cardBackgroundEnd: '#0b1222', cardText: '#ffffff', cardMuted: '#aab3c5',
    cardChip: 'rgb(255 255 255 / .06)', cardAccent: '#ff5470',
    heatLevels: ['#1d5a63', '#2f9aa8', '#ff5470', '#ff2a4d', '#ff7a90'] as const,
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
  // Only the light page's ink card keeps its own heat steps; every other card draws the page heat scale.
  const pageHeat = family === 'crystal' || dark;
  const heatLevels = pageHeat
    ? card.heatLevels.map((fallback, level) => read(`--sf-heat-${level}`, fallback)) as unknown as WeeklyRecapExportTheme['heatLevels']
    : card.heatLevels;
  return {
    ...card,
    heatLevels,
    family,
    displayFont: read('--sf-font-display', FALLBACK_THEME.displayFont!),
    // Crystal sets Nunito on the app shell only, so it is named here rather than read from the root.
    bodyFont: family === 'crystal' ? 'Nunito, system-ui, sans-serif' : read('--font-sans', FALLBACK_THEME.bodyFont!),
    background: read('--sf-surface', FALLBACK_THEME.background),
    text: read('--sf-text', FALLBACK_THEME.text),
    textMuted: read('--sf-text-muted', FALLBACK_THEME.textMuted),
    brand: read('--sf-brand', FALLBACK_THEME.brand),
  };
}

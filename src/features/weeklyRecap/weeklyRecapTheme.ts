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
};

export function resolveWeeklyRecapExportTheme(
  readRoot: () => HTMLElement | null = () => globalThis.document?.documentElement ?? null,
): WeeklyRecapExportTheme {
  const root = readRoot();
  if (!root) return FALLBACK_THEME;
  const computed = globalThis.getComputedStyle?.(root);
  const read = (variable: string, fallback: string): string => {
    const value = computed?.getPropertyValue(variable)?.trim();
    return value ? value : fallback;
  };
  return {
    background: read('--sf-surface', FALLBACK_THEME.background),
    text: read('--sf-text', FALLBACK_THEME.text),
    textMuted: read('--sf-text-muted', FALLBACK_THEME.textMuted),
    brand: read('--sf-brand', FALLBACK_THEME.brand),
    heatLevels: [
      read('--sf-heat-0', FALLBACK_THEME.heatLevels[0]),
      read('--sf-heat-1', FALLBACK_THEME.heatLevels[1]),
      read('--sf-heat-2', FALLBACK_THEME.heatLevels[2]),
      read('--sf-heat-3', FALLBACK_THEME.heatLevels[3]),
      read('--sf-heat-4', FALLBACK_THEME.heatLevels[4]),
    ],
  };
}

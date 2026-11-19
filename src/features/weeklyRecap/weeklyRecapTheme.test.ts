import { afterEach, describe, expect, it, vi } from 'vitest';
import { weeklyRecapExportFonts } from './weeklyRecapExport';
import { resolveWeeklyRecapExportTheme } from './weeklyRecapTheme';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveWeeklyRecapExportTheme', () => {
  it('falls back to a readable palette when there is no document root', () => {
    const theme = resolveWeeklyRecapExportTheme(() => null);
    expect(theme.background).toBe('#0b1220');
    expect(theme.heatLevels).toHaveLength(5);
  });

  it('reads real custom properties from the given root when they resolve', () => {
    // No jsdom in this project; stub getComputedStyle directly rather than building a real DOM node.
    const values: Record<string, string> = { '--sf-surface': '#101010', '--sf-text': '#eeeeee' };
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (variable: string) => values[variable] ?? '' }));
    const fakeRoot = {} as HTMLElement;

    const theme = resolveWeeklyRecapExportTheme(() => fakeRoot);

    expect(theme.background).toBe('#101010');
    expect(theme.text).toBe('#eeeeee');
    // Unresolved variables fall back rather than resolving to an empty string.
    expect(theme.brand).toBe('#38bdf8');
  });

  it('draws with the theme family\'s display and body fonts', () => {
    const values: Record<string, string> = { '--sf-font-display': 'Kanit, Nunito, sans-serif', '--font-sans': 'Geist, sans-serif' };
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (variable: string) => values[variable] ?? '' }));
    const crystalRoot = { dataset: { themeFamily: 'crystal' }, classList: { contains: () => true } } as unknown as HTMLElement;

    const crystal = resolveWeeklyRecapExportTheme(() => crystalRoot);
    expect(crystal.family).toBe('crystal');
    expect(crystal.cardBackground).toBe('#1a1424');
    expect(weeklyRecapExportFonts(crystal).hero).toBe('italic 900 136px Kanit, Nunito, sans-serif');
    expect(weeklyRecapExportFonts(crystal).caption).toBe('600 34px Nunito, system-ui, sans-serif');

    values['--sf-font-display'] = 'Fraunces, Georgia, serif';
    const classic = resolveWeeklyRecapExportTheme(() => ({ dataset: {}, classList: { contains: () => false } }) as unknown as HTMLElement);
    expect(weeklyRecapExportFonts(classic).hero).toBe('300 136px Fraunces, Georgia, serif');
    expect(weeklyRecapExportFonts(classic).label).toBe('600 22px Geist, sans-serif');
  });
});

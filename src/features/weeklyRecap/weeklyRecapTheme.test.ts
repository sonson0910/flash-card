import { afterEach, describe, expect, it, vi } from 'vitest';
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
});

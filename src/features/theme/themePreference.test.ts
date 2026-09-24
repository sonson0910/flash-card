import { describe, expect, it, vi } from 'vitest';
import {
  applyLegacyThemePreference,
  applyThemePreference,
  getSystemThemeMode,
  readThemePreference,
  resolveInitialDarkMode,
} from './themePreference';

describe('themePreference', () => {
  it('parses stored values and migrates legacy mode to classic', () => {
    expect(readThemePreference({ getItem: key => key === 'lingoflash_theme' ? 'light' : null })).toEqual({
      family: 'classic', mode: 'light', followSystem: false,
    });
    expect(readThemePreference({ getItem: key => key === 'sonflash_theme_family' ? 'crystal' : null }, 'light')).toEqual({
      family: 'crystal', mode: 'light', followSystem: false,
    });
    expect(readThemePreference({ getItem: () => 'invalid' })).toEqual({ family: 'classic', mode: 'dark', followSystem: false });
    expect(readThemePreference({ getItem: () => null }, 'light')).toEqual({ family: 'classic', mode: 'light', followSystem: false });
  });

  it('uses the system mode when follow-system is enabled while retaining the stored family', () => {
    expect(readThemePreference({ getItem: key => ({
      sonflash_theme_family: 'crystal', lingoflash_theme: 'light', sonflash_theme_follow_system: 'true',
    })[key] ?? null }, 'dark')).toEqual({ family: 'crystal', mode: 'dark', followSystem: true });
  });

  it('uses the OS mode only while no legacy mode is stored', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));

    expect(getSystemThemeMode()).toBe('light');
    expect(resolveInitialDarkMode({ getItem: () => null })).toBe(false);
    expect(resolveInitialDarkMode({ getItem: () => 'dark' })).toBe(true);

    vi.unstubAllGlobals();
  });

  it('persists both storage keys and applies family and mode to the root', () => {
    const storage = { setItem: vi.fn() };
    const root = { classList: { add: vi.fn(), remove: vi.fn() }, dataset: {} as { themeFamily?: string } };

    applyThemePreference({ family: 'crystal', mode: 'light', followSystem: true }, storage, root);

    expect(storage.setItem).toHaveBeenCalledWith('sonflash_theme_family', 'crystal');
    expect(storage.setItem).toHaveBeenCalledWith('lingoflash_theme', 'light');
    expect(storage.setItem).toHaveBeenCalledWith('sonflash_theme_follow_system', 'true');
    expect(root.dataset.themeFamily).toBe('crystal');
    expect(root.classList.remove).toHaveBeenCalledWith('dark');
  });

  it('keeps legacy exports writing the old mode key while retaining the stored family', () => {
    const storage = { getItem: (key: string) => key === 'sonflash_theme_family' ? 'crystal' : null, setItem: vi.fn() };
    const root = { classList: { add: vi.fn(), remove: vi.fn() }, dataset: {} as { themeFamily?: string } };

    applyLegacyThemePreference(true, storage, root);

    expect(resolveInitialDarkMode({ getItem: () => 'light' })).toBe(false);
    expect(storage.setItem).toHaveBeenLastCalledWith('lingoflash_theme', 'dark');
    expect(root.dataset.themeFamily).toBe('crystal');
    expect(root.classList.add).toHaveBeenCalledWith('dark');
  });
});

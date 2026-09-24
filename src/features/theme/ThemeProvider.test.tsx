import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';

vi.mock('./loadThemeAssets', () => ({ loadThemeAssets: vi.fn().mockResolvedValue(undefined) }));

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const installMinimalReactDom = () => {
  const rootElement = {
    classList: { add: vi.fn(), remove: vi.fn() },
    dataset: {} as { themeFamily?: string },
  };
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    defaultView: globalThis,
    documentElement: rootElement,
  };
  const container = {
    nodeType: 1,
    ownerDocument: documentLike,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return { container: container as unknown as Element, rootElement };
};

afterEach(() => vi.unstubAllGlobals());

it('keeps both changes made before a rerender', async () => {
  const storage = new MemoryStorage();
  const { container, rootElement } = installMinimalReactDom();
  vi.stubGlobal('localStorage', storage);
  const root = createRoot(container);
  let theme: ReturnType<typeof useTheme> | null = null;

  function Harness() {
    theme = useTheme();
    return null;
  }

  try {
    await act(async () => { root.render(<ThemeProvider><Harness /></ThemeProvider>); });
    await act(async () => {
      theme?.setFamily('crystal');
      theme?.setMode('light');
    });

    expect(theme).toMatchObject({ family: 'crystal', mode: 'light', followSystem: false });
    expect(storage.getItem('sonflash_theme_family')).toBe('crystal');
    expect(storage.getItem('lingoflash_theme')).toBe('light');
    expect(rootElement.dataset.themeFamily).toBe('crystal');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

it('follows OS mode changes and turns follow-system off after an explicit mode selection', async () => {
  const storage = new MemoryStorage();
  const listeners = new Set<() => void>();
  const media = { matches: false, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) };
  const { container } = installMinimalReactDom();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  const root = createRoot(container);
  let theme: ReturnType<typeof useTheme> | null = null;

  function Harness() {
    theme = useTheme();
    return null;
  }

  try {
    await act(async () => { root.render(<ThemeProvider><Harness /></ThemeProvider>); });
    await act(async () => { theme?.setFamily('crystal'); theme?.setFollowSystem(true); });
    expect(theme).toMatchObject({ family: 'crystal', mode: 'light', followSystem: true });
    expect(storage.getItem('sonflash_theme_follow_system')).toBe('true');

    media.matches = true;
    await act(async () => { listeners.forEach(listener => listener()); });
    expect(theme).toMatchObject({ family: 'crystal', mode: 'dark', followSystem: true });

    await act(async () => { theme?.setMode('light'); });
    expect(theme).toMatchObject({ mode: 'light', followSystem: false });
    expect(storage.getItem('sonflash_theme_follow_system')).toBe('false');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

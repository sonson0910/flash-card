import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';

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

    expect(theme).toMatchObject({ family: 'crystal', mode: 'light' });
    expect(storage.getItem('sonflash_theme_family')).toBe('crystal');
    expect(storage.getItem('lingoflash_theme')).toBe('light');
    expect(rootElement.dataset.themeFamily).toBe('crystal');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

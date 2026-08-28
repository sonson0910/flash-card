import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useBrowserExtensionImport } from './useBrowserExtensionImport';
import type { BrowserExtensionImportOptions } from './browserExtensionImportRuntime';

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    defaultView: globalThis,
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
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('top', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

const optionsFor = (overrides: Partial<BrowserExtensionImportOptions> = {}): BrowserExtensionImportOptions => ({
  ownerId: 'owner-a',
  identityLoading: false,
  customDecks: ['Reading'],
  libraryReady: true,
  isBusy: false,
  changeDraft: vi.fn(),
  generate: vi.fn(async () => ({ status: 'failed' as const, error: new Error('unused') })),
  openLibrary: vi.fn(),
  notify: vi.fn(),
  reportError: vi.fn(),
  ...overrides,
});

describe('useBrowserExtensionImport deck metadata sync', () => {
  it('publishes bounded opaque-scope metadata and clears it on owner change', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('location', { origin: 'https://app.example.test' });
    vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
    const root = createRoot(installMinimalReactDom());
    const longDecks = ['Reading', 'Reading', ...Array.from({ length: 120 }, (_, index) => `Deck ${index} ${'x'.repeat(200)}`)];

    function Harness(props: { options: BrowserExtensionImportOptions }) {
      useBrowserExtensionImport(props.options);
      return null;
    }

    try {
      await act(async () => {
        root.render(<Harness options={optionsFor({ libraryReady: false, customDecks: longDecks })} />);
      });
      expect(posted).toEqual([]);

      await act(async () => {
        root.render(<Harness options={optionsFor({ customDecks: longDecks })} />);
      });
      const metadata = posted.find((message): message is { type: string; payload: { scope: string; decks: string[] } } => (
        Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'LINGOFLASH_EXTENSION_DECK_METADATA')
      ));
      expect(metadata).toBeDefined();
      expect(metadata?.payload.scope).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
      expect(metadata?.payload.decks).toHaveLength(100);
      expect(metadata?.payload.decks.every(deck => deck.length <= 128)).toBe(true);
      expect(JSON.stringify(metadata)).not.toContain('owner-a');

      await act(async () => {
        root.render(<Harness options={optionsFor({ ownerId: null, libraryReady: false, customDecks: [] })} />);
      });
      expect(posted).toContainEqual(expect.objectContaining({
        type: 'LINGOFLASH_EXTENSION_DECK_METADATA_CLEAR',
        payload: { scope: metadata?.payload.scope },
      }));
    } finally {
      act(() => root.unmount());
    }
  });
});

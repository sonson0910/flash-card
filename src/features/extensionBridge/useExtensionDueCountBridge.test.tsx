import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useExtensionDueCountBridge, type ExtensionDueCountBridgeOptions } from './useExtensionDueCountBridge';

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

const optionsFor = (overrides: Partial<ExtensionDueCountBridgeOptions> = {}): ExtensionDueCountBridgeOptions => ({
  ownerId: 'owner-a',
  ready: true,
  dueCount: 3,
  ...overrides,
});

function Harness(props: { options: ExtensionDueCountBridgeOptions }) {
  useExtensionDueCountBridge(props.options);
  return null;
}

describe('useExtensionDueCountBridge', () => {
  it('does not post before the owner data is ready, then posts a bounded real count', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('location', { origin: 'https://app.example.test' });
    vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
    const root = createRoot(installMinimalReactDom());

    try {
      await act(async () => {
        root.render(<Harness options={optionsFor({ ready: false })} />);
      });
      expect(posted).toEqual([]);

      await act(async () => {
        root.render(<Harness options={optionsFor({ ready: true, dueCount: 12 })} />);
      });
      expect(posted).toHaveLength(1);
      const synced = posted[0] as { type: string; payload: { scope: string; count: number } };
      expect(synced.type).toBe('LINGOFLASH_EXTENSION_DUE_COUNT');
      expect(synced.payload.scope).toMatch(/^[\w-]{8,}$/);
      expect(synced.payload.count).toBe(12);
      expect(JSON.stringify(synced)).not.toContain('owner-a');
    } finally {
      act(() => root.unmount());
    }
  });

  it('clears the previous owner scope on sign-out and never leaks its count under the next owner', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('location', { origin: 'https://app.example.test' });
    vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
    const root = createRoot(installMinimalReactDom());

    try {
      await act(async () => {
        root.render(<Harness options={optionsFor({ dueCount: 7 })} />);
      });
      const firstSync = posted.find((message): message is { type: string; payload: { scope: string } } => (
        Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'LINGOFLASH_EXTENSION_DUE_COUNT')
      ));
      expect(firstSync).toBeDefined();
      const firstScope = firstSync!.payload.scope;

      // Sign-out: ownerId drops to null. The previous scope must be cleared
      // and no count may be posted while signed out.
      await act(async () => {
        root.render(<Harness options={optionsFor({ ownerId: null, ready: false, dueCount: 0 })} />);
      });
      expect(posted).toContainEqual({
        source: 'lingoflash-web-app',
        type: 'LINGOFLASH_EXTENSION_DUE_COUNT_CLEAR',
        payload: { scope: firstScope },
      });

      // A different owner signs in with an unrelated due count. It must get
      // its own fresh scope, never the previous owner's scope or number
      // silently carried forward.
      await act(async () => {
        root.render(<Harness options={optionsFor({ ownerId: 'owner-b', ready: true, dueCount: 41 })} />);
      });
      const secondSync = [...posted].reverse().find((message): message is { type: string; payload: { scope: string; count: number } } => (
        Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'LINGOFLASH_EXTENSION_DUE_COUNT')
      ));
      expect(secondSync).toBeDefined();
      expect(secondSync!.payload.count).toBe(41);
      expect(secondSync!.payload.scope).not.toBe(firstScope);
    } finally {
      act(() => root.unmount());
    }
  });

  it('retires the scope when the same owner loses readiness and creates a fresh one on recovery', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('location', { origin: 'https://app.example.test' });
    vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
    const root = createRoot(installMinimalReactDom());

    try {
      await act(async () => {
        root.render(<Harness options={optionsFor({ dueCount: 7 })} />);
      });
      const firstSync = posted[0] as { type: string; payload: { scope: string; count: number } };

      await act(async () => {
        root.render(<Harness options={optionsFor({ ready: false, dueCount: 0 })} />);
      });
      expect(posted).toContainEqual({
        source: 'lingoflash-web-app',
        type: 'LINGOFLASH_EXTENSION_DUE_COUNT_CLEAR',
        payload: { scope: firstSync.payload.scope },
      });

      await act(async () => {
        root.render(<Harness options={optionsFor({ ready: true, dueCount: 12 })} />);
      });
      const recoveredSync = posted[2] as { type: string; payload: { scope: string; count: number } };
      expect(recoveredSync).toMatchObject({
        type: 'LINGOFLASH_EXTENSION_DUE_COUNT',
        payload: { count: 12 },
      });
      expect(recoveredSync.payload.scope).not.toBe(firstSync.payload.scope);
    } finally {
      act(() => root.unmount());
    }
  });

  it('never posts a fabricated count: invalid or out-of-range values are dropped, not clamped to zero or sent anyway', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('location', { origin: 'https://app.example.test' });
    vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
    const root = createRoot(installMinimalReactDom());

    try {
      await act(async () => {
        root.render(<Harness options={optionsFor({ dueCount: -1 })} />);
      });
      expect(posted).toEqual([]);

      await act(async () => {
        root.render(<Harness options={optionsFor({ dueCount: 1.5 })} />);
      });
      expect(posted).toEqual([]);

      await act(async () => {
        root.render(<Harness options={optionsFor({ dueCount: 50_000 })} />);
      });
      expect(posted).toHaveLength(1);
      const synced = posted[0] as { payload: { count: number } };
      expect(synced.payload.count).toBe(9_999);
    } finally {
      act(() => root.unmount());
    }
  });

  it('clears the live scope when the bridge component unmounts', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('location', { origin: 'https://app.example.test' });
    vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
    const root = createRoot(installMinimalReactDom());

    await act(async () => {
      root.render(<Harness options={optionsFor({ dueCount: 5 })} />);
    });
    const sync = posted.find((message): message is { type: string; payload: { scope: string } } => (
      Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'LINGOFLASH_EXTENSION_DUE_COUNT')
    ));
    expect(sync).toBeDefined();

    act(() => root.unmount());
    expect(posted).toContainEqual({
      source: 'lingoflash-web-app',
      type: 'LINGOFLASH_EXTENSION_DUE_COUNT_CLEAR',
      payload: { scope: sync!.payload.scope },
    });
  });

  it('publishes the current ready owner again after a replacement provider handshake', async () => {
    const posted: unknown[] = [];
    const listeners = new Set<(event: MessageEvent) => void>();
    vi.stubGlobal('location', { origin: 'https://app.example.test' });
    vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
    vi.stubGlobal('addEventListener', (type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') listeners.add(listener);
    });
    vi.stubGlobal('removeEventListener', (type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') listeners.delete(listener);
    });
    const dispatchProviderReady = () => {
      const event = {
        source: globalThis,
        origin: 'https://app.example.test',
        data: {
          source: 'lingoflash-extension-bridge',
          type: 'LINGOFLASH_EXTENSION_PROVIDER_READY',
        },
      } as unknown as MessageEvent;
      for (const listener of listeners) listener(event);
    };
    const root = createRoot(installMinimalReactDom());

    try {
      await act(async () => {
        root.render(<Harness options={optionsFor({ dueCount: 7 })} />);
      });
      const first = posted.find((message): message is { type: string; payload: { scope: string } } => (
        Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'LINGOFLASH_EXTENSION_DUE_COUNT')
      ));
      expect(first).toBeDefined();

      dispatchProviderReady();
      const republished = [...posted].reverse().find((message): message is { type: string; payload: { scope: string; count: number } } => (
        Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'LINGOFLASH_EXTENSION_DUE_COUNT')
      ));
      expect(republished).toMatchObject({ type: 'LINGOFLASH_EXTENSION_DUE_COUNT', payload: { scope: first!.payload.scope, count: 7 } });

      await act(async () => {
        root.render(<Harness options={optionsFor({ ownerId: 'owner-b', dueCount: 41 })} />);
      });
      const second = [...posted].reverse().find((message): message is { type: string; payload: { scope: string; count: number } } => (
        Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'LINGOFLASH_EXTENSION_DUE_COUNT')
      ));
      expect(second?.payload.count).toBe(41);
      expect(second?.payload.scope).not.toBe(first!.payload.scope);
      dispatchProviderReady();
      const afterHandshake = [...posted].reverse().find((message): message is { type: string; payload: { scope: string; count: number } } => (
        Boolean(message && typeof message === 'object' && (message as { type?: unknown }).type === 'LINGOFLASH_EXTENSION_DUE_COUNT')
      ));
      expect(afterHandshake?.payload.count).toBe(41);
      expect(afterHandshake?.payload.scope).toBe(second?.payload.scope);
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});

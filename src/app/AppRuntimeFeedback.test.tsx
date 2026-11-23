import { act, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useOwnerScopedMessage } from './AppRuntime';
import { scheduleNoticeDismissal } from '../features/overlays/useOverlayState';

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis,
  };
  const container = {
    nodeType: 1, ownerDocument: documentLike, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
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

describe('AppRuntime owner-scoped feedback', () => {
  it('hides A vocabulary immediately on B and rejects callbacks captured before A→B→A', () => {
    const seen: Array<{ ownerId: string | null; message: string | null }> = [];
    let setMessage!: Dispatch<SetStateAction<string | null>>;
    function Probe({ ownerId }: { ownerId: string | null }) {
      const activeOwnerRef = useRef(ownerId);
      activeOwnerRef.current = ownerId;
      const [stored, setStored] = useState<string | null>(null);
      const [message, publish] = useOwnerScopedMessage(ownerId, activeOwnerRef, stored, setStored);
      setMessage = publish;
      seen.push({ ownerId, message });
      return null;
    }
    const root = createRoot(installMinimalReactDom());
    try {
      act(() => root.render(<Probe ownerId={null} />));
      act(() => setMessage('Guest notice'));
      expect(seen.at(-1)).toEqual({ ownerId: null, message: 'Guest notice' });
      act(() => root.render(<Probe ownerId="owner-a" />));
      expect(seen.at(-1)).toEqual({ ownerId: 'owner-a', message: null });
      const staleA = setMessage;
      act(() => setMessage('Added “private-word”'));
      expect(seen.at(-1)).toEqual({ ownerId: 'owner-a', message: 'Added “private-word”' });

      act(() => root.render(<Probe ownerId="owner-b" />));
      expect(seen.at(-1)).toEqual({ ownerId: 'owner-b', message: null });
      act(() => staleA('Late A result'));
      expect(seen.at(-1)).toEqual({ ownerId: 'owner-b', message: null });
      act(() => setMessage(current => current ?? 'Added “private-word”'));
      expect(seen.at(-1)).toEqual({ ownerId: 'owner-b', message: 'Added “private-word”' });
      act(() => setMessage('B notice'));
      expect(seen.at(-1)).toEqual({ ownerId: 'owner-b', message: 'B notice' });

      act(() => root.render(<Probe ownerId="owner-a" />));
      expect(seen.at(-1)).toEqual({ ownerId: 'owner-a', message: null });
      act(() => staleA('Stale A result'));
      expect(seen.at(-1)).toEqual({ ownerId: 'owner-a', message: null });
      act(() => setMessage('New A notice'));
      expect(seen.at(-1)).toEqual({ ownerId: 'owner-a', message: 'New A notice' });
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('gives B a full dismissal window when B repeats A’s notice text', () => {
    vi.useFakeTimers();
    let message: string | null = null;
    let setMessage!: Dispatch<SetStateAction<string | null>>;
    function Probe({ ownerId }: { ownerId: string }) {
      const activeOwnerRef = useRef(ownerId);
      activeOwnerRef.current = ownerId;
      const [stored, setStored] = useState<string | null>(null);
      const [visible, publish] = useOwnerScopedMessage(ownerId, activeOwnerRef, stored, setStored);
      message = visible;
      setMessage = publish;
      useEffect(() => scheduleNoticeDismissal(visible, () => publish(null)), [visible, publish]);
      return null;
    }
    const root = createRoot(installMinimalReactDom());
    try {
      act(() => root.render(<Probe ownerId="owner-a" />));
      act(() => setMessage('Saved'));
      act(() => vi.advanceTimersByTime(4_950));
      act(() => root.render(<Probe ownerId="owner-b" />));
      expect(message).toBeNull();
      act(() => setMessage('Saved'));
      expect(message).toBe('Saved');
      act(() => vi.advanceTimersByTime(100));
      expect(message).toBe('Saved');
      act(() => vi.advanceTimersByTime(4_900));
      expect(message).toBeNull();
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

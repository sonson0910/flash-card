import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { VoiceInputAdapter, VoiceInputCallbacks } from '../conversation/voiceInput';
import { TextConversationPanel } from './TextConversationPanel';

const cards: CardData[] = [
  { id: '1', word: 'menu', translation: 'thực đơn', phonetic: '', explanation: '', category: 'All', customDeck: null } as CardData,
  { id: '2', word: 'coffee', translation: 'cà phê', phonetic: '', explanation: '', category: 'All', customDeck: null } as CardData,
];

class FakeElement {
  readonly nodeType: number = 1;
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
  readonly childNodes: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style = { setProperty: vi.fn(), removeProperty: vi.fn() };
  parentNode: FakeElement | null = null;
  ownerDocument!: Record<string, unknown>;
  textContent = '';
  value = '';
  disabled = false;
  constructor(readonly tagName: string) {}
  get nodeName() { return this.tagName.toUpperCase(); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get nextSibling() {
    const index = this.parentNode?.childNodes.indexOf(this) ?? -1;
    return index >= 0 ? this.parentNode?.childNodes[index + 1] ?? null : null;
  }
  appendChild<T extends FakeElement>(child: T): T {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore<T extends FakeElement>(child: T, before: FakeElement | null): T {
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }
  removeChild<T extends FakeElement>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  addEventListener() {}
  removeEventListener() {}
  contains(node: FakeElement | null): boolean { return node === this || this.childNodes.some(child => child.contains(node)); }
  focus() {}
}

class FakeTextNode extends FakeElement {
  readonly nodeType = 3;
  constructor(public text: string) { super('#text'); }
  get nodeName() { return '#text'; }
}

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    createElement: (tagName: string) => {
      const element = new FakeElement(tagName);
      element.ownerDocument = documentLike;
      return element;
    },
    createElementNS: (_namespace: string, tagName: string) => {
      const element = new FakeElement(tagName);
      element.ownerDocument = documentLike;
      return element;
    },
    createTextNode: (text: string) => {
      const node = new FakeTextNode(text);
      node.ownerDocument = documentLike;
      return node;
    },
    createComment: (text: string) => {
      const node = new FakeTextNode(text);
      node.ownerDocument = documentLike;
      return node;
    },
  };
  const container = new FakeElement('div');
  container.ownerDocument = documentLike;
  documentLike.documentElement = container;
  documentLike.body = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('Node', FakeElement);
  return container;
};

const textContent = (node: FakeElement): string => (
  node.childNodes.length === 0
    ? node.textContent
    : node.childNodes.map(child => child instanceof FakeTextNode ? child.text : textContent(child)).join('')
);

const findElement = (node: FakeElement, predicate: (candidate: FakeElement) => boolean): FakeElement | null => {
  if (predicate(node)) return node;
  for (const child of node.childNodes) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
};

const invokeClick = (element: FakeElement) => {
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
  const props = propsKey
    ? (element as unknown as Record<string, unknown>)[propsKey] as { onClick?: (event: unknown) => void }
    : undefined;
  if (!props?.onClick) throw new Error('React click handler was not attached.');
  props.onClick({ preventDefault: () => undefined, stopPropagation: () => undefined });
};

describe('TextConversationPanel', () => {
  it('renders a bounded, accessible text mission without speech controls', () => {
    const html = renderToStaticMarkup(<TextConversationPanel cards={cards} onBack={() => undefined} onClose={() => undefined} />);

    expect(html).toContain('Text practice mission');
    expect(html).toContain('Mission vocabulary');
    expect(html).toContain('Write your reply');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('0/6 turns');
    expect(html).toContain('Close text practice');
    expect(html).not.toContain('microphone');
    expect(html).not.toContain('pronunciation');
  });

  it('renders safely when signed out or when no cards are available', () => {
    expect(() => renderToStaticMarkup(
      <TextConversationPanel cards={[]} ownerId={null} onBack={() => undefined} onClose={() => undefined} />,
    )).not.toThrow();
  });

  it('keeps the text fallback and truthful transcript-only copy when voice input is enabled', () => {
    vi.stubEnv('VITE_ENABLE_VOICE_INPUT', 'true');
    try {
      const html = renderToStaticMarkup(
        <TextConversationPanel cards={cards} onBack={() => undefined} onClose={() => undefined} />,
      );

      expect(html).toContain('Voice input (transcript only)');
      expect(html).toContain('does not store a recording');
      expect(html).toContain('speech service may process audio');
      expect(html).not.toContain('No raw audio is stored or uploaded by SonFlash');
      expect(html).toContain('Write your reply');
      expect(html).not.toMatch(/pronunciation|phoneme|accent|fluency|native-like/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps typing available and does not start voice input while offline', async () => {
    const start = vi.fn(() => true);
    const adapter: VoiceInputAdapter = {
      supported: true,
      usage: { kind: 'unavailable', reason: 'browser-recognition-meter' },
      subscribe: () => () => undefined,
      start,
      stop: vi.fn(),
    };
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    vi.stubEnv('VITE_ENABLE_VOICE_INPUT', 'true');
    vi.stubGlobal('navigator', { onLine: false });

    try {
      await act(async () => {
        root.render(createElement(TextConversationPanel, {
          cards,
          ownerId: 'owner-a',
          voiceInput: adapter,
          onBack: vi.fn(),
          onClose: vi.fn(),
        }));
      });
      const startButton = findElement(container, element => element.getAttribute('aria-label') === 'Start voice input');
      if (!startButton) throw new Error('Voice input button was not rendered.');
      await act(async () => invokeClick(startButton));

      expect(start).not.toHaveBeenCalled();
      expect(textContent(container)).toContain('needs a connection');
      expect(findElement(container, element => element.tagName === 'textarea')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('opens a circuit after repeated voice runtime failures instead of retrying automatically', async () => {
    const listeners = new Set<VoiceInputCallbacks>();
    const start = vi.fn(() => {
      listeners.forEach(callbacks => callbacks.onState('listening'));
      return true;
    });
    const adapter: VoiceInputAdapter = {
      supported: true,
      usage: { kind: 'unavailable', reason: 'browser-recognition-meter' },
      subscribe(callbacks) {
        listeners.add(callbacks);
        return () => listeners.delete(callbacks);
      },
      start,
      stop: vi.fn(),
    };
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    vi.stubEnv('VITE_ENABLE_VOICE_INPUT', 'true');

    try {
      await act(async () => {
        root.render(createElement(TextConversationPanel, {
          cards,
          ownerId: 'owner-a',
          voiceInput: adapter,
          onBack: vi.fn(),
          onClose: vi.fn(),
        }));
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const startButton = findElement(container, element => element.getAttribute('aria-label') === 'Start voice input');
        if (!startButton) throw new Error('Voice input button was not rendered.');
        await act(async () => invokeClick(startButton));
        await act(async () => {
          listeners.forEach(callbacks => callbacks.onError('runtime'));
        });
      }

      const circuitButton = findElement(container, element => element.getAttribute('aria-label') === 'Start voice input');
      expect(start).toHaveBeenCalledTimes(3);
      expect(circuitButton?.getAttribute('disabled')).not.toBeNull();
      expect(textContent(container)).toContain('paused after repeated failures');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('uses the synchronous voice run as the double-click source of truth', async () => {
    const listeners = new Set<VoiceInputCallbacks>();
    const start = vi.fn(() => {
      listeners.forEach(callbacks => callbacks.onState('listening'));
      return true;
    });
    const stop = vi.fn();
    const adapter: VoiceInputAdapter = {
      supported: true,
      usage: { kind: 'unavailable', reason: 'browser-recognition-meter' },
      subscribe(callbacks) {
        listeners.add(callbacks);
        return () => listeners.delete(callbacks);
      },
      start,
      stop,
    };
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    vi.stubEnv('VITE_ENABLE_VOICE_INPUT', 'true');

    try {
      await act(async () => {
        root.render(createElement(TextConversationPanel, {
          cards,
          ownerId: 'owner-a',
          voiceInput: adapter,
          onBack: vi.fn(),
          onClose: vi.fn(),
        }));
      });
      const startButton = findElement(container, element => element.getAttribute('aria-label') === 'Start voice input');
      if (!startButton) throw new Error('Voice input button was not rendered.');

      await act(async () => {
        invokeClick(startButton);
        invokeClick(startButton);
      });

      expect(start).toHaveBeenCalledOnce();
      expect(stop).toHaveBeenCalledOnce();
      listeners.forEach(callbacks => callbacks.onTranscript('valid after double click'));
      const message = findElement(container, element => element.tagName === 'textarea');
      expect(message?.value).toBe('');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('resets and closes the session when its authenticated owner changes', async () => {
    const ownerA = [{ ...cards[0], word: 'owner-a-word' }];
    const ownerB = [{ ...cards[1], word: 'owner-b-word' }];
    const onClose = vi.fn();
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);

    try {
      await act(async () => {
        root.render(createElement(TextConversationPanel, {
          cards: ownerA,
          ownerId: 'owner-a',
          onBack: vi.fn(),
          onClose,
        }));
      });
      expect(textContent(container)).toContain('owner-a-word');

      await act(async () => {
        root.render(createElement(TextConversationPanel, {
          cards: ownerB,
          ownerId: 'owner-b',
          onBack: vi.fn(),
          onClose,
        }));
      });

      expect(onClose).toHaveBeenCalledOnce();
      expect(textContent(container)).toContain('owner-b-word');
      expect(textContent(container)).not.toContain('owner-a-word');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('stops voice input and discards stale transcript events across an owner change', async () => {
    const listeners = new Set<VoiceInputCallbacks>();
    const start = vi.fn(() => {
      listeners.forEach(callbacks => callbacks.onState('listening'));
      return true;
    });
    const adapter: VoiceInputAdapter = {
      supported: true,
      usage: { kind: 'unavailable', reason: 'browser-recognition-meter' },
      subscribe(callbacks) {
        listeners.add(callbacks);
        return () => listeners.delete(callbacks);
      },
      start,
      stop: vi.fn(),
    };
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    vi.stubEnv('VITE_ENABLE_VOICE_INPUT', 'true');

    try {
      await act(async () => {
        root.render(createElement(TextConversationPanel, {
          cards,
          ownerId: 'owner-a',
          voiceInput: adapter,
          onBack: vi.fn(),
          onClose: vi.fn(),
        }));
      });
      const firstStart = findElement(container, element => element.getAttribute('aria-label') === 'Start voice input');
      if (!firstStart) throw new Error('Voice input button was not rendered.');
      await act(async () => invokeClick(firstStart));
      expect(start).toHaveBeenCalledOnce();

      await act(async () => {
        root.render(createElement(TextConversationPanel, {
          cards,
          ownerId: 'owner-b',
          voiceInput: adapter,
          onBack: vi.fn(),
          onClose: vi.fn(),
        }));
      });
      await act(async () => {
        listeners.forEach(callbacks => callbacks.onTranscript('stale owner text'));
      });

      expect(adapter.stop).toHaveBeenCalled();
      const staleMessage = findElement(container, element => element.tagName === 'textarea');
      expect(staleMessage?.value).toBe('');

      const secondStart = findElement(container, element => element.getAttribute('aria-label') === 'Start voice input');
      if (!secondStart) throw new Error('Voice input button was not rendered for the new owner.');
      await act(async () => invokeClick(secondStart));
      expect(start).toHaveBeenCalledTimes(2);
      await act(async () => {
        listeners.forEach(callbacks => callbacks.onTranscript('fresh owner text'));
      });
      const freshMessage = findElement(container, element => element.tagName === 'textarea');
      expect(freshMessage?.value).toBe('fresh owner text');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('cancels reply speech when the owner changes and when the panel unmounts', async () => {
    const cancel = vi.fn();
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    vi.stubGlobal('speechSynthesis', { cancel });

    try {
      await act(async () => {
        root.render(createElement(TextConversationPanel, {
          cards,
          ownerId: 'owner-a',
          onBack: vi.fn(),
          onClose: vi.fn(),
        }));
      });
      await act(async () => {
        root.render(createElement(TextConversationPanel, {
          cards,
          ownerId: 'owner-b',
          onBack: vi.fn(),
          onClose: vi.fn(),
        }));
      });
      const ownerChangeCancels = cancel.mock.calls.length;
      expect(ownerChangeCancels).toBeGreaterThan(0);

      await act(async () => root.unmount());
      expect(cancel).toHaveBeenCalledTimes(ownerChangeCancels + 1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
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
});

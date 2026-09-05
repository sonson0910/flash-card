import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import { capListenPracticeCards, type ListenPracticeHandoff } from '../app/AppViewStage';
import { AppOverlays } from './AppOverlays';

type DialogContentProps = {
  readonly children?: ReactNode;
  readonly onCloseAutoFocus?: (event: { preventDefault: () => void }) => void;
  readonly asChild?: boolean;
  readonly [key: string]: unknown;
};

const overlayMockState = vi.hoisted(() => ({
  latestCloseAutoFocus: undefined as ((event: { preventDefault: () => void }) => void) | undefined,
}));

vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ open, children }: { readonly open?: boolean; readonly children?: ReactNode }) => open ? <>{children}</> : null,
  Portal: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
  Overlay: ({ children, ...props }: { readonly children?: ReactNode; readonly [key: string]: unknown }) => <div {...props}>{children}</div>,
  Content: ({ children, onCloseAutoFocus, asChild: _asChild, ...props }: DialogContentProps) => {
    overlayMockState.latestCloseAutoFocus = onCloseAutoFocus;
    return <div role="dialog" {...props}>{children}</div>;
  },
  Title: ({ children, ...props }: { readonly children?: ReactNode; readonly [key: string]: unknown }) => <h2 {...props}>{children}</h2>,
  Description: ({ children, ...props }: { readonly children?: ReactNode; readonly [key: string]: unknown }) => <p {...props}>{children}</p>,
  Close: ({ children, ...props }: { readonly children?: ReactNode; readonly [key: string]: unknown }) => <button {...props}>{children}</button>,
}));

vi.mock('@radix-ui/react-alert-dialog', () => ({
  Root: ({ open, children }: { readonly open?: boolean; readonly children?: ReactNode }) => open ? <>{children}</> : null,
  Portal: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
  Overlay: ({ children, ...props }: { readonly children?: ReactNode; readonly [key: string]: unknown }) => <div {...props}>{children}</div>,
  Content: ({ children, onCloseAutoFocus, asChild: _asChild, ...props }: DialogContentProps) => {
    overlayMockState.latestCloseAutoFocus = onCloseAutoFocus;
    return <div role="alertdialog" {...props}>{children}</div>;
  },
  Title: ({ children, ...props }: { readonly children?: ReactNode; readonly [key: string]: unknown }) => <h2 {...props}>{children}</h2>,
  Description: ({ children, ...props }: { readonly children?: ReactNode; readonly [key: string]: unknown }) => <p {...props}>{children}</p>,
  Cancel: ({ children, ...props }: { readonly children?: ReactNode; readonly [key: string]: unknown }) => <button {...props}>{children}</button>,
  Action: ({ children, ...props }: { readonly children?: ReactNode; readonly [key: string]: unknown }) => <button {...props}>{children}</button>,
}));

vi.mock('./motion/GsapEntrance', () => ({
  GsapEntrance: ({ children, animationKey: _animationKey, direction: _direction, onEntered: _onEntered, variant: _variant, ...props }: {
    readonly children?: ReactNode;
    readonly animationKey?: string | number | boolean;
    readonly direction?: 1 | -1;
    readonly onEntered?: () => void;
    readonly variant?: string;
    readonly [key: string]: unknown;
  }) => <div {...props}>{children}</div>,
}));

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
  isConnected = true;

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
  getAttributeNames() { return [...this.attributes.keys()]; }
  contains(node: FakeElement | null): boolean { return node === this || this.childNodes.some(child => child.contains(node)); }
  addEventListener() {}
  removeEventListener() {}
  focus() {
    (this.ownerDocument as { activeElement?: FakeElement | null }).activeElement = this;
  }
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
    querySelector: vi.fn(() => null),
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
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => callback(0));
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('Node', FakeElement);
  return { container, documentLike };
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
  props.onClick({ currentTarget: element, preventDefault: () => undefined, stopPropagation: () => undefined });
};

const flushReact = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const cards = Array.from({ length: 8 }, (_, index) => ({
  id: `listen-card-${index}`,
  word: `phrase-${index}`,
  translation: `nghĩa-${index}`,
  phonetic: '',
  explanation: '',
  category: 'Listen',
  customDeck: null,
} as CardData));

const makeProps = (
  listenPracticeHandoff: ListenPracticeHandoff,
  onDismissListenPractice: () => void,
  practiceOpener: HTMLElement,
  { activeOwnerId = 'owner-a', isOffline = false }: { readonly activeOwnerId?: string | null; readonly isOffline?: boolean } = {},
) => ({
  shareDialogOpen: false,
  shareLink: null,
  shareWarning: null,
  incomingSharePreview: null,
  dismissShareDialog: vi.fn(),
  showShareDialog: vi.fn(),
  acceptSharedDeck: async () => undefined,
  cancelSharedDeck: vi.fn(),
  canRevokeShare: false,
  revokeShare: async () => undefined,
  isSharing: false,
  isPracticeMenuOpen: false,
  setIsPracticeMenuOpen: vi.fn(),
  startQuiz: async () => undefined,
  startSpelling: async () => undefined,
  startMatch: async () => undefined,
  startShadowing: async () => undefined,
  visibleLibraryCount: 8,
  cards,
  ownerId: activeOwnerId,
  isOffline,
  generateStory: async () => undefined,
  isStatsOpen: false,
  setIsStatsOpen: vi.fn(),
  statsData: {
    total: 8,
    learned: 0,
    learning: 8,
    dueToday: 0,
    categoryChart: [],
    categoryChartIsPartial: false,
    difficultyChart: [],
    xpChartData: [],
  },
  isDarkMode: false,
  showClearConfirm: false,
  setShowClearConfirm: vi.fn(),
  clearAll: async () => undefined,
  isLoading: false,
  shareOpenerRef: { current: null },
  practiceOpenerRef: { current: practiceOpener },
  statsOpenerRef: { current: null },
  clearOpenerRef: { current: null },
  listenPracticeHandoff,
  onDismissListenPractice,
});

describe('AppOverlays listening handoff', () => {
  it('opens the existing text mission with capped cards and restores focus to the listen opener', async () => {
    const { container, documentLike } = installMinimalReactDom();
    const opener = new FakeElement('button');
    opener.ownerDocument = documentLike;
    const onDismissListenPractice = vi.fn();
    const root = createRoot(container as unknown as Element);
    const handoff: ListenPracticeHandoff = {
      ownerId: 'owner-a',
      clipId: 'clip-a',
      generation: 2,
      cards: capListenPracticeCards(cards),
      opener: opener as unknown as HTMLButtonElement,
    };

    try {
      await act(async () => {
        root.render(createElement(AppOverlays, makeProps(
          handoff,
          onDismissListenPractice,
          opener as unknown as HTMLElement,
        )));
        await flushReact();
      });

      expect(textContent(container)).toContain('Text practice mission');
      expect(findElement(container, candidate => candidate.tagName === 'textarea')).not.toBeNull();
      expect(textContent(container)).toContain('phrase-0');
      expect(textContent(container)).toContain('phrase-4');
      expect(textContent(container)).not.toContain('phrase-5');
      expect(textContent(container)).not.toContain('phrase-7');

      const closeButton = findElement(container, candidate => candidate.getAttribute('aria-label') === 'Close text practice');
      if (!closeButton) throw new Error('Text mission close button was not rendered.');
      await act(async () => invokeClick(closeButton));
      if (!overlayMockState.latestCloseAutoFocus) throw new Error('Text mission did not provide close focus handling.');
      overlayMockState.latestCloseAutoFocus({ preventDefault: vi.fn() });
      await new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
      expect(onDismissListenPractice).toHaveBeenCalledOnce();
      expect(documentLike.activeElement).toBe(opener);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['guest', { activeOwnerId: null }],
    ['offline', { isOffline: true }],
  ])('does not open a listening handoff for a %s learner', async (_label, options) => {
    const { container, documentLike } = installMinimalReactDom();
    const opener = new FakeElement('button');
    opener.ownerDocument = documentLike;
    const onDismissListenPractice = vi.fn();
    const root = createRoot(container as unknown as Element);
    const handoff: ListenPracticeHandoff = {
      ownerId: 'owner-a',
      clipId: 'clip-a',
      generation: 2,
      cards: capListenPracticeCards(cards),
      opener: opener as unknown as HTMLButtonElement,
    };

    try {
      await act(async () => {
        root.render(createElement(AppOverlays, makeProps(
          handoff,
          onDismissListenPractice,
          opener as unknown as HTMLElement,
          options,
        )));
        await flushReact();
      });

      expect(textContent(container)).not.toContain('Text practice mission');
      expect(onDismissListenPractice).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});

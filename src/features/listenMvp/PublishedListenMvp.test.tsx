import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListenMvpProps } from './ListenMvp';
import { OFFLINE_MEDIA_PACK_LIMITS } from '../offlineMedia/offlineMediaPack';
import { LISTEN_MVP_PILOT_LESSONS } from './listenMvpPilot';
import { PublishedListenMvp } from './PublishedListenMvp';

const mocked = vi.hoisted(() => ({
  manager: {
    install: vi.fn(),
    resolveCachedClip: vi.fn(),
  },
  createManager: vi.fn(),
}));

vi.mock('../offlineMedia/offlineMediaPack', async () => ({
  ...(await vi.importActual<typeof import('../offlineMedia/offlineMediaPack')>('../offlineMedia/offlineMediaPack')),
  createOfflineMediaPackManager: mocked.createManager,
}));

vi.mock('./ListenMvp', () => ({
  ListenMvp: ({ lesson, offlineMediaPacks, offlineMediaPackIdentity }: Pick<ListenMvpProps, 'lesson' | 'offlineMediaPacks' | 'offlineMediaPackIdentity'>) => (
    <div
      data-offline-resolver={offlineMediaPacks ? 'present' : 'missing'}
      data-offline-identity={offlineMediaPackIdentity ? JSON.stringify(offlineMediaPackIdentity) : 'missing'}
    >
      {lesson?.chunk.text}
    </div>
  ),
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
}

class FakeTextNode extends FakeElement {
  readonly nodeType = 3;

  constructor(readonly text: string) { super('#text'); }
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

const findElement = (node: FakeElement, predicate: (candidate: FakeElement) => boolean): FakeElement | null => {
  if (predicate(node)) return node;
  for (const child of node.childNodes) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
};

const textContent = (node: FakeElement): string => (
  node.childNodes.length === 0
    ? node.textContent
    : node.childNodes.map(child => child.tagName === '#text' ? (child as FakeTextNode).text : textContent(child)).join('')
);

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

describe('PublishedListenMvp', () => {
  beforeEach(() => {
    mocked.createManager.mockReset();
    mocked.createManager.mockReturnValue(mocked.manager);
    mocked.manager.install.mockReset();
    mocked.manager.resolveCachedClip.mockReset();
  });

  it('offers offline audio and passes trusted cache identity on a cold mount', () => {
    const html = renderToStaticMarkup(
      <PublishedListenMvp lesson={LISTEN_MVP_PILOT_LESSONS[0]} />,
    );

    expect(html).toContain('Download audio');
    expect(html).toContain('aria-describedby="published-listen-offline-status"');
    expect(html).toContain('data-offline-resolver="present"');
    expect(html).toContain('&quot;catalogId&quot;:&quot;english-core&quot;');
    expect(html).toContain('&quot;releaseId&quot;:&quot;listen-pilot-2026-09-06&quot;');
    expect(html).not.toContain('Audio available offline');
  });

  it('shows a bounded retry state when manifest download fails', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('private network details must not reach the UI');
    }));

    try {
      await act(async () => {
        root.render(createElement(PublishedListenMvp, { lesson: LISTEN_MVP_PILOT_LESSONS[0] }));
      });
      const button = findElement(container, candidate => (
        candidate.tagName === 'button' && textContent(candidate) === 'Download audio'
      ));
      if (!button) throw new Error('Download button was not rendered.');
      await act(async () => {
        invokeClick(button);
        await flushReact();
      });

      expect(textContent(container)).toContain('Offline audio could not be prepared.');
      expect(textContent(container)).toContain('Retry download');
      expect(textContent(container)).not.toContain('private network details');
      expect(textContent(container)).not.toContain('Audio available offline');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('aborts an in-flight manifest request when unmounted', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }));

    try {
      await act(async () => {
        root.render(createElement(PublishedListenMvp, { lesson: LISTEN_MVP_PILOT_LESSONS[0] }));
      });
      const button = findElement(container, candidate => (
        candidate.tagName === 'button' && textContent(candidate) === 'Download audio'
      ));
      if (!button) throw new Error('Download button was not rendered.');
      await act(async () => {
        invokeClick(button);
        await flushReact();
      });
      expect(requestSignal?.aborted).toBe(false);

      await act(async () => root.unmount());
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('bounds an oversized manifest stream and aborts the request', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    let requestSignal: AbortSignal | undefined;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(OFFLINE_MEDIA_PACK_LIMITS.maximumManifestBytes + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return Promise.resolve({
        status: 200,
        ok: true,
        redirected: false,
        url: 'http://localhost/media/listen-mvp/offline-pack.json',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body,
        json: async () => {
          throw new Error('response.json must not bypass the bounded stream');
        },
      } as unknown as Response);
    }));

    try {
      await act(async () => {
        root.render(createElement(PublishedListenMvp, { lesson: LISTEN_MVP_PILOT_LESSONS[0] }));
      });
      const button = findElement(container, candidate => (
        candidate.tagName === 'button' && textContent(candidate) === 'Download audio'
      ));
      if (!button) throw new Error('Download button was not rendered.');
      await act(async () => {
        invokeClick(button);
        await flushReact();
      });

      expect(textContent(container)).toContain('Offline audio could not be prepared.');
      expect(textContent(container)).toContain('Retry download');
      expect(mocked.manager.install).not.toHaveBeenCalled();
      expect(requestSignal?.aborted).toBe(true);
      expect(cancelled).toBe(true);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('times out a stalled manifest request and exposes retry', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    let requestSignal: AbortSignal | undefined;
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }));

    try {
      await act(async () => {
        root.render(createElement(PublishedListenMvp, { lesson: LISTEN_MVP_PILOT_LESSONS[0] }));
      });
      const button = findElement(container, candidate => (
        candidate.tagName === 'button' && textContent(candidate) === 'Download audio'
      ));
      if (!button) throw new Error('Download button was not rendered.');
      await act(async () => {
        invokeClick(button);
        await flushReact();
      });
      expect(textContent(container)).toContain('Downloading the reviewed audio pack');

      await act(async () => {
        vi.advanceTimersByTime(OFFLINE_MEDIA_PACK_LIMITS.fetchTimeoutMs);
        await flushReact();
      });

      expect(requestSignal?.aborted).toBe(true);
      expect(textContent(container)).toContain('Offline audio could not be prepared.');
      expect(textContent(container)).toContain('Retry download');
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

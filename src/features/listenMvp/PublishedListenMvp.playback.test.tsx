import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { LISTEN_MVP_PILOT_LESSONS } from './listenMvpPilot';
import { PUBLISHED_LISTEN_MVP_MANIFEST, PublishedListenMvp } from './PublishedListenMvp';

const mocked = vi.hoisted(() => ({
  manager: { install: vi.fn(), resolveCachedClip: vi.fn() },
}));

vi.mock('../offlineMedia/offlineMediaPack', async () => ({
  ...(await vi.importActual<typeof import('../offlineMedia/offlineMediaPack')>('../offlineMedia/offlineMediaPack')),
  createOfflineMediaPackManager: () => mocked.manager,
}));

class FakeElement {
  readonly nodeType: number = 1;
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
  readonly childNodes: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly srcHistory: Array<string | null> = [];
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
  appendChild<T extends FakeElement>(child: T): T { child.parentNode = this; this.childNodes.push(child); return child; }
  insertBefore<T extends FakeElement>(child: T, before: FakeElement | null): T {
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child);
    return child;
  }
  removeChild<T extends FakeElement>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'src') this.srcHistory.push(value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === 'src') this.srcHistory.push(null);
  }
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
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    createElement: (t: string) => { const e = new FakeElement(t); e.ownerDocument = documentLike; return e; },
    createElementNS: (_n: string, t: string) => { const e = new FakeElement(t); e.ownerDocument = documentLike; return e; },
    createTextNode: (t: string) => { const n = new FakeTextNode(t); n.ownerDocument = documentLike; return n; },
    createComment: (t: string) => { const n = new FakeTextNode(t); n.ownerDocument = documentLike; return n; },
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
const find = (node: FakeElement, p: (c: FakeElement) => boolean): FakeElement | null => {
  if (p(node)) return node;
  for (const c of node.childNodes) { const m = find(c, p); if (m) return m; }
  return null;
};
const text = (n: FakeElement): string => n.childNodes.length === 0
  ? n.textContent : n.childNodes.map(c => c.tagName === '#text' ? (c as FakeTextNode).text : text(c)).join('');
const click = (el: FakeElement) => {
  const key = Object.keys(el).find(k => k.startsWith('__reactProps$'))!;
  ((el as unknown as Record<string, { onClick: (e: unknown) => void }>)[key]).onClick({ currentTarget: el, preventDefault() {}, stopPropagation() {} });
};

describe('finishing the offline download while the online clip plays', () => {
  it('keeps the online source in place once playback has started', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    let finishInstall!: () => void;
    mocked.manager.install.mockReset();
    mocked.manager.install.mockReturnValue(new Promise<void>(resolve => { finishInstall = resolve; }));
    let installed = false;
    mocked.manager.resolveCachedClip.mockReset();
    mocked.manager.resolveCachedClip.mockImplementation(async () => (
      installed ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }) : null
    ));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(PUBLISHED_LISTEN_MVP_MANIFEST), { headers: { 'Content-Type': 'application/json' } })));
    const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
    try {
      await act(async () => { root.render(createElement(PublishedListenMvp, { lesson: LISTEN_MVP_PILOT_LESSONS[0] })); await flush(); });
      const audio = find(container, c => c.tagName === 'audio')!;
      const online = audio.getAttribute('src');
      expect(online).toBe(LISTEN_MVP_PILOT_LESSONS[0].clip.path);
      // learner presses play on the online clip, then taps Download audio
      const props = (audio as unknown as Record<string, { onPlay?: () => void }>)[Object.keys(audio).find(k => k.startsWith('__reactProps$'))!];
      props.onPlay?.();
      const button = find(container, c => c.tagName === 'button' && text(c) === 'Download audio')!;
      await act(async () => { click(button); await flush(); });
      expect(text(container)).toContain('Downloading audio');
      const historyAtPlayback = audio.srcHistory.length;
      installed = true;
      await act(async () => { finishInstall(); await flush(); await flush(); });
      expect(audio.getAttribute('src')).toBe(online);
      expect(audio.srcHistory.slice(historyAtPlayback)).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});

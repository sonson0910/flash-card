import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ListenMvpLessonV1 } from './listenMvpContract';
import {
  LISTEN_MVP_CACHE_LOOKUP_TIMEOUT_MS,
  ListenMvp,
  createListenMvpCachedAudioSource,
  getListenMvpAudioState,
  listenMvpClipKey,
  shouldAdoptListenMvpCachedAudio,
} from './ListenMvp';

const lesson: ListenMvpLessonV1 = {
  clip: {
    schemaVersion: 1,
    id: 'hotel-clip',
    language: 'en',
    mediaKind: 'audio',
    path: 'media/hotel-clip.mp3',
    mimeType: 'audio/mpeg',
    byteLength: 4_096,
    durationMs: 5_000,
    contentRights: {
      schemaVersion: 1,
      registryVersion: 1,
      sourceRef: 'voa-learning-english-pilot',
      sourceAssetSha256: 'a'.repeat(64),
    },
    transcriptCues: [{
      schemaVersion: 1,
      id: 'cue-1',
      clipId: 'hotel-clip',
      language: 'en',
      startMs: 0,
      endMs: 2_000,
      text: 'I would like to book a room.',
    }],
  },
  chunk: {
    schemaVersion: 1,
    id: 'book-a-room',
    language: 'en',
    kind: 'phrase',
    text: 'book a room',
    lexemeIds: ['book'],
    contentRights: {
      schemaVersion: 1,
      registryVersion: 1,
      sourceRef: 'voa-learning-english-pilot',
      sourceAssetSha256: 'a'.repeat(64),
    },
  },
  comprehension: {
    question: 'What does the speaker want to do?',
    options: ['Book a room', 'Buy a ticket'],
    answer: 'Book a room',
  },
  sources: [{
    sourceRef: 'voa-learning-english-pilot',
    sourceUrl: 'https://learningenglish.voanews.com/example',
    licenseId: 'PUBLIC-DOMAIN',
    attribution: 'Voice of America Learning English',
  }],
};

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

const findElement = (node: FakeElement, predicate: (candidate: FakeElement) => boolean): FakeElement | null => {
  if (predicate(node)) return node;
  for (const child of node.childNodes) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
};

describe('ListenMvp', () => {
  const identity = {
    catalogId: 'catalog-one',
    releaseId: 'release-one',
    sha256: 'b'.repeat(64),
  };

  it('states clearly when no reviewed lesson is available', () => {
    const html = renderToStaticMarkup(<ListenMvp lesson={null} />);

    expect(html).toContain('Reviewed listening is not installed yet');
    expect(html).toContain('Draft media is never played.');
    expect(html).not.toContain('<audio');
  });

  it('renders accessible audio controls, captions, comprehension, and source evidence', () => {
    const html = renderToStaticMarkup(<ListenMvp lesson={lesson} onSaveChunk={vi.fn()} />);

    expect(html).toContain('<audio');
    expect(html).toContain('controls=""');
    expect(html).toContain('Listen to book a room');
    expect(html).toContain('Replay');
    expect(html).toContain('0.75×');
    expect(html).toContain('1×');
    expect(html).toContain('Captions');
    expect(html).toContain('I would like to book a room.');
    expect(html).toContain('What does the speaker want to do?');
    expect(html).toContain('Book a room');
    expect(html).toContain('Save phrase');
    expect(html).toContain('https://learningenglish.voanews.com/example');
    expect(html).toContain('PUBLIC-DOMAIN');
    expect(html).toContain('Voice of America Learning English');
  });

  it('does not expose a learner-data action unless the caller supplies the seam', () => {
    const html = renderToStaticMarkup(<ListenMvp lesson={lesson} />);

    expect(html).not.toContain('Save phrase');
    expect(html).toContain('Source and attribution');
  });

  it('creates and revokes cached audio object URLs exactly once', async () => {
    const createObjectURL = vi.fn(() => 'blob:cached-listen');
    const revokeObjectURL = vi.fn();
    const source = await createListenMvpCachedAudioSource(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/wav' } }),
      { createObjectURL, revokeObjectURL },
    );

    expect(source.url).toBe('blob:cached-listen');
    source.revoke();
    source.revoke();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cached-listen');
  });

  it('keeps audio cache-first while an optional cache lookup settles', () => {
    const clipKey = listenMvpClipKey(lesson.clip, identity);
    const resolver = { resolveCachedClip: vi.fn() };

    expect(getListenMvpAudioState(lesson, resolver, null, null, identity)).toEqual({
      pending: true,
      src: undefined,
    });
    expect(getListenMvpAudioState(lesson, resolver, {
      clipKey,
      status: 'ready',
    }, null, identity)).toEqual({
      pending: false,
      src: lesson.clip.path,
    });
    expect(getListenMvpAudioState(lesson, resolver, {
      clipKey,
      status: 'ready',
    }, {
      clipKey,
      source: { url: 'blob:cached-listen', revoke: vi.fn() },
    }, identity)).toEqual({
      pending: false,
      src: 'blob:cached-listen',
    });
    expect(getListenMvpAudioState(lesson, undefined, null, null)).toEqual({
      pending: false,
      src: lesson.clip.path,
    });
  });

  it('falls back to the online lesson path when cache identity is absent', () => {
    const resolver = { resolveCachedClip: vi.fn() };
    const html = renderToStaticMarkup(
      <ListenMvp lesson={lesson} offlineMediaPacks={resolver} />,
    );

    expect(html).toContain('src="media/hotel-clip.mp3"');
    expect(html).not.toContain('aria-busy="true"');
  });

  it('keys cached audio by full clip identity and offline release context', () => {
    expect(listenMvpClipKey(lesson.clip, identity)).not.toBe(listenMvpClipKey({
      ...lesson.clip,
      transcriptCues: [{
        ...lesson.clip.transcriptCues[0],
        text: 'Different transcript',
      }],
    }, identity));
    expect(listenMvpClipKey(lesson.clip, identity)).not.toBe(listenMvpClipKey(
      lesson.clip,
      { ...identity, releaseId: 'release-two' },
    ));
    expect(shouldAdoptListenMvpCachedAudio(false, false)).toBe(true);
    expect(shouldAdoptListenMvpCachedAudio(false, true)).toBe(false);
    expect(shouldAdoptListenMvpCachedAudio(true, false)).toBe(false);
  });

  it('falls back online after a bounded lookup and rejects a late cache result', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    vi.useFakeTimers();
    let resolveCache!: (response: Response) => void;
    const responsePromise = new Promise<Response>(resolve => {
      resolveCache = resolve;
    });
    const resolver = { resolveCachedClip: vi.fn(() => responsePromise) };
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late-cache');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    try {
      await act(async () => {
        root.render(createElement(ListenMvp, {
          lesson,
          offlineMediaPacks: resolver,
          offlineMediaPackIdentity: identity,
        }));
      });
      const audio = findElement(container, candidate => candidate.tagName === 'audio');
      if (!audio) throw new Error('Listen audio was not rendered.');
      expect(audio.getAttribute('src')).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LISTEN_MVP_CACHE_LOOKUP_TIMEOUT_MS);
      });
      expect(audio.getAttribute('src')).toBe(lesson.clip.path);

      const equivalentLesson = {
        ...lesson,
        clip: { ...lesson.clip },
        chunk: { ...lesson.chunk },
        comprehension: { ...lesson.comprehension, options: [...lesson.comprehension.options] },
        sources: [...lesson.sources],
      };
      await act(async () => root.render(createElement(ListenMvp, {
        lesson: equivalentLesson,
        offlineMediaPacks: resolver,
        offlineMediaPackIdentity: { ...identity },
      })));
      expect(resolver.resolveCachedClip).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveCache(new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'audio/wav' },
        }));
        await responsePromise;
      });
      expect(audio.getAttribute('src')).toBe(lesson.clip.path);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:late-cache');
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

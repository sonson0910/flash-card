import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { ListenMvpLessonV1 } from './listenMvpContract';
import {
  LISTEN_MVP_CACHE_LOOKUP_TIMEOUT_MS,
  ListenMvp,
  createListenMvpCachedAudioSource,
  getListenMvpAudioState,
  listenMvpClipKey,
  listenMvpSaveLabel,
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

const resolvedCard: CardData = {
  id: 'word-book-a-room',
  word: 'book a room',
  normalizedWord: 'book a room',
  translation: 'đặt phòng',
  explanation: 'reserve a room',
  phonetic: '',
  emoji: '📚',
  category: 'Travel',
  audioUrl: null,
  imageUrl: null,
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
  getAttributeNames() { return [...this.attributes.keys()]; }
  addEventListener() {}
  removeEventListener() {}
}

class FakeTextNode extends FakeElement {
  readonly nodeType = 3;
  constructor(public text: string) { super('#text'); }
  get nodeValue() { return this.text; }
  set nodeValue(value: string | null) { this.text = value ?? ''; }
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

const textContent = (node: FakeElement): string => (
  node.childNodes.length === 0
    ? node.textContent
    : node.childNodes.map(child => child instanceof FakeTextNode ? child.text : textContent(child)).join('')
);

const invokeClick = (element: FakeElement) => {
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
  const props = propsKey
    ? (element as unknown as Record<string, unknown>)[propsKey] as { onClick?: (event: unknown) => void }
    : undefined;
  if (!props?.onClick) throw new Error('React click handler was not attached.');
  props.onClick({ currentTarget: element, preventDefault: () => undefined, stopPropagation: () => undefined });
};

const findSaveButton = (container: FakeElement): FakeElement => {
  const button = findElement(container, candidate => (
    candidate.tagName === 'button' && textContent(candidate).includes('Save phrase')
  ));
  if (!button) throw new Error('Listen save button was not rendered.');
  return button;
};

const findPracticeButton = (container: FakeElement): FakeElement => {
  const button = findElement(container, candidate => (
    candidate.tagName === 'button' && textContent(candidate).includes('Practise this phrase')
  ));
  if (!button) throw new Error('Listen practice button was not rendered.');
  return button;
};

const flushReact = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('ListenMvp', () => {
  const identity = {
    catalogId: 'catalog-one',
    releaseId: 'release-one',
    sha256: 'b'.repeat(64),
  };

  it('states clearly when no listening lesson is available', () => {
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

  it('uses stable device-only copy after every save', () => {
    expect(listenMvpSaveLabel('idle')).toBe('Save phrase');
    expect(listenMvpSaveLabel('saving')).toBe('Saving…');
    expect(listenMvpSaveLabel('saved')).toBe('Saved on this device');
  });

  it('shows the practice CTA only for a resolved card and returns its opener', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    const onPracticePhrase = vi.fn();

    try {
      await act(async () => {
        root.render(createElement(ListenMvp, {
          lesson,
          resolvedCards: [resolvedCard],
          onPracticePhrase,
        }));
      });

      expect(textContent(container)).toContain('Practise this phrase');
      expect(textContent(container)).not.toContain('Save phrase');
      const button = findPracticeButton(container);
      invokeClick(button);
      expect(onPracticePhrase).toHaveBeenCalledOnce();
      expect(onPracticePhrase.mock.calls[0]?.[0]).toEqual([resolvedCard]);
      expect(onPracticePhrase.mock.calls[0]?.[1]).toBe(button);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('promotes the real resolved card returned by Save into the practice CTA', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    const onSaveChunk = vi.fn(async () => [resolvedCard]);
    const onPracticePhrase = vi.fn();

    try {
      await act(async () => {
        root.render(createElement(ListenMvp, { lesson, onSaveChunk, onPracticePhrase }));
      });
      await act(async () => {
        invokeClick(findSaveButton(container));
        await flushReact();
      });

      expect(textContent(container)).toContain('Practise this phrase');
      expect(textContent(container)).not.toContain('Save phrase');
      invokeClick(findPracticeButton(container));
      expect(onPracticePhrase.mock.calls[0]?.[0]).toEqual([resolvedCard]);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('keeps a double click to one in-flight save', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    let resolveSave!: () => void;
    const onSaveChunk = vi.fn(() => new Promise<void>(resolve => { resolveSave = resolve; }));

    try {
      await act(async () => {
        root.render(createElement(ListenMvp, { lesson, onSaveChunk }));
      });
      const button = findSaveButton(container);
      await act(async () => {
        invokeClick(button);
        invokeClick(button);
        await flushReact();
      });

      expect(onSaveChunk).toHaveBeenCalledOnce();
      expect(textContent(container)).toContain('Saving…');
      await act(async () => {
        resolveSave();
        await flushReact();
      });
      expect(textContent(container)).toContain('Saved on this device');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('shows a failure and permits a later retry', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    let attempts = 0;
    const onSaveChunk = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('busy');
    });

    try {
      await act(async () => {
        root.render(createElement(ListenMvp, { lesson, onSaveChunk }));
      });
      await act(async () => {
        invokeClick(findSaveButton(container));
        await flushReact();
      });
      expect(onSaveChunk).toHaveBeenCalledOnce();
      expect(textContent(container)).toContain('The phrase was not saved.');

      await act(async () => {
        invokeClick(findSaveButton(container));
        await flushReact();
      });
      expect(onSaveChunk).toHaveBeenCalledTimes(2);
      expect(textContent(container)).toContain('Saved on this device');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('resets and ignores a stale completion across owner and clip changes', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    const pending: Array<() => void> = [];
    const onSaveChunk = vi.fn(() => new Promise<void>(resolve => { pending.push(resolve); }));
    const otherLesson = {
      ...lesson,
      clip: { ...lesson.clip, id: 'second-clip', path: 'media/second-clip.mp3' },
    };

    try {
      await act(async () => {
        root.render(createElement(ListenMvp, { lesson, ownerId: 'owner-a', onSaveChunk }));
      });
      await act(async () => {
        invokeClick(findSaveButton(container));
        await flushReact();
      });

      await act(async () => {
        root.render(createElement(ListenMvp, { lesson, ownerId: 'owner-b', onSaveChunk }));
        await flushReact();
      });
      await act(async () => {
        root.render(createElement(ListenMvp, { lesson, ownerId: 'owner-a', onSaveChunk }));
        await flushReact();
      });
      expect(textContent(container)).toContain('Save phrase');
      pending[0]();
      await act(async () => { await flushReact(); });
      expect(textContent(container)).toContain('Save phrase');
      expect(textContent(container)).not.toContain('Saved on this device');

      await act(async () => {
        invokeClick(findSaveButton(container));
        await flushReact();
      });
      await act(async () => {
        root.render(createElement(ListenMvp, { lesson: otherLesson, ownerId: 'owner-a', onSaveChunk }));
        await flushReact();
      });
      pending[1]();
      await act(async () => { await flushReact(); });
      expect(textContent(container)).toContain('Save phrase');
      expect(textContent(container)).not.toContain('Saved on this device');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
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

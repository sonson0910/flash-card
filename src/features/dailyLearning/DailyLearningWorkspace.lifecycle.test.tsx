import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import DailyLearningWorkspace from './DailyLearningWorkspace';
import type { CardData } from '../../types/card';

vi.mock('../listenMvp/listenMvpPilot', () => ({
  LISTEN_MVP_PILOT_LESSONS: [],
  selectListenMvpPilotLesson: vi.fn(),
}));

vi.mock('./LessonScreen', () => ({
  LessonScreen: ({ model, actions }: any) => (
    <section>
      <p>{model.card?.word}</p>
      <button type="button" onClick={actions.playAudio}>Play audio</button>
      <button type="button" onClick={actions.submitAnswer}>Submit answer</button>
      <button type="button" onClick={() => actions.rate('good')}>Rate good</button>
    </section>
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
  const windowLike = Object.create(globalThis) as Record<string, unknown>;
  windowLike.location = { href: 'http://localhost/?lesson=listening' };
  windowLike.addEventListener = vi.fn();
  windowLike.removeEventListener = vi.fn();
  windowLike.document = documentLike;
  documentLike.defaultView = windowLike;
  documentLike.documentElement = container;
  documentLike.body = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', windowLike);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('Node', FakeElement);
  return container;
};

const textContent = (node: FakeElement): string => (
  node.childNodes.length === 0
    ? node.textContent
    : node.childNodes.map(child => child instanceof FakeTextNode ? child.text : textContent(child)).join('')
);

const findButton = (node: FakeElement, label: string): FakeElement | null => {
  if (node.tagName === 'button' && textContent(node) === label) return node;
  for (const child of node.childNodes) {
    const match = findButton(child, label);
    if (match) return match;
  }
  return null;
};

const invokeClick = (element: FakeElement) => {
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
  const props = propsKey
    ? (element as unknown as Record<string, unknown>)[propsKey] as { onClick?: () => void }
    : undefined;
  if (!props?.onClick) throw new Error('React click handler was not attached.');
  props.onClick();
};

const flushReact = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const card = (id: string, word: string): CardData => ({
  id,
  word,
  translation: `meaning of ${word}`,
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'Test',
  audioUrl: `https://ssl.gstatic.com/${id}.mp3`,
  imageUrl: null,
  reviews: 1,
  nextReviewDate: '2000-01-01T00:00:00.000Z',
});

describe('DailyLearningWorkspace audio lifecycle', () => {
  it('stops owned lesson audio once when rating advances to the next exercise', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    const audio = { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) };
    vi.stubGlobal('Audio', vi.fn(() => audio));

    try {
      await act(async () => {
        root.render(createElement(DailyLearningWorkspace, {
          ownerId: null,
          isOffline: false,
          initialLesson: 'listening',
          loadPracticePool: vi.fn(async () => [card('first', 'first word'), card('second', 'second word')]),
          reviewCard: vi.fn(async () => ({ status: 'published' as const, result: {} as never })),
          openLesson: vi.fn(),
          openVocabulary: vi.fn(),
          openPaths: vi.fn(),
          continueReview: vi.fn(),
          openMorePractice: vi.fn(),
        }));
        await flushReact();
      });
      expect(textContent(container)).toContain('first word');

      const play = findButton(container, 'Play audio');
      if (!play) throw new Error('Play audio button was not rendered.');
      await act(async () => { invokeClick(play); await flushReact(); });

      const submit = findButton(container, 'Submit answer');
      if (!submit) throw new Error('Submit answer button was not rendered.');
      await act(async () => { invokeClick(submit); await flushReact(); });

      const rate = findButton(container, 'Rate good');
      if (!rate) throw new Error('Rate button was not rendered.');
      await act(async () => {
        invokeClick(rate);
        await flushReact();
      });

      expect(textContent(container)).toContain('second word');
      expect(audio.pause).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});

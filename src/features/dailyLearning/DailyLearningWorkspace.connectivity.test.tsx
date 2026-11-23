import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
i18n.load('en', {}); i18n.activate('en');
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import DailyLearningWorkspace from '../dailyLearning/DailyLearningWorkspace';
import type { CardData } from '../../types/card';

vi.mock('../listenMvp/listenMvpPilot', () => ({
  LISTEN_MVP_PILOT_LESSONS: [],
  selectListenMvpPilotLesson: vi.fn(),
}));

vi.mock('./LessonScreen', () => ({
  LessonScreen: ({ model }: any) => (
    <section>
      <p>{`word:${model.card?.word}`}</p>
      <p>{`audio:${String(model.card?.audioUrl)}`}</p>
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
  windowLike.location = { href: 'http://localhost/' };
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
  if (node.tagName === 'button' && textContent(node).includes(label)) return node;
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
  id, word, translation: `meaning of ${word}`, explanation: '', phonetic: '', emoji: '', category: 'Test',
  audioUrl: `https://ssl.gstatic.com/${id}.mp3`, imageUrl: null, reviews: 1, nextReviewDate: '2000-01-01T00:00:00.000Z',
});

const startRecognitionAfter = async (steps: readonly boolean[]) => {
  const container = installMinimalReactDom();
  const root = createRoot(container as unknown as Element);
  const loadPracticePool = vi.fn(async () => [card('first', 'first word'), card('second', 'second word')]);
  const base = {
    languageProfile: ENGLISH_TO_VIETNAMESE_PROFILE, streak: 0, studyXpHistory: [], openWeeklyRecap: () => undefined,
    onVerifiedPracticeOutcome: () => undefined, ownerId: null, initialLesson: null, loadPracticePool,
    reviewCard: vi.fn(), openLesson: vi.fn(), openVocabulary: vi.fn(), openPaths: vi.fn(), continueReview: vi.fn(), openMorePractice: vi.fn(),
  };
  const render = (isOffline: boolean) => root.render(createElement(I18nProvider, { i18n }, createElement(DailyLearningWorkspace, { ...base, isOffline } as never)));
  try {
    for (const isOffline of steps) await act(async () => { render(isOffline); await flushReact(); });
    const start = findButton(container, 'Recognition');
    if (!start) throw new Error('lesson mode button not rendered: ' + textContent(container).slice(0, 400));
    await act(async () => { invokeClick(start); await flushReact(); });
    return textContent(container);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
};

describe('a lesson follows the connectivity at the moment it starts', () => {
  it('keeps card audio when the network came back before the lesson started', async () => {
    const text = await startRecognitionAfter([true, false]);
    expect(text).toContain('word:');
    expect(text).toContain('audio:https://ssl.gstatic.com/');
  });

  it('strips card audio when the network dropped before the lesson started', async () => {
    const text = await startRecognitionAfter([false, true]);
    expect(text).toContain('word:');
    expect(text).toContain('audio:null');
  });
});

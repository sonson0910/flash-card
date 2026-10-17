import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import type { LessonScreenActions, LessonScreenModel } from './dailyLearningPresentation';

const screens = vi.hoisted(() => ({
  lesson: null as { model: LessonScreenModel; actions: LessonScreenActions } | null,
}));

vi.mock('../../lib/haptics', () => ({ triggerHaptic: vi.fn() }));
vi.mock('../practice/practiceSessionService', () => ({
  firebasePracticeSessionService: { start: vi.fn(), complete: vi.fn() },
  practiceTimeZone: () => 'UTC',
}));
vi.mock('./TodayScreen', () => ({ TodayScreen: () => null }));
vi.mock('./LessonScreen', () => ({
  LessonScreen: (props: { model: LessonScreenModel; actions: LessonScreenActions }) => {
    screens.lesson = props;
    return null;
  },
}));
vi.mock('./PlacementScreen', () => ({ PlacementScreen: () => null }));
vi.mock('./SessionBridge', () => ({ SessionBridge: () => null }));
vi.mock('../practice/WordMatchView', () => ({ WordMatchView: () => null }));
vi.mock('../practice/SessionRecapModal', () => ({ SessionRecapModal: () => null }));

import DailyLearningWorkspace from './DailyLearningWorkspace';
import {
  emptyDailySessionStats,
  readDailySessionPointer,
  writeDailySessionPointer,
} from './dailySessionStages';
import { logicalIdentity } from './dailyPlan';
import { promoteCardsToActiveSessionNewStage } from './webWordsSessionPriority';

const OWNER = 'owner-a';
const PAIR = { targetLanguage: 'en', translationLanguage: 'vi' } as const;

const card = (id: string): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `${id.split('-')[0]} meaning`,
  language: 'en',
  translationLanguage: 'vi',
  createdAt: '2026-10-03T00:00:00.000Z',
  difficulty: 'unrated',
  reviews: 0,
  source: { url: 'https://example.com/article', capturedAt: '2026-10-03T00:00:00.000Z' },
} as CardData);

const installMinimalReactDom = () => {
  const storage = new Map<string, string>();
  const makeNode = (nodeType: number, nodeName: string) => {
    const node: Record<string, unknown> = {
      nodeType,
      nodeName,
      tagName: nodeName,
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      parentNode: null,
      childNodes: [] as unknown[],
      style: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      appendChild(child: Record<string, unknown>) {
        child.parentNode = node;
        (node.childNodes as unknown[]).push(child);
        return child;
      },
      insertBefore(child: Record<string, unknown>, before: unknown) {
        child.parentNode = node;
        const children = node.childNodes as unknown[];
        const index = children.indexOf(before);
        children.splice(index < 0 ? children.length : index, 0, child);
        return child;
      },
      removeChild(child: Record<string, unknown>) {
        const children = node.childNodes as unknown[];
        const index = children.indexOf(child);
        if (index >= 0) children.splice(index, 1);
        child.parentNode = null;
        return child;
      },
    };
    return node;
  };
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    defaultView: globalThis,
    createElement: (name: string) => {
      const element = makeNode(1, name.toUpperCase());
      element.ownerDocument = documentLike;
      return element;
    },
    createTextNode: (value: string) => {
      const text = makeNode(3, '#text');
      text.nodeValue = value;
      text.ownerDocument = documentLike;
      return text;
    },
  };
  const container = makeNode(1, 'DIV');
  container.ownerDocument = documentLike;
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', Object.assign(globalThis, {
    location: { href: 'https://app.example.com/today?lesson=session' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

afterEach(() => {
  screens.lesson = null;
  vi.unstubAllGlobals();
});

it('commits a loaded same-pair WebWord into a mounted session and serves it next without reloading', async () => {
  const current = card('current-word');
  const promoted = card('promoted-word');
  const loadPracticePool = vi.fn().mockResolvedValue([current, promoted]);
  const reviewCard = vi.fn().mockResolvedValue({
    status: 'published',
    result: { xpAwarded: 10 },
  });
  const container = installMinimalReactDom();
  writeDailySessionPointer({
    ownerId: OWNER,
    ...PAIR,
    stage: 'new',
    reviewLogicalIds: [],
    freshLogicalIds: [logicalIdentity(current)],
    matchCardIds: [],
    matchSkipReason: 'insufficient-pairs',
    matchStartOpId: null,
    matchCompletionId: null,
    matchCompletionPending: false,
    stats: emptyDailySessionStats,
    startedAt: '2026-10-03T00:00:00.000Z',
  });
  i18n.load('en', {});
  i18n.activate('en');
  const root = createRoot(container);

  await act(async () => {
    root.render(<I18nProvider i18n={i18n}><DailyLearningWorkspace
      ownerId={OWNER}
      languageProfile={ENGLISH_TO_VIETNAMESE_PROFILE}
      isOffline={false}
      initialLesson="session"
      streak={0}
      studyXpHistory={[]}
      loadPracticePool={loadPracticePool}
      reviewCard={reviewCard}
      openLesson={vi.fn()}
      openVocabulary={vi.fn()}
      openPaths={vi.fn()}
      continueReview={vi.fn()}
      openMorePractice={vi.fn()}
      openWeeklyRecap={vi.fn()}
      onVerifiedPracticeOutcome={vi.fn()}
    /></I18nProvider>);
  });
  await act(async () => {
    await vi.waitFor(() => expect(screens.lesson?.model.prompt).toBe(current.translation));
  });

  await act(async () => {
    expect(promoteCardsToActiveSessionNewStage(OWNER, [promoted], PAIR)).toBe('promoted');
  });

  expect(readDailySessionPointer(OWNER)).toMatchObject({
    stage: 'new',
    freshLogicalIds: [logicalIdentity(promoted), logicalIdentity(current)],
  });
  expect(screens.lesson?.model.progress).toEqual({ current: 1, total: 2 });

  await act(async () => { screens.lesson?.actions.chooseAnswer(current.word); });
  await act(async () => { screens.lesson?.actions.submitAnswer(); });
  await act(async () => { screens.lesson?.actions.rate('good'); });
  await act(async () => {
    await vi.waitFor(() => expect(screens.lesson?.model.prompt).toBe(promoted.translation));
  });

  expect(screens.lesson?.model.progress).toEqual({ current: 2, total: 2 });
  expect(loadPracticePool).toHaveBeenCalledTimes(1);
  expect(reviewCard).toHaveBeenCalledWith(current.id, 'good', expect.any(String), current);

  await act(async () => root.unmount());
});

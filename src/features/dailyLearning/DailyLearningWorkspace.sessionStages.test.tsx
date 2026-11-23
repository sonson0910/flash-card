import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';

const screens = vi.hoisted(() => ({
  today: null as any,
  lesson: null as any,
  bridge: null as any,
  match: null as any,
  recap: null as any,
}));

const practice = vi.hoisted(() => ({ start: null as any, complete: null as any }));

vi.mock('../../lib/haptics', () => ({ triggerHaptic: vi.fn() }));
// No Firestore at all: Today reads go nowhere.
vi.mock('./todayDatabase', () => ({ configuredTodayDatabase: () => null }));
vi.mock('../practice/practiceSessionService', () => ({
  firebasePracticeSessionService: {
    start: (...args: unknown[]) => practice.start(...args),
    complete: (...args: unknown[]) => practice.complete(...args),
  },
  practiceTimeZone: () => 'UTC',
}));
vi.mock('../../i18n/loadCatalog', async importOriginal => ({
  ...(await importOriginal<object>()),
  loadCatalog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./TodayScreen', async importOriginal => ({
  ...(await importOriginal<object>()),
  TodayScreen: (props: unknown) => { screens.today = props; return null; },
}));
vi.mock('./LessonScreen', () => ({
  LessonScreen: (props: unknown) => { screens.lesson = props; return null; },
}));
vi.mock('./PlacementScreen', () => ({ PlacementScreen: () => null }));
vi.mock('./SessionBridge', () => ({
  SessionBridge: (props: unknown) => { screens.bridge = props; return null; },
}));
vi.mock('../practice/WordMatchView', () => ({
  WordMatchView: (props: unknown) => { screens.match = props; return null; },
}));
vi.mock('../practice/SessionRecapModal', () => ({
  SessionRecapModal: (props: unknown) => { screens.recap = props; return null; },
}));

import DailyLearningWorkspace from './DailyLearningWorkspace';
import { emptyDailySessionStats, readDailySessionPointer, writeDailySessionPointer } from './dailySessionStages';
import { logicalIdentity } from './dailyPlan';

const OWNER = 'owner-session-stages';

const card = (id: string, overrides: Partial<CardData> = {}): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `${id} meaning`,
  language: 'en',
  translationLanguage: 'vi',
  createdAt: '2026-10-03T00:00:00.000Z',
  difficulty: 'unrated',
  reviews: 0,
  ...overrides,
} as CardData);

const installMinimalReactDom = () => {
  const storage = new Map<string, string>();
  const makeNode = (nodeType: number, nodeName: string) => {
    const node: Record<string, unknown> = {
      nodeType, nodeName, tagName: nodeName, namespaceURI: 'http://www.w3.org/1999/xhtml',
      parentNode: null, childNodes: [] as unknown[], style: {},
      addEventListener: vi.fn(), removeEventListener: vi.fn(), setAttribute: vi.fn(), removeAttribute: vi.fn(),
      appendChild(child: Record<string, unknown>) { child.parentNode = node; (node.childNodes as unknown[]).push(child); return child; },
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
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis,
    createElement: (name: string) => { const element = makeNode(1, name.toUpperCase()); element.ownerDocument = documentLike; return element; },
    createTextNode: (value: string) => { const text = makeNode(3, '#text'); text.nodeValue = value; text.ownerDocument = documentLike; return text; },
  };
  const container = makeNode(1, 'DIV');
  container.ownerDocument = documentLike;
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', Object.assign(globalThis, {
    location: { href: 'https://app.example.com/today?lesson=session' },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
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
  screens.today = null; screens.lesson = null; screens.bridge = null; screens.match = null; screens.recap = null;
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let index = 0; index < 15; index += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
};

const rateCurrent = async (rating: 'again' | 'good') => {
  await act(async () => { screens.lesson.actions.chooseAnswer('x'); });
  await act(async () => { screens.lesson.actions.submitAnswer(); });
  await act(async () => { screens.lesson.actions.rate(rating); });
  await act(async () => { await vi.waitFor(() => expect(screens.lesson.model.status).toBe('complete')); });
  await act(async () => { screens.lesson.actions.finish(); });
  await settle();
  expect(screens.bridge).not.toBeNull();
};


const KOREAN_PROFILE = {
  ...ENGLISH_TO_VIETNAMESE_PROFILE,
  id: 'ko-vi',
  source: { code: 'ko', displayName: 'Korean' },
} as typeof ENGLISH_TO_VIETNAMESE_PROFILE;

it('offers the English listening pilot only in an English course', async () => {
  const container = installMinimalReactDom();
  i18n.load('en', {}); i18n.activate('en');
  const root = createRoot(container);
  const render = (profile: typeof ENGLISH_TO_VIETNAMESE_PROFILE) => root.render(<I18nProvider i18n={i18n}><DailyLearningWorkspace
    ownerId={OWNER} database={null} languageProfile={profile} isOffline={false} initialLesson={null}
    streak={0} studyXpHistory={[]} loadPracticePool={vi.fn().mockResolvedValue([])} reviewCard={vi.fn()}
    openLesson={vi.fn()} openVocabulary={vi.fn()} openPaths={vi.fn()} continueReview={vi.fn()}
    openMorePractice={vi.fn()} openWeeklyRecap={vi.fn()} onVerifiedPracticeOutcome={vi.fn()}
  /></I18nProvider>);
  await act(async () => { render(ENGLISH_TO_VIETNAMESE_PROFILE); });
  await settle();
  expect(screens.today.model.listenPilotAvailable).toBe(true);
  await act(async () => { render(KOREAN_PROFILE); });
  await settle();
  expect(screens.today.model.listenPilotAvailable).toBe(false);
  await act(async () => root.unmount());
}, 30_000);

it('switching course while a Word Match completion is pending keeps the pending completion for retry', async () => {
  const pool = ['one', 'two', 'three', 'four'].map(id => card(`pair-${id}`, { reviews: 2, difficulty: 'good', nextReviewDate: '2099-01-01T00:00:00.000Z' } as Partial<CardData>));
  const byId = new Map(pool.map(entry => [entry.id, entry]));
  const loadPracticePool = vi.fn().mockResolvedValue(pool);
  const reviewCard = vi.fn();
  practice.start = vi.fn(async ({ cardIds }: { cardIds: string[] }) => ({
    sessionId: 'start-op', game: 'match', expiresAt: '2099-01-01T00:00:00.000Z',
    challenge: { kind: 'match', cards: cardIds.map(id => ({ cardId: id, word: byId.get(id)!.word, translation: byId.get(id)!.translation })) },
  }));
  // The completion call fails once (network or server error), so the earned round stays pending.
  practice.complete = vi.fn(async () => { throw new Error('unavailable'); });
  const container = installMinimalReactDom();
  // The learner won the round; the pointer holds the pending completion (as completeDailyMatch writes it).
  writeDailySessionPointer({
    ownerId: OWNER, targetLanguage: 'en', translationLanguage: 'vi', stage: 'match',
    reviewLogicalIds: [], freshLogicalIds: [],
    matchCardIds: pool.map(entry => entry.id), matchSkipReason: null,
    matchStartOpId: 'start-op', matchCompletionId: 'complete-op', matchTimeZone: 'UTC', matchCompletionPending: true,
    stats: emptyDailySessionStats, startedAt: '2026-10-03T00:00:00.000Z',
  });
  i18n.load('en', {}); i18n.activate('en');
  const root = createRoot(container);
  const render = (profile: typeof ENGLISH_TO_VIETNAMESE_PROFILE) => root.render(<I18nProvider i18n={i18n}><DailyLearningWorkspace
    ownerId={OWNER} database={null} languageProfile={profile} isOffline={false} initialLesson="session"
    streak={0} studyXpHistory={[]} loadPracticePool={loadPracticePool} reviewCard={reviewCard}
    openLesson={vi.fn()} openVocabulary={vi.fn()} openPaths={vi.fn()} continueReview={vi.fn()}
    openMorePractice={vi.fn()} openWeeklyRecap={vi.fn()} onVerifiedPracticeOutcome={vi.fn()}
  /></I18nProvider>);
  await act(async () => { render(ENGLISH_TO_VIETNAMESE_PROFILE); });
  await settle();
  expect(practice.complete).toHaveBeenCalledTimes(1);
  const beforeSwitch = readDailySessionPointer(OWNER);
  expect(beforeSwitch?.matchCompletionPending).toBe(true);

  // Same owner switches course in the top-bar switcher while the workspace stays mounted.
  await act(async () => { render(KOREAN_PROFILE); });
  await settle();
  // The earned round waits for its course and leaves the learner's session pointer free.
  expect(readDailySessionPointer(OWNER)).toBeNull();
  // Back in the original course the pending completion is retried with the same id.
  practice.complete = vi.fn(async () => ({
    sessionId: 'start-op', correct: 4, total: 4, awardedXp: 20,
    outcome: { xp: 500, level: 3, streak: 1, events: [], studyTimeMs: 60_000 },
  }));
  await act(async () => { render(ENGLISH_TO_VIETNAMESE_PROFILE); });
  await settle();
  await act(async () => { screens.today.actions.startSession(); });
  await settle();
  expect(practice.complete).toHaveBeenCalledTimes(1);
  expect(practice.complete).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'start-op', completionId: 'complete-op' }));
  await act(async () => root.unmount());
}, 30_000);

it('retrying weak cards from the recap reviews only the weak cards and does not replay the finished new and match stages', async () => {
  const due = card('due-word', { reviews: 1, difficulty: 'good', nextReviewDate: '2026-10-01T00:00:00.000Z' } as Partial<CardData>);
  const fresh = card('fresh-word');
  const m1 = card('match-one', { reviews: 2, difficulty: 'good', nextReviewDate: '2099-01-01T00:00:00.000Z' } as Partial<CardData>);
  const m2 = card('match-two', { reviews: 2, difficulty: 'good', nextReviewDate: '2099-01-01T00:00:00.000Z' } as Partial<CardData>);
  const pool = [due, fresh, m1, m2];
  const byId = new Map(pool.map(entry => [entry.id, entry]));
  const loadPracticePool = vi.fn().mockResolvedValue(pool);
  const reviewCard = vi.fn().mockResolvedValue({ status: 'published', result: { xpAwarded: 10 } });
  practice.start = vi.fn(async ({ cardIds }: { cardIds: string[] }) => ({
    sessionId: 'match-session', game: 'match', expiresAt: '2099-01-01T00:00:00.000Z',
    challenge: { kind: 'match', cards: cardIds.map(id => ({ cardId: id, word: byId.get(id)!.word, translation: byId.get(id)!.translation })) },
  }));
  // The server replays a completed session: same receipt, same awardedXp, same studyTimeMs.
  practice.complete = vi.fn(async () => ({
    sessionId: 'match-session', correct: 4, total: 4, awardedXp: 20,
    outcome: { xp: 500, level: 3, streak: 1, events: [], studyTimeMs: 60_000 },
  }));
  const container = installMinimalReactDom();
  writeDailySessionPointer({
    ownerId: OWNER, targetLanguage: 'en', translationLanguage: 'vi', stage: 'review',
    reviewLogicalIds: [logicalIdentity(due)], freshLogicalIds: [logicalIdentity(fresh)],
    matchCardIds: pool.map(entry => entry.id), matchSkipReason: null,
    matchStartOpId: null, matchCompletionId: null, matchCompletionPending: false,
    stats: emptyDailySessionStats, startedAt: '2026-10-03T00:00:00.000Z',
  });
  i18n.load('en', {}); i18n.activate('en');
  const root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider i18n={i18n}><DailyLearningWorkspace
      ownerId={OWNER} database={null} languageProfile={ENGLISH_TO_VIETNAMESE_PROFILE} isOffline={false} initialLesson="session"
      streak={0} studyXpHistory={[]} loadPracticePool={loadPracticePool} reviewCard={reviewCard}
      openLesson={vi.fn()} openVocabulary={vi.fn()} openPaths={vi.fn()} continueReview={vi.fn()}
      openMorePractice={vi.fn()} openWeeklyRecap={vi.fn()} onVerifiedPracticeOutcome={vi.fn()}
    /></I18nProvider>);
  });
  await act(async () => { await vi.waitFor(() => expect(screens.lesson?.model.prompt).toBe(due.word)); });

  // Review stage: the due card is rated Again, so it becomes a weak card.
  await rateCurrent('again');
  expect(screens.bridge.model.nextStage).toBe('new');
  screens.lesson = null;
  await act(async () => { screens.bridge.actions.continue(); });
  await act(async () => { await vi.waitFor(() => expect(screens.lesson?.model.prompt).toBe(fresh.word)); });
  screens.bridge = null;
  await rateCurrent('good');
  expect(screens.bridge.model.nextStage).toBe('match');
  await act(async () => { screens.bridge.actions.continue(); });
  await settle();
  expect(screens.match).not.toBeNull();
  await act(async () => { await screens.match.onComplete(screens.match.cards.map((entry: CardData) => ({ cardId: entry.id, word: entry.word, translation: entry.translation }))); });
  await settle();
  expect(screens.recap).not.toBeNull();
  const firstRecapXp = screens.recap.xpEarned;
  const firstRecapStudyTime = screens.recap.studyTimeMs;
  expect(firstRecapXp).toBe(10 + 10 + 20);
  expect(typeof screens.recap.onRetryWeak).toBe('function');

  // Retry weak cards: only the due card is weak.
  screens.lesson = null; screens.bridge = null; screens.match = null;
  await act(async () => { screens.recap.onRetryWeak(); });
  screens.recap = null;
  await act(async () => { await vi.waitFor(() => expect(screens.lesson?.model.prompt).toBe(due.word)); });
  // A reload during the retry still knows the finished round, so the recap can offer it again.
  expect(readDailySessionPointer(OWNER)).toMatchObject({ stage: 'review', matchCardIds: pool.map(entry => entry.id), matchFinished: true });
  await rateCurrent('good');
  const nextStageAfterRetry = screens.bridge.model.nextStage;

  // Follow the default Continue path to the end and record what the learner is shown.
  let guard = 0;
  while (!screens.recap && guard < 6) {
    guard += 1;
    if (screens.bridge && screens.bridge.model.nextStage !== 'recap') {
      const next = screens.bridge.model.nextStage;
      screens.lesson = null; screens.match = null;
      await act(async () => { screens.bridge.actions.continue(); });
      screens.bridge = null;
      if (next === 'match') {
        await settle();
        expect(screens.match).not.toBeNull();
        await act(async () => { await screens.match.onComplete(screens.match.cards.map((entry: CardData) => ({ cardId: entry.id, word: entry.word, translation: entry.translation }))); });
      } else {
        await settle();
        expect(screens.lesson).not.toBeNull();
        await rateCurrent('good');
      }
    } else if (screens.bridge) {
      await act(async () => { screens.bridge.actions.continue(); });
    }
    await act(async () => { await Promise.resolve(); });
  }

  const observed = {
    nextStageAfterRetry,
    reviewCardCallsForFreshWord: reviewCard.mock.calls.filter(call => call[0] === fresh.id).length,
    matchCompletionCalls: practice.complete.mock.calls.length,
    finalRecapXp: screens.recap?.xpEarned,
    finalRecapStudyTimeMs: screens.recap?.studyTimeMs,
    recapStillOffersWordMatch: typeof screens.recap?.onPlayWordMatch === 'function' && screens.recap?.wordMatchCount === 4,
  };
  expect(observed).toEqual({
    nextStageAfterRetry: 'recap',
    reviewCardCallsForFreshWord: 1,
    matchCompletionCalls: 1,
    finalRecapXp: firstRecapXp + 10,
    finalRecapStudyTimeMs: firstRecapStudyTime,
    recapStillOffersWordMatch: true,
  });
  await act(async () => root.unmount());
}, 30_000);

const pendingMatchPointer = (pool: readonly CardData[]) => ({
  ownerId: OWNER, targetLanguage: 'en', translationLanguage: 'vi', stage: 'match' as const,
  reviewLogicalIds: [], freshLogicalIds: [],
  matchCardIds: pool.map(entry => entry.id), matchSkipReason: null,
  matchStartOpId: 'start-op', matchCompletionId: 'complete-op', matchTimeZone: 'UTC', matchCompletionPending: true,
  stats: emptyDailySessionStats, startedAt: '2026-10-03T00:00:00.000Z',
});

it('a session in another course does not discard a Word Match completion that is waiting in the first course', async () => {
  const englishPool = ['one', 'two', 'three', 'four'].map(id => card(`pair-${id}`, { reviews: 2, difficulty: 'good', nextReviewDate: '2099-01-01T00:00:00.000Z' } as Partial<CardData>));
  const koreanDue = card('ko-due', { language: 'ko', reviews: 1, difficulty: 'good', nextReviewDate: '2026-10-01T00:00:00.000Z' } as Partial<CardData>);
  const pool = [...englishPool, koreanDue];
  const byId = new Map(pool.map(entry => [entry.id, entry]));
  const loadPracticePool = vi.fn().mockResolvedValue(pool);
  practice.start = vi.fn(async ({ cardIds }: { cardIds: string[] }) => ({
    sessionId: 'start-op', game: 'match', expiresAt: '2099-01-01T00:00:00.000Z',
    challenge: { kind: 'match', cards: cardIds.map(id => ({ cardId: id, word: byId.get(id)!.word, translation: byId.get(id)!.translation })) },
  }));
  practice.complete = vi.fn(async () => { throw new Error('unavailable'); });
  const container = installMinimalReactDom();
  writeDailySessionPointer(pendingMatchPointer(englishPool));
  i18n.load('en', {}); i18n.activate('en');
  const root = createRoot(container);
  const render = (profile: typeof ENGLISH_TO_VIETNAMESE_PROFILE, initialLesson: 'session' | null) => root.render(<I18nProvider i18n={i18n}><DailyLearningWorkspace
    ownerId={OWNER} database={null} languageProfile={profile} isOffline={false} initialLesson={initialLesson}
    streak={0} studyXpHistory={[]} loadPracticePool={loadPracticePool} reviewCard={vi.fn()}
    openLesson={vi.fn()} openVocabulary={vi.fn()} openPaths={vi.fn()} continueReview={vi.fn()}
    openMorePractice={vi.fn()} openWeeklyRecap={vi.fn()} onVerifiedPracticeOutcome={vi.fn()}
  /></I18nProvider>);
  await act(async () => { render(ENGLISH_TO_VIETNAMESE_PROFILE, 'session'); });
  await settle();
  expect(practice.complete).toHaveBeenCalledTimes(1);

  // The learner switches to Korean and starts a session there, which writes its own pointer.
  await act(async () => { render(KOREAN_PROFILE, null); });
  await settle();
  await act(async () => { screens.today.actions.startSession(); });
  await settle();
  expect(screens.lesson).not.toBeNull();
  expect(readDailySessionPointer(OWNER)).toMatchObject({ targetLanguage: 'ko' });

  // Back in English the earned completion is retried with its original ids.
  practice.complete = vi.fn(async () => ({
    sessionId: 'start-op', correct: 4, total: 4, awardedXp: 20,
    outcome: { xp: 500, level: 3, streak: 1, events: [], studyTimeMs: 60_000 },
  }));
  await act(async () => { render(ENGLISH_TO_VIETNAMESE_PROFILE, null); });
  await settle();
  await act(async () => { screens.today.actions.startSession(); });
  await settle();
  expect(practice.complete).toHaveBeenCalledTimes(1);
  expect(practice.complete).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'start-op', completionId: 'complete-op' }));
  await act(async () => root.unmount());
}, 30_000);

it('opens a listening lesson route in a course that has no English pilot', async () => {
  const koreanDue = card('ko-listen', { language: 'ko', reviews: 1, difficulty: 'good', nextReviewDate: '2026-10-01T00:00:00.000Z' } as Partial<CardData>);
  const container = installMinimalReactDom();
  vi.stubGlobal('window', Object.assign(globalThis, {
    location: { href: 'https://app.example.com/today?lesson=listening' },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  i18n.load('en', {}); i18n.activate('en');
  const root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider i18n={i18n}><DailyLearningWorkspace
      ownerId={OWNER} database={null} languageProfile={KOREAN_PROFILE} isOffline={false} initialLesson="listening"
      streak={0} studyXpHistory={[]} loadPracticePool={vi.fn().mockResolvedValue([koreanDue])} reviewCard={vi.fn()}
      openLesson={vi.fn()} openVocabulary={vi.fn()} openPaths={vi.fn()} continueReview={vi.fn()}
      openMorePractice={vi.fn()} openWeeklyRecap={vi.fn()} onVerifiedPracticeOutcome={vi.fn()}
    /></I18nProvider>);
  });
  await settle();
  expect(screens.lesson).not.toBeNull();
  await act(async () => root.unmount());
}, 30_000);

it('shows the Word Match preview word at the tier it reached in this session', async () => {
  const fresh = card('fresh-word');
  const due = card('due-word', { reviews: 1, difficulty: 'good', nextReviewDate: '2026-10-01T00:00:00.000Z' } as Partial<CardData>);
  const m1 = card('match-one', { reviews: 2, difficulty: 'good', nextReviewDate: '2099-01-01T00:00:00.000Z' } as Partial<CardData>);
  const m2 = card('match-two', { reviews: 2, difficulty: 'good', nextReviewDate: '2099-01-01T00:00:00.000Z' } as Partial<CardData>);
  // The new word comes first in the pool, so it is also the first Word Match card of the resumed session.
  const pool = [fresh, due, m1, m2];
  const loadPracticePool = vi.fn().mockResolvedValue(pool);
  const reviewCard = vi.fn(async (cardId: string) => ({
    status: 'published',
    result: {
      xpAwarded: 10,
      publication: { kind: 'patch', cardId, fields: { reviews: 1, difficulty: 'good', nextReviewDate: '2026-10-04T00:00:00.000Z' } },
    },
  }));
  const container = installMinimalReactDom();
  writeDailySessionPointer({
    ownerId: OWNER, targetLanguage: 'en', translationLanguage: 'vi', stage: 'review',
    reviewLogicalIds: [logicalIdentity(due)], freshLogicalIds: [logicalIdentity(fresh)],
    matchCardIds: pool.map(entry => entry.id), matchSkipReason: null,
    matchStartOpId: null, matchCompletionId: null, matchCompletionPending: false,
    stats: emptyDailySessionStats, startedAt: '2026-10-03T00:00:00.000Z',
  });
  i18n.load('en', {}); i18n.activate('en');
  const root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider i18n={i18n}><DailyLearningWorkspace
      ownerId={OWNER} database={null} languageProfile={ENGLISH_TO_VIETNAMESE_PROFILE} isOffline={false} initialLesson="session"
      streak={0} studyXpHistory={[]} loadPracticePool={loadPracticePool} reviewCard={reviewCard as never}
      openLesson={vi.fn()} openVocabulary={vi.fn()} openPaths={vi.fn()} continueReview={vi.fn()}
      openMorePractice={vi.fn()} openWeeklyRecap={vi.fn()} onVerifiedPracticeOutcome={vi.fn()}
    /></I18nProvider>);
  });
  await act(async () => { await vi.waitFor(() => expect(screens.lesson?.model.prompt).toBe(due.word)); });
  await rateCurrent('good');
  expect(screens.bridge.model.nextStage).toBe('new');
  screens.lesson = null;
  await act(async () => { screens.bridge.actions.continue(); });
  await act(async () => { await vi.waitFor(() => expect(screens.lesson?.model.prompt).toBe(fresh.word)); });
  screens.bridge = null;
  await rateCurrent('good');
  expect(screens.bridge.model.nextStage).toBe('match');
  expect(screens.bridge.model.previewCard).toMatchObject({ word: fresh.word, tier: 'learning' });
  await act(async () => root.unmount());
}, 30_000);

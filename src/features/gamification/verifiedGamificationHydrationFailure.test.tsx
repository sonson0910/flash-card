import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ state: null as any }));

// Every listener fails before it delivers a snapshot (for example permission-denied).
vi.mock('firebase/firestore', () => ({
  doc: (...segments: unknown[]) => ({ path: segments.slice(1).join('/') }),
  getDoc: vi.fn(),
  onSnapshot: (_ref: unknown, _next: unknown, error: (reason: Error) => void) => {
    queueMicrotask(() => error(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })));
    return () => undefined;
  },
  onSnapshotsInSync: () => () => undefined,
}));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));

import { useVerifiedGamificationState } from './verifiedGamificationClient';
import { buildDailyGoals } from '../dailyGoals/dailyGoalsModel';
import { studyDayInZone } from '../dailyGoals/studyDayCountdown';

const DATABASE = {} as never;

function Probe() {
  captured.state = useVerifiedGamificationState({ ownerId: 'owner-hydration-failure', database: DATABASE });
  return null;
}

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

afterEach(() => { vi.unstubAllGlobals(); });

it('a failed hydration shows the daily goals as not counted and books no lifetime XP as today', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const container = installMinimalReactDom();
  const root = createRoot(container);
  await act(async () => { root.render(<Probe />); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const now = new Date();
  const timeZone = 'UTC';
  const today = studyDayInZone(now, timeZone);
  const goalsAfterFailure = buildDailyGoals({ ...captured.state, now, timeZone, dailyPace: 10, planHasMatch: true });
  // Later in the same mount the learner finishes a review; the server returns the lifetime total.
  const lifetimeXp = 4_900;
  await act(async () => {
    captured.state.acceptAuthoritativeOutcome({ xp: lifetimeXp, level: Math.floor(Math.sqrt(lifetimeXp / 100)) + 1, streak: 12, studyDay: today });
  });
  const observed = {
    progressAfterFailure: goalsAfterFailure.goals.map(goal => `${goal.id}:${goal.progress.state}${goal.progress.state === 'counted' ? `:${goal.progress.done}/${goal.progress.target}` : ''}`),
    xpHistoryTodayAfterOutcome: captured.state.xpHistory[today],
  };
  expect(observed.progressAfterFailure.filter(entry => entry.startsWith('study-cards') || entry.startsWith('win-match')))
    .toEqual(['study-cards:unknown', 'win-match:unknown']);
  expect(observed.progressAfterFailure).toContain('keep-streak:unknown');
  expect(observed.xpHistoryTodayAfterOutcome).not.toBe(lifetimeXp);
  await act(async () => root.unmount());
});

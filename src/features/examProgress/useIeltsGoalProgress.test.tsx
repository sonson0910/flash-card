import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Firestore } from 'firebase/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '../courses/courseModel';
import type { IeltsPathCounts } from './ieltsGoalModel';

const sources = vi.hoisted(() => ({
  lexemeIds: ['lexeme-a', 'lexeme-b'] as string[] | null,
  counts: null as IeltsPathCounts | null,
  stored: undefined as unknown,
  countsError: null as Error | null,
}));
vi.mock('./ieltsPathReader', () => ({
  IELTS_PATH_LANGUAGE: 'en',
  readIeltsPathLexemeIds: async () => sources.lexemeIds,
}));
vi.mock('./ieltsPathProgress', () => ({
  readIeltsPathCounts: vi.fn(async () => {
    if (sources.countsError) throw sources.countsError;
    return sources.counts;
  }),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_database: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: async () => ({ exists: () => sources.stored !== undefined, data: () => sources.stored }),
}));

import { readIeltsPathCounts } from './ieltsPathProgress';
import { saveLatestExamScore } from './latestExamScore';
import { useIeltsGoalProgress, type IeltsGoalProgress, type IeltsGoalProgressOptions } from './useIeltsGoalProgress';

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis,
  };
  const container = {
    nodeType: 1, ownerDocument: documentLike, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('top', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

const course = (kind: string, targetLanguage: Course['targetLanguage'] = 'en'): Course => ({
  id: 'course-en', targetLanguage, nativeLanguage: 'vi', status: 'active',
  goals: [
    { id: 'goal-old', kind: 'ielts', level: '6.0', targetDate: null, status: 'completed', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'goal-1', kind, level: '7.0', targetDate: '2026-12-19', status: 'active', createdAt: '2026-02-01T00:00:00.000Z' },
  ],
  preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
  createdAt: '2026-01-01T00:00:00.000Z',
});

const options = (overrides: Partial<IeltsGoalProgressOptions> = {}): IeltsGoalProgressOptions => ({
  ownerId: 'owner-1',
  database: {} as Firestore,
  libraryEpoch: 2,
  course: course('ielts'),
  isOffline: false,
  rewardTimeZone: 'Asia/Ho_Chi_Minh',
  verifiedHistoryStartedOn: '2026-10-01',
  now: new Date('2026-11-18T18:30:00.000Z'),
  ...overrides,
});

const mount = (props: IeltsGoalProgressOptions) => {
  const captured: { current: IeltsGoalProgress | null } = { current: null };
  const root = createRoot(installMinimalReactDom());
  function Probe() {
    captured.current = useIeltsGoalProgress(props);
    return null;
  }
  act(() => root.render(<Probe />));
  return { captured, root };
};

const settle = () => act(async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); });

describe('IELTS goal progress hook', () => {
  beforeEach(() => {
    sources.lexemeIds = ['lexeme-a', 'lexeme-b'];
    sources.counts = { total: 2, started: 2, mastered: 1, masteredLast7: 1, masteredLast28: 1 };
    sources.stored = { schemaVersion: 1, goals: { 'goal-1': { courseId: 'course-en', band: '6.5', updatedAt: '2026-11-01T00:00:00.000Z' } } };
    sources.countsError = null;
    vi.mocked(readIeltsPathCounts).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('builds the model from the path counts, the active goal and the stored latest score', async () => {
    const { captured, root } = mount(options());
    try {
      expect(captured.current).toEqual({ status: 'loading' });
      await settle();
      expect(captured.current).toMatchObject({
        status: 'ready', courseId: 'course-en', goalId: 'goal-1', latestScore: '6.5',
        model: { total: 2, mastered: 1, percent: 50, targetBand: '7.0', latestScore: '6.5', examDate: '2026-12-19', daysToExam: 30 },
      });
      expect(readIeltsPathCounts).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner-1', libraryEpoch: 2, lexemeIds: ['lexeme-a', 'lexeme-b'] }));
    } finally {
      act(() => root.unmount());
    }
  });

  it('shows a score the editor saved without reading again', async () => {
    const { captured, root } = mount(options());
    try {
      await settle();
      const call = vi.fn(async () => ({ latestScore: { ownerId: 'owner-1', courseId: 'course-en', goalId: 'goal-1', latestScore: '7.5' } }));
      await act(async () => { await saveLatestExamScore(call, { ownerId: 'owner-1', courseId: 'course-en', goalId: 'goal-1', latestScore: '7.5' }); });
      expect(captured.current).toMatchObject({ status: 'ready', latestScore: '7.5', model: { latestScore: '7.5', targetBand: '7.0' } });
      expect(readIeltsPathCounts).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
    }
  });

  it('reads the IELTS goal when the course lists another active goal first', async () => {
    const base = course('ielts');
    const mixed: Course = {
      ...base,
      goals: [
        { id: 'goal-talk', kind: 'conversation', level: null, targetDate: null, status: 'active', createdAt: '2026-01-15T00:00:00.000Z' },
        ...base.goals,
      ],
    };
    const { captured, root } = mount(options({ course: mixed }));
    try {
      await settle();
      expect(captured.current).toMatchObject({
        status: 'ready', goalId: 'goal-1', latestScore: '6.5', model: { targetBand: '7.0', latestScore: '6.5' },
      });
    } finally {
      act(() => root.unmount());
    }
  });

  it.each([
    ['a goal that is not IELTS', options({ course: course('toeic') })],
    ['a course in another language', options({ course: course('ielts', 'ko') })],
    ['offline', options({ isOffline: true })],
    ['no verified library epoch', options({ libraryEpoch: null })],
    ['signed out', options({ ownerId: null })],
  ])('is hidden for %s without reading', async (_name, props) => {
    const { captured, root } = mount(props);
    try {
      await settle();
      expect(captured.current).toEqual({ status: 'hidden' });
      expect(readIeltsPathCounts).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
  });

  it('is hidden when the IELTS path is not installed', async () => {
    sources.lexemeIds = null;
    const { captured, root } = mount(options());
    try {
      await settle();
      expect(captured.current).toEqual({ status: 'hidden' });
    } finally {
      act(() => root.unmount());
    }
  });

  it('is hidden after a failed read and logs only the error name', async () => {
    sources.countsError = Object.assign(new Error('owner-1 band 6.5'), { name: 'FirebaseError' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { captured, root } = mount(options());
    try {
      await settle();
      expect(captured.current).toEqual({ status: 'hidden' });
      expect(warn).toHaveBeenCalledWith('IELTS goal progress could not be loaded.', { errorName: 'FirebaseError' });
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/6\.5|owner-1/);
    } finally {
      warn.mockRestore();
      act(() => root.unmount());
    }
  });
});

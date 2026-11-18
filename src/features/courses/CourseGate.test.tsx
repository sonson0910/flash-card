import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CourseProfileRead } from './coursePort';

const load = vi.fn(async (_ownerId: string): Promise<CourseProfileRead> => ({
  source: 'cloud',
  profile: { activeCourseId: null, courses: [] },
}));

vi.mock('./resolveCoursePort', () => ({
  resolveCoursePort: async () => ({ available: true, load }),
}));

const { CourseProvider, readyCourseSessionForOwner, useCourseSession } = await import('./CourseGate');
import type { CourseGateValue } from './CourseGate';

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    defaultView: globalThis,
  };
  const container = {
    nodeType: 1,
    ownerDocument: documentLike,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
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

describe('CourseProvider', () => {
  it('loads the course for an owner who signs in while the controller chunk is still loading', async () => {
    const root = createRoot(installMinimalReactDom());
    try {
      // Both renders commit before the dynamic controller import resolves.
      act(() => { root.render(<CourseProvider ownerId={null}>{null}</CourseProvider>); });
      act(() => { root.render(<CourseProvider ownerId="owner-1">{null}</CourseProvider>); });
      await act(async () => {
        await vi.waitFor(() => expect(load).toHaveBeenCalledWith('owner-1'));
      });
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('never exposes owner A course to owner B while B is loading or after B fails', async () => {
    const originalLoad = load.getMockImplementation();
    let rejectB!: (error: Error) => void;
    load.mockImplementation((ownerId: string): Promise<CourseProfileRead> => ownerId === 'owner-a'
      ? Promise.resolve({ source: 'cloud', profile: {
          activeCourseId: 'course-ja', courses: [{
            id: 'course-ja', targetLanguage: 'ja', nativeLanguage: 'en', status: 'active', goals: [],
            preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null }, createdAt: '2026-01-01T00:00:00.000Z',
          }],
        } })
      : new Promise<CourseProfileRead>((_resolve, reject) => { rejectB = reject; }));
    const seen: Array<{ expectedOwner: string; snapshotOwner: string | null | undefined; target: string | null }> = [];
    function Probe({ expectedOwner }: { expectedOwner: string }) {
      const { model } = useCourseSession();
      seen.push({ expectedOwner, snapshotOwner: model.ownerId, target: model.activeCourse?.targetLanguage ?? null });
      return null;
    }
    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => { root.render(<CourseProvider ownerId="owner-a"><Probe expectedOwner="owner-a" /></CourseProvider>); });
      await vi.waitFor(() => expect(seen.some(item => item.expectedOwner === 'owner-a' && item.target === 'ja')).toBe(true));

      await act(async () => { root.render(<CourseProvider ownerId="owner-b"><Probe expectedOwner="owner-b" /></CourseProvider>); });
      expect(seen.filter(item => item.expectedOwner === 'owner-b').every(item => item.target === null)).toBe(true);
      await act(async () => { rejectB(new Error('offline')); await Promise.resolve(); });
      expect(seen.filter(item => item.expectedOwner === 'owner-b').every(item => item.target === null)).toBe(true);
    } finally {
      act(() => root.unmount());
      load.mockImplementation(originalLoad ?? (async (_ownerId: string) => ({ source: 'cloud', profile: { activeCourseId: null, courses: [] } })));
      vi.unstubAllGlobals();
    }
  });

  it('withholds parent-bridged reads until the next identity owns a ready course', async () => {
    const originalLoad = load.getMockImplementation();
    let resolveB!: (read: CourseProfileRead) => void;
    const course = (id: string, targetLanguage: 'ja' | 'ko', nativeLanguage: 'en' | 'vi'): CourseProfileRead => ({
      source: 'cloud', profile: {
        activeCourseId: id, courses: [{
          id, targetLanguage, nativeLanguage, status: 'active', goals: [],
          preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
          createdAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    });
    load.mockImplementation((ownerId: string) => ownerId === 'owner-a'
      ? Promise.resolve(course('course-ja', 'ja', 'en'))
      : new Promise<CourseProfileRead>(resolve => { resolveB = resolve; }));
    const reads: Array<{ ownerId: string; targetLanguage: string }> = [];
    const seen: Array<{ ownerId: string; ready: boolean }> = [];
    function Bridge({ onSnapshot }: { onSnapshot(value: CourseGateValue): void }) {
      const session = useCourseSession();
      useEffect(() => onSnapshot(session), [onSnapshot, session]);
      return null;
    }
    function Parent({ ownerId }: { ownerId: string }) {
      const [bridged, setBridged] = useState<CourseGateValue | null>(null);
      const current = readyCourseSessionForOwner(bridged, ownerId);
      seen.push({ ownerId, ready: Boolean(current) });
      if (current) reads.push({ ownerId, targetLanguage: current.model.activeCourse?.targetLanguage ?? 'en' });
      return <CourseProvider ownerId={ownerId}><Bridge onSnapshot={setBridged} /></CourseProvider>;
    }
    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => { root.render(<Parent ownerId="owner-a" />); });
      await vi.waitFor(() => expect(reads).toContainEqual({ ownerId: 'owner-a', targetLanguage: 'ja' }));
      await act(async () => { root.render(<Parent ownerId="owner-b" />); });
      expect(seen.some(item => item.ownerId === 'owner-b' && !item.ready)).toBe(true);
      expect(reads.filter(item => item.ownerId === 'owner-b')).toEqual([]);
      await act(async () => { resolveB(course('course-ko', 'ko', 'vi')); });
      await vi.waitFor(() => expect(reads.filter(item => item.ownerId === 'owner-b')).toEqual([
        { ownerId: 'owner-b', targetLanguage: 'ko' },
      ]));
    } finally {
      act(() => root.unmount());
      load.mockImplementation(originalLoad ?? (async (_ownerId: string) => ({ source: 'cloud', profile: { activeCourseId: null, courses: [] } })));
      vi.unstubAllGlobals();
    }
  });
});

it('accepts course decisions only from a ready snapshot owned by the current identity', () => {
  const session = { model: {
    ownerId: 'owner-a', status: 'ready' as const, source: 'cloud' as const,
    profile: null, activeCourse: null, pending: false, errorCode: null,
  }, actions: {} as never };
  expect(readyCourseSessionForOwner(session, 'owner-b')).toBeNull();
  expect(readyCourseSessionForOwner({ ...session, model: { ...session.model, ownerId: 'owner-b', status: 'loading' } }, 'owner-b')).toBeNull();
  expect(readyCourseSessionForOwner({ ...session, model: { ...session.model, ownerId: 'owner-b' } }, 'owner-b')).not.toBeNull();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CourseContext, type CourseGateValue } from '../courses/CourseGate';
import { markOnboardingInProgress, writeOnboardingResumeStep } from './onboardingModel';

const journey = vi.fn((_props: { ownerId: string }) => null);
vi.mock('./OnboardingJourney', () => ({ OnboardingJourney: journey }));

const { OnboardingGate } = await import('./OnboardingGate');

const absentProfile: CourseGateValue = {
  model: {
    status: 'ready', source: 'absent', pending: false, errorCode: null,
    profile: { activeCourseId: null, courses: [] },
    activeCourse: null,
  },
  actions: {} as CourseGateValue['actions'],
};

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

describe('OnboardingGate has-cards latch', () => {
  beforeEach(() => journey.mockClear());

  it('waits for the first library result before classifying a legacy owner', async () => {
    journey.mockClear();
    const root = createRoot(installMinimalReactDom());
    const render = async (libraryReady: boolean, hasCards: boolean) => act(async () => {
      root.render(<CourseContext.Provider value={absentProfile}>
        <OnboardingGate ownerId="legacy-loading" suppress={false} libraryReady={libraryReady} hasCards={hasCards} />
      </CourseContext.Provider>);
    });
    try {
      await render(false, false);
      expect(journey).not.toHaveBeenCalled();
      await render(true, true);
      expect(journey).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('keeps a started journey visible during a later library refresh', async () => {
    journey.mockClear();
    const root = createRoot(installMinimalReactDom());
    const render = async (libraryReady: boolean) => act(async () => {
      root.render(<CourseContext.Provider value={absentProfile}>
        <OnboardingGate ownerId="new-refresh" suppress={false} libraryReady={libraryReady} hasCards={false} />
      </CourseContext.Provider>);
    });
    try {
      await render(true);
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(journey).toHaveBeenCalled();
      });
      journey.mockClear();
      await render(false);
      expect(journey).toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('keeps onboarding closed after an owner deletes their last card, but not for a different owner', async () => {
    const root = createRoot(installMinimalReactDom());
    const render = async (ownerId: string, hasCards: boolean) => act(async () => {
      root.render(<CourseContext.Provider value={absentProfile}>
        <OnboardingGate ownerId={ownerId} suppress={false} libraryReady hasCards={hasCards} />
      </CourseContext.Provider>);
    });
    try {
      await render('owner-1', true);
      await render('owner-1', false);
      expect(journey).not.toHaveBeenCalled();

      await render('owner-2', false);
      await act(async () => { await vi.waitFor(() => expect(journey).toHaveBeenCalled()); });
      expect(journey.mock.calls.at(-1)?.[0]).toEqual({ ownerId: 'owner-2' });
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('resumes an unfinished journey after starter cards appear', async () => {
    journey.mockClear();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    writeOnboardingResumeStep('owner-resume', 'reminder');
    markOnboardingInProgress('owner-resume');
    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<CourseContext.Provider value={absentProfile}>
          <OnboardingGate ownerId="owner-resume" suppress={false} libraryReady hasCards />
        </CourseContext.Provider>);
      });
      await act(async () => { await vi.waitFor(() => expect(journey).toHaveBeenCalled()); });
      expect(journey.mock.calls.at(-1)?.[0]).toEqual({ ownerId: 'owner-resume' });
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('does not treat a bare old step as proof that legacy cards came from onboarding', async () => {
    journey.mockClear();
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'reminder') });
    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<CourseContext.Provider value={absentProfile}>
          <OnboardingGate ownerId="legacy-owner" suppress={false} libraryReady hasCards />
        </CourseContext.Provider>);
      });
      expect(journey).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('keeps an active journey mounted when local storage fails after starter cards appear', async () => {
    journey.mockClear();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('storage denied'); } });
    const root = createRoot(installMinimalReactDom());
    const render = async (hasCards: boolean) => act(async () => {
      root.render(<CourseContext.Provider value={absentProfile}>
        <OnboardingGate ownerId="new-owner" suppress={false} libraryReady hasCards={hasCards} />
      </CourseContext.Provider>);
    });
    try {
      await render(false);
      await act(async () => { await vi.waitFor(() => expect(journey).toHaveBeenCalled()); });
      journey.mockClear();
      await render(true);
      expect(journey).toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('remembers a legacy owner through an A-to-B-to-A account switch', async () => {
    journey.mockClear();
    const root = createRoot(installMinimalReactDom());
    const render = async (ownerId: string, hasCards: boolean) => act(async () => {
      root.render(<CourseContext.Provider value={absentProfile}>
        <OnboardingGate ownerId={ownerId} suppress={false} libraryReady hasCards={hasCards} />
      </CourseContext.Provider>);
    });
    try {
      await render('legacy-a', true);
      await render('legacy-a', false);
      await render('legacy-b', true);
      await render('legacy-a', false);
      expect(journey).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { CourseContext, type CourseGateValue } from '../courses/CourseGate';

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
  it('keeps onboarding closed after an owner deletes their last card, but not for a different owner', async () => {
    const root = createRoot(installMinimalReactDom());
    const render = async (ownerId: string, hasCards: boolean) => act(async () => {
      root.render(<CourseContext.Provider value={absentProfile}>
        <OnboardingGate ownerId={ownerId} suppress={false} hasCards={hasCards} />
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
});

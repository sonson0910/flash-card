import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CourseProfileRead } from './coursePort';

const load = vi.fn(async (): Promise<CourseProfileRead> => ({
  source: 'cloud',
  profile: { activeCourseId: null, courses: [] },
}));

vi.mock('./resolveCoursePort', () => ({
  resolveCoursePort: async () => ({ available: true, load }),
}));

const { CourseProvider } = await import('./CourseGate');

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
});

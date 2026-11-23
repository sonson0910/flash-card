import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseNativeLanguage } from '../courses/courseModel';
import { clearStarterClaim } from './starterTrialGate';
import { useStarterMeaningsLanguage } from './useStarterMeaningsLanguage';

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

interface Probe { follows: boolean; remember: (language: CourseNativeLanguage) => void }

/** Mounts the hook the way the journey does and keeps the latest values it returned. */
const mount = (ownerId: string, nativeLanguage: CourseNativeLanguage) => {
  const root = createRoot(installMinimalReactDom());
  const probe = {} as Probe;
  const Harness = ({ native }: { native: CourseNativeLanguage }) => {
    const value = useStarterMeaningsLanguage(ownerId, native);
    probe.follows = value.followsEarlierLanguage;
    probe.remember = value.remember;
    return null;
  };
  const render = (native: CourseNativeLanguage) => act(async () => { root.render(<Harness native={native} />); });
  return { probe, render: () => render(nativeLanguage), rerender: render, unmount: () => act(() => root.unmount()) };
};

describe('useStarterMeaningsLanguage', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports a change only after cards were written and the native language then differs', async () => {
    const view = mount('owner-a', 'vi');
    await view.render();
    expect(view.probe.follows).toBe(false);

    await act(async () => view.probe.remember('vi'));
    expect(view.probe.follows).toBe(false);

    await view.rerender('en');
    expect(view.probe.follows).toBe(true);
    await view.rerender('vi');
    expect(view.probe.follows).toBe(false);
    view.unmount();
  });

  it('still names the language the cards were written with after a reload and a second batch in the new language', async () => {
    const first = mount('owner-b', 'vi');
    await first.render();
    await act(async () => first.probe.remember('vi'));
    first.unmount();

    // Reload: component state is gone, the learner now has English selected, and the same target is added again.
    const reloaded = mount('owner-b', 'en');
    await reloaded.render();
    expect(reloaded.probe.follows).toBe(true);
    await act(async () => reloaded.probe.remember('en'));
    expect(reloaded.probe.follows).toBe(true);
    reloaded.unmount();
  });

  it('forgets the language once the setup finishes, and keeps owners apart', async () => {
    const view = mount('owner-c', 'vi');
    await view.render();
    await act(async () => view.probe.remember('vi'));
    view.unmount();

    const other = mount('owner-d', 'en');
    await other.render();
    expect(other.probe.follows).toBe(false);
    other.unmount();

    clearStarterClaim('owner-c');
    const after = mount('owner-c', 'en');
    await after.render();
    expect(after.probe.follows).toBe(false);
    after.unmount();
  });
});

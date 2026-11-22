import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseTargetLanguage } from './courseModel';

const firestore = vi.hoisted(() => ({
  counts: [] as number[],
  queries: [] as unknown[][],
}));
vi.mock('../../lib/firebase', () => ({ db: { name: 'test-db' } }));
vi.mock('firebase/firestore', () => ({
  collection: (_database: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  where: (field: string, operator: string, value: unknown) => ({ field, operator, value }),
  query: (collection: unknown, ...constraints: unknown[]) => [collection, ...constraints],
  getCountFromServer: vi.fn(async (query: unknown[]) => {
    firestore.queries.push(query);
    const count = firestore.counts.shift() ?? 0;
    return { data: () => ({ count }) };
  }),
}));

import {
  newWordCount, readCourseCardCount, reviewedPercent, useCourseCardCounts,
  type CourseCardCountReader, type CourseCardCounts,
} from './useCourseCardCounts';

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

interface ProbeProps {
  readonly ownerId: string | null;
  readonly languages: readonly CourseTargetLanguage[];
  readonly enabled: boolean;
  readonly read: CourseCardCountReader;
}

describe('course card counts', () => {
  let root: Root;
  let latest: CourseCardCounts = {};
  const Probe = ({ ownerId, languages, enabled, read }: ProbeProps) => {
    latest = useCourseCardCounts(ownerId, languages, enabled, read);
    return null;
  };
  const render = async (props: ProbeProps) => { await act(async () => { root.render(<Probe {...props} />); }); };

  beforeEach(() => {
    root = createRoot(installMinimalReactDom());
    latest = {};
    firestore.counts = [];
    firestore.queries = [];
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it('counts new words and the reviewed share without going past the course total', () => {
    expect(newWordCount({ total: 120, reviewed: 48 })).toBe(72);
    expect(newWordCount({ total: 3, reviewed: 5 })).toBe(0);
    expect(reviewedPercent({ total: 120, reviewed: 48 })).toBe(40);
    expect(reviewedPercent({ total: 3, reviewed: 1 })).toBe(33);
    expect(reviewedPercent({ total: 3, reviewed: 5 })).toBe(100);
    expect(reviewedPercent({ total: 0, reviewed: 0 })).toBe(0);
  });

  it('reads every card of the course language and those reviewed at least once', async () => {
    firestore.counts = [120, 48];
    await expect(readCourseCardCount('owner-1', 'ko')).resolves.toEqual({ total: 120, reviewed: 48 });
    expect(firestore.queries).toEqual([
      [{ path: 'users/owner-1/cards' }, { field: 'language', operator: '==', value: 'ko' }],
      [{ path: 'users/owner-1/cards' }, { field: 'language', operator: '==', value: 'ko' }, { field: 'reviews', operator: '>', value: 0 }],
    ]);
  });

  it('reads each open course once per opening and nothing while closed', async () => {
    const read = vi.fn<CourseCardCountReader>(async (_owner, language) => (language === 'ko' ? { total: 12, reviewed: 4 } : { total: 0, reviewed: 0 }));
    await render({ ownerId: 'owner-1', languages: ['ko', 'en'], enabled: false, read });
    expect(read).not.toHaveBeenCalled();
    expect(latest).toEqual({});

    await render({ ownerId: 'owner-1', languages: ['ko', 'en'], enabled: true, read });
    expect(read.mock.calls).toEqual([['owner-1', 'ko'], ['owner-1', 'en']]);
    expect(latest).toEqual({ ko: { total: 12, reviewed: 4 }, en: { total: 0, reviewed: 0 } });

    await render({ ownerId: 'owner-1', languages: ['ko', 'en'], enabled: true, read });
    expect(read).toHaveBeenCalledTimes(2);
    await render({ ownerId: 'owner-1', languages: ['ko', 'en'], enabled: false, read });
    await render({ ownerId: 'owner-1', languages: ['ko', 'en'], enabled: true, read });
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('leaves a count out when its read fails and never shows another owner its counts', async () => {
    const read = vi.fn<CourseCardCountReader>(async (owner, language) => {
      if (language === 'en') throw new Error('offline');
      return owner === 'owner-1' ? { total: 9, reviewed: 3 } : { total: 2, reviewed: 0 };
    });
    await render({ ownerId: 'owner-1', languages: ['ko', 'en'], enabled: true, read });
    expect(latest).toEqual({ ko: { total: 9, reviewed: 3 } });

    let release: () => void = () => undefined;
    const slow = vi.fn<CourseCardCountReader>(() => new Promise(resolve => { release = () => resolve({ total: 2, reviewed: 0 }); }));
    await render({ ownerId: 'owner-2', languages: ['ko'], enabled: true, read: slow });
    expect(latest).toEqual({});
    await act(async () => { release(); });
    expect(latest).toEqual({ ko: { total: 2, reviewed: 0 } });
  });
});

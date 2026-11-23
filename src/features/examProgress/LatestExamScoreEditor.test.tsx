import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { Firestore } from 'firebase/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IELTS_TARGET_BANDS } from '../../../functions/src/course-profile-contract';

const firestore = vi.hoisted(() => ({ stored: undefined as unknown, fail: false }));
vi.mock('firebase/firestore', () => ({
  doc: (_database: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: async () => {
    if (firestore.fail) throw new Error('offline');
    return { exists: () => firestore.stored !== undefined, data: () => firestore.stored };
  },
}));
vi.mock('./latestExamScorePorts', () => ({
  defaultLatestExamScorePorts: () => { throw new Error('Tests pass their own ports.'); },
}));

import { IeltsBandPicker } from './IeltsBandPicker';
import {
  LatestExamScoreEditorView,
  useLatestExamScoreEditor,
  type LatestExamScoreEditorController,
  type LatestExamScoreEditorState,
} from './LatestExamScoreEditor';
import { SET_LATEST_EXAM_SCORE_CALLABLE } from './latestExamScore';

i18n.load('en', {});
i18n.activate('en');

const render = (node: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const view = (editor: LatestExamScoreEditorState) => render(
  <LatestExamScoreEditorView editor={editor} onSelect={vi.fn()} onSave={vi.fn()} onClear={vi.fn()} />,
);
const buttonDisabled = (html: string, className: string) => new RegExp(`<button[^>]*class="${className}"[^>]*disabled=""`).test(html);

const target = { ownerId: 'owner-1', courseId: 'course-en', goalId: 'goal-ielts' };

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
};

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

describe('IELTS band picker', () => {
  it('offers every band from 4.0 to 9.0 as a radio and selects the canonical value', () => {
    const html = render(<IeltsBandPicker value="band 6,5" onChange={vi.fn()} />);
    expect(text(html)).toContain('Target band');
    expect([...html.matchAll(/type="radio"/g)]).toHaveLength(IELTS_TARGET_BANDS.length);
    expect(IELTS_TARGET_BANDS[0]).toBe('4.0');
    expect(IELTS_TARGET_BANDS.at(-1)).toBe('9.0');
    expect(html).toMatch(/checked="" value="6.5"/);
    expect([...html.matchAll(/checked=""/g)]).toHaveLength(1);
  });

  it('selects nothing for free text and names the group with its legend', () => {
    const html = render(<IeltsBandPicker value="about seven" onChange={vi.fn()} legend="Your latest IELTS score" disabled />);
    expect(html).not.toContain('checked=""');
    expect(html).toContain('<legend class="ielts-band-picker__legend">Your latest IELTS score</legend>');
    expect(html).toMatch(/<fieldset class="ielts-band-picker" disabled="">/);
  });
});

describe('latest exam score editor view', () => {
  it('shows a busy loading state before the stored score is known', () => {
    const html = view({ stored: { status: 'loading' }, selected: null, saving: { status: 'idle' } });
    expect(text(html)).toContain('Loading your latest score…');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('type="radio"');
  });

  it('keeps save disabled until a new band is chosen and offers clear only for a stored score', () => {
    const empty = view({ stored: { status: 'ready', score: null }, selected: null, saving: { status: 'idle' } });
    expect(buttonDisabled(empty, 'latest-score-editor__save')).toBe(true);
    expect(text(empty)).not.toContain('Clear score');
    const unchanged = view({ stored: { status: 'ready', score: '6.5' }, selected: '6.5', saving: { status: 'idle' } });
    expect(buttonDisabled(unchanged, 'latest-score-editor__save')).toBe(true);
    expect(text(unchanged)).toContain('Clear score');
    const changed = view({ stored: { status: 'ready', score: '6.5' }, selected: '7.0', saving: { status: 'idle' } });
    expect(buttonDisabled(changed, 'latest-score-editor__save')).toBe(false);
  });

  it('marks saving and clearing as pending and locks the controls', () => {
    const saving = view({ stored: { status: 'ready', score: '6.5' }, selected: '7.0', saving: { status: 'pending', clearing: false } });
    expect(text(saving)).toContain('Saving…');
    expect(saving).toContain('aria-busy="true"');
    expect(saving).toMatch(/<fieldset class="ielts-band-picker" disabled="">/);
    expect(buttonDisabled(saving, 'latest-score-editor__clear')).toBe(true);
    const clearing = view({ stored: { status: 'ready', score: '6.5' }, selected: '6.5', saving: { status: 'pending', clearing: true } });
    expect(text(clearing)).toContain('Clearing…');
    expect(text(clearing)).toContain('Save score');
  });

  it('announces the saved and cleared results', () => {
    expect(text(view({ stored: { status: 'ready', score: '7.0' }, selected: '7.0', saving: { status: 'saved', score: '7.0' } }))).toContain('Score saved: 7.0.');
    expect(text(view({ stored: { status: 'ready', score: null }, selected: null, saving: { status: 'saved', score: null } }))).toContain('Score cleared.');
  });

  it('shows each failure as an alert', () => {
    const cases: Array<[LatestExamScoreEditorState['saving'], string]> = [
      [{ status: 'failed', code: 'goal-missing' }, 'This goal no longer exists, so the score was not saved.'],
      [{ status: 'failed', code: 'rate-limited' }, 'Too many changes at once. Wait a moment and try again.'],
      [{ status: 'failed', code: 'invalid' }, 'Choose a band from 4.0 to 9.0.'],
      [{ status: 'failed', code: 'unavailable' }, 'Your score could not be saved. Check your connection and try again.'],
      [{ status: 'failed', code: 'failed' }, 'Your score could not be saved. Check your connection and try again.'],
    ];
    for (const [saving, message] of cases) {
      const html = view({ stored: { status: 'ready', score: null }, selected: '7.0', saving });
      expect(html).toContain(`role="alert">${message.replace(/'/g, '&#x27;')}</p>`);
    }
  });

  it('explains an unreadable stored score', () => {
    expect(text(view({ stored: { status: 'unreadable' }, selected: null, saving: { status: 'idle' } })))
      .toContain('Your saved score could not be loaded. Saving a new one replaces it.');
  });
});

describe('latest exam score editor controller', () => {
  beforeEach(() => {
    firestore.stored = undefined;
    firestore.fail = false;
  });
  afterEach(() => vi.unstubAllGlobals());

  const mount = (props: Partial<Parameters<typeof useLatestExamScoreEditor>[0]> & { call: (name: string, payload: unknown) => Promise<unknown> }) => {
    const captured: { current: LatestExamScoreEditorController | null } = { current: null };
    const root = createRoot(installMinimalReactDom());
    const ports = { database: {} as Firestore, call: props.call };
    function Probe() {
      captured.current = useLatestExamScoreEditor({ ...target, ports, ...props });
      return null;
    }
    act(() => root.render(<Probe />));
    return { captured, root };
  };

  it('reads the stored score, saves a new one through the callable and reports it', async () => {
    firestore.stored = { schemaVersion: 1, goals: { 'goal-ielts': { courseId: 'course-en', band: '6.0', updatedAt: '2026-11-01T00:00:00.000Z' } } };
    const response = deferred<unknown>();
    const call = vi.fn(() => response.promise);
    const onSaved = vi.fn();
    const { captured, root } = mount({ call, onSaved });
    try {
      expect(captured.current!.stored).toEqual({ status: 'loading' });
      await act(async () => { await Promise.resolve(); });
      expect(captured.current!.stored).toEqual({ status: 'ready', score: '6.0' });
      expect(captured.current!.selected).toBe('6.0');

      act(() => captured.current!.select('6.5'));
      let request!: Promise<void>;
      act(() => { request = captured.current!.save(); });
      expect(captured.current!.saving).toEqual({ status: 'pending', clearing: false });
      act(() => { void captured.current!.save(); });
      expect(call).toHaveBeenCalledOnce();
      expect(call).toHaveBeenCalledWith(SET_LATEST_EXAM_SCORE_CALLABLE, { ...target, latestScore: '6.5' });

      await act(async () => {
        response.resolve({ latestScore: { ...target, latestScore: '6.5' } });
        await request;
      });
      expect(captured.current!.saving).toEqual({ status: 'saved', score: '6.5' });
      expect(captured.current!.stored).toEqual({ status: 'ready', score: '6.5' });
      expect(onSaved).toHaveBeenCalledWith('6.5');
    } finally {
      act(() => root.unmount());
    }
  });

  it('clears the score and keeps a failure retryable', async () => {
    const call = vi.fn()
      .mockRejectedValueOnce({ code: 'functions/failed-precondition', details: { reason: 'goal-not-found' } })
      .mockResolvedValueOnce({ latestScore: { ...target, latestScore: null } });
    const onSaved = vi.fn();
    const { captured, root } = mount({ call, onSaved, initialScore: '7.0' });
    try {
      expect(captured.current!.stored).toEqual({ status: 'ready', score: '7.0' });
      await act(async () => { await captured.current!.clear(); });
      expect(captured.current!.saving).toEqual({ status: 'failed', code: 'goal-missing' });
      expect(captured.current!.stored).toEqual({ status: 'ready', score: '7.0' });
      expect(onSaved).not.toHaveBeenCalled();

      await act(async () => { await captured.current!.clear(); });
      expect(call).toHaveBeenLastCalledWith(SET_LATEST_EXAM_SCORE_CALLABLE, { ...target, latestScore: null });
      expect(captured.current!.saving).toEqual({ status: 'saved', score: null });
      expect(captured.current!.selected).toBeNull();
      expect(onSaved).toHaveBeenCalledWith(null);
    } finally {
      act(() => root.unmount());
    }
  });

  it('marks the stored score unreadable when the read fails', async () => {
    firestore.fail = true;
    const { captured, root } = mount({ call: vi.fn() });
    try {
      await act(async () => { await Promise.resolve(); });
      expect(captured.current!.stored).toEqual({ status: 'unreadable' });
    } finally {
      act(() => root.unmount());
    }
  });
});

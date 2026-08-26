import { afterEach, describe, expect, it, vi } from 'vitest';
import { startStudyHandoff, waitForStudyCard } from './studyHandoff';

const source = {} as Element;

const createRoot = () => ({ dataset: {} as DOMStringMap }) as HTMLElement;

afterEach(() => {
  vi.useRealTimers();
});

describe('study handoff browser boundary', () => {
  it.each([
    ['reduced motion', { prefersReducedMotion: true }],
    ['unsupported browser', { startViewTransition: undefined }],
  ])('activates normally for %s', (_label, overrides) => {
    const activate = vi.fn();
    const startViewTransition = vi.fn();

    startStudyHandoff({
      source,
      root: createRoot(),
      prefersReducedMotion: false,
      startViewTransition,
      activate,
      waitForCard: async () => true,
      ...overrides,
    });

    expect(activate).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it('falls back once when the browser API throws before activation', () => {
    const activate = vi.fn();
    const root = createRoot();

    startStudyHandoff({
      source,
      root,
      prefersReducedMotion: false,
      startViewTransition: () => { throw new Error('unsupported'); },
      activate,
      waitForCard: async () => true,
    });

    expect(activate).toHaveBeenCalledOnce();
    expect(root.dataset.studyHandoff).toBeUndefined();
  });

  it('activates inside the update callback once and cancels cleanly', () => {
    const activate = vi.fn();
    const skipTransition = vi.fn();
    const root = createRoot();
    let updateCallback!: () => void | Promise<void>;
    const cleanup = startStudyHandoff({
      source,
      root,
      prefersReducedMotion: false,
      startViewTransition: callback => {
        updateCallback = callback;
        return { finished: new Promise(() => undefined), skipTransition };
      },
      activate,
      waitForCard: async () => true,
    });

    expect(root.dataset.studyHandoff).toBe('active');
    void updateCallback();
    void updateCallback();
    expect(activate).toHaveBeenCalledOnce();

    cleanup?.();
    expect(skipTransition).toHaveBeenCalledOnce();
    expect(root.dataset.studyHandoff).toBeUndefined();
  });

  it('bounds the real study-card render wait', async () => {
    vi.useFakeTimers();
    const documentRoot = { querySelector: vi.fn(() => null) };
    const pending = waitForStudyCard(documentRoot, 450);

    vi.advanceTimersByTime(500);
    await expect(pending).resolves.toBe(false);

    expect(documentRoot.querySelector).toHaveBeenCalled();
  });

  it('reports readiness when the real card appears before the bound', async () => {
    vi.useFakeTimers();
    let rendered = false;
    const pending = waitForStudyCard({ querySelector: vi.fn(() => rendered ? {} as Element : null) }, 450);

    vi.advanceTimersByTime(16);
    rendered = true;
    vi.advanceTimersByTime(16);

    await expect(pending).resolves.toBe(true);
  });

  it('skips a morph when the bounded render wait expires before transition assignment', async () => {
    const root = createRoot();
    const skipTransition = vi.fn();
    let callbackResult!: Promise<void>;
    const cleanup = startStudyHandoff({
      source,
      root,
      prefersReducedMotion: false,
      startViewTransition: callback => {
        callbackResult = Promise.resolve(callback());
        return { updateCallbackDone: callbackResult, finished: new Promise(() => undefined), skipTransition };
      },
      activate: vi.fn(),
      waitForCard: async () => false,
    });

    await callbackResult;
    await Promise.resolve();
    expect(skipTransition).toHaveBeenCalledOnce();
    expect(root.dataset.studyHandoff).toBe('active');

    cleanup?.();
  });

  it('arms the cleanup watchdog after update completion, not before', async () => {
    vi.useFakeTimers();
    const root = createRoot();
    let resolveUpdate!: () => void;
    const updateCallbackDone = new Promise<void>(resolve => { resolveUpdate = resolve; });
    const cleanup = startStudyHandoff({
      source,
      root,
      prefersReducedMotion: false,
      startViewTransition: callback => {
        void callback();
        return { updateCallbackDone, finished: new Promise(() => undefined) };
      },
      activate: vi.fn(),
      waitForCard: async () => true,
    });

    vi.advanceTimersByTime(700);
    expect(root.dataset.studyHandoff).toBe('active');

    resolveUpdate();
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(809);
    expect(root.dataset.studyHandoff).toBe('active');
    vi.advanceTimersByTime(1);
    expect(root.dataset.studyHandoff).toBeUndefined();

    cleanup?.();
  });
});

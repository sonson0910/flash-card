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
      waitForCard: async () => undefined,
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
      waitForCard: async () => undefined,
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
      waitForCard: async () => undefined,
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
    await pending;

    expect(documentRoot.querySelector).toHaveBeenCalled();
  });
});

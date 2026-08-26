import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookRuntime = vi.hoisted(() => ({
  stateCursor: 0,
  refCursor: 0,
  callbackCursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  callbacks: [] as Array<{ callback: (...args: never[]) => unknown; deps: readonly unknown[] }>,
}));

vi.mock('react', () => ({
  useCallback: <T extends (...args: never[]) => unknown>(callback: T, deps: readonly unknown[]) => {
    const index = hookRuntime.callbackCursor++;
    const previous = hookRuntime.callbacks[index];
    const changed = !previous
      || previous.deps.length !== deps.length
      || deps.some((dependency, dependencyIndex) => !Object.is(dependency, previous.deps[dependencyIndex]));
    if (changed) hookRuntime.callbacks[index] = { callback, deps };
    return (changed ? callback : previous.callback) as T;
  },
  useEffect: () => undefined,
  useRef: <T,>(initial: T) => {
    const index = hookRuntime.refCursor++;
    if (!(index in hookRuntime.refs)) hookRuntime.refs[index] = { current: initial };
    return hookRuntime.refs[index] as { current: T };
  },
  useState: <T,>(initial: T | (() => T)) => {
    const index = hookRuntime.stateCursor++;
    if (!(index in hookRuntime.states)) hookRuntime.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    const setState = (next: T | ((previous: T) => T)) => {
      const previous = hookRuntime.states[index] as T;
      hookRuntime.states[index] = typeof next === 'function'
        ? (next as (value: T) => T)(previous)
        : next;
    };
    return [hookRuntime.states[index] as T, setState] as const;
  },
}));

import {
  resolveFocusReturnTarget,
  scheduleNoticeDismissal,
  scheduleOverlayFocusRestore,
  useOverlayState,
} from './useOverlayState';

describe('useOverlayState', () => {
  beforeEach(() => {
    hookRuntime.stateCursor = 0;
    hookRuntime.refCursor = 0;
    hookRuntime.callbackCursor = 0;
    hookRuntime.states = [];
    hookRuntime.refs = [];
    hookRuntime.callbacks = [];
    vi.clearAllMocks();
  });

  let currentActiveElement: HTMLElement | null = null;
  const getActiveElement = () => currentActiveElement;
  const render = (
    activeElement: HTMLElement | null = null,
    practiceOpenerRef?: { current: HTMLElement | null },
    scheduler?: Parameters<typeof useOverlayState>[0] extends infer Options
      ? Options extends { scheduler?: infer Scheduler } ? Scheduler : never
      : never,
  ) => {
    currentActiveElement = activeElement;
    hookRuntime.stateCursor = 0;
    hookRuntime.refCursor = 0;
    hookRuntime.callbackCursor = 0;
    return useOverlayState({ getActiveElement, practiceOpenerRef, scheduler });
  };

  it('remembers the explicit opener and mounts overlays when opening practice', () => {
    const opener = { isConnected: true } as HTMLElement;
    const overlays = render();

    overlays.openPractice(opener);
    const updated = render();

    expect(updated.isPracticeMenuOpen).toBe(true);
    expect(updated.hasMountedOverlays).toBe(true);
    expect(updated.practiceOpenerRef.current).toBe(opener);
  });

  it('tracks replacement practice refs across rerenders for open and restore focus', () => {
    const firstOpener = { isConnected: true, focus: vi.fn() } as unknown as HTMLElement;
    const secondOpener = { isConnected: true, focus: vi.fn() } as unknown as HTMLElement;
    const firstPracticeOpenerRef = { current: null as HTMLElement | null };
    const secondPracticeOpenerRef = { current: null as HTMLElement | null };
    const taskCallbacks: Array<() => void> = [];
    const frameCallbacks: Array<() => void> = [];
    const scheduler = {
      setTimeout: vi.fn((callback: () => void) => { taskCallbacks.push(callback); return 7; }),
      clearTimeout: vi.fn(),
      requestAnimationFrame: vi.fn((callback: () => void) => { frameCallbacks.push(callback); return 8; }),
      cancelAnimationFrame: vi.fn(),
    };
    const overlays = render(null, firstPracticeOpenerRef, scheduler);
    overlays.openPractice(firstOpener);
    const rerendered = render(null, secondPracticeOpenerRef, scheduler);

    rerendered.openPractice(secondOpener);

    expect(firstPracticeOpenerRef.current).toBe(firstOpener);
    expect(secondPracticeOpenerRef.current).toBe(secondOpener);
    rerendered.restoreFocus({ preventDefault: vi.fn() }, 'practice');
    taskCallbacks[0]();
    frameCallbacks[0]();
    expect(secondOpener.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(firstOpener.focus).not.toHaveBeenCalled();
  });

  it('falls back to the active element and does not open a blocked clear confirmation', () => {
    const activeElement = { isConnected: true } as HTMLElement;
    const overlays = render(activeElement);

    expect(overlays.openClearConfirm(null, false)).toBe(false);
    expect(render(activeElement).showClearConfirm).toBe(false);

    expect(overlays.openClearConfirm(null, true)).toBe(true);
    const updated = render(activeElement);
    expect(updated.showClearConfirm).toBe(true);
    expect(updated.clearOpenerRef.current).toBe(activeElement);
  });

  it('chooses a connected opener and otherwise falls back to the view heading', () => {
    const connected = { isConnected: true } as HTMLElement;
    const disconnected = { isConnected: false } as HTMLElement;
    const heading = { isConnected: true } as HTMLElement;

    expect(resolveFocusReturnTarget(connected, heading)).toBe(connected);
    expect(resolveFocusReturnTarget(disconnected, heading)).toBe(heading);
    expect(resolveFocusReturnTarget(null, heading)).toBe(heading);
  });

  it('restores focus in the next task and animation frame', () => {
    const taskCallbacks: Array<() => void> = [];
    const frameCallbacks: Array<() => void> = [];
    const scheduler = {
      setTimeout: vi.fn((callback: () => void) => { taskCallbacks.push(callback); return 7; }),
      clearTimeout: vi.fn(),
      requestAnimationFrame: vi.fn((callback: () => void) => { frameCallbacks.push(callback); return 8; }),
      cancelAnimationFrame: vi.fn(),
    };
    const event = { preventDefault: vi.fn() };
    const fallback = { isConnected: true, focus: vi.fn() } as unknown as HTMLElement;
    const opener = { isConnected: false, focus: vi.fn() } as unknown as HTMLElement;

    scheduleOverlayFocusRestore({ event, opener, fallbackHeading: fallback, scheduler });
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fallback.focus).not.toHaveBeenCalled();
    taskCallbacks[0]();
    frameCallbacks[0]();
    expect(fallback.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(opener.focus).not.toHaveBeenCalled();
  });

  it('dismisses a notice after five seconds and supports cleanup for replacement notices', () => {
    const dismiss = vi.fn();
    const scheduler = {
      setTimeout: vi.fn((_callback: () => void, _delayMs: number) => 13),
      clearTimeout: vi.fn(),
    };

    const cleanup = scheduleNoticeDismissal('Imported 4 cards.', dismiss, scheduler);

    expect(scheduler.setTimeout).toHaveBeenCalledWith(expect.any(Function), 5000);
    const callback = scheduler.setTimeout.mock.calls[0][0] as () => void;
    callback();
    expect(dismiss).toHaveBeenCalledOnce();
    cleanup();
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(13);
  });
});

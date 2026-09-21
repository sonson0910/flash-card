import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUndoTimeout } from './UndoToast';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('UndoToast timeout', () => {
  it('uses only the unpaused remaining time', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    const dismiss = vi.fn();
    const timeout = createUndoTimeout(5_000, dismiss);

    vi.advanceTimersByTime(2_000);
    timeout.pause();
    vi.advanceTimersByTime(10_000);
    expect(dismiss).not.toHaveBeenCalled();

    timeout.resume();
    vi.advanceTimersByTime(2_999);
    expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('cancels the pending timeout when disposed', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    const dismiss = vi.fn();
    const timeout = createUndoTimeout(5_000, dismiss);

    timeout.dispose();
    vi.advanceTimersByTime(5_000);

    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe('UndoToast dismissal timer', () => {
  it('resets pause tracking after the active toast is removed', () => {
    const source = readFileSync(new URL('./UndoToast.tsx', import.meta.url), 'utf8');

    expect(source).toContain('hoveredRef.current = false');
    expect(source).toContain('focusedRef.current = false');
    expect(source).toContain('setPaused(false)');
  });

  it('does not restart when the parent recreates its callback', () => {
    const source = readFileSync(new URL('./UndoToast.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const onDismissRef = useRef(onDismiss)');
    expect(source).toContain('createUndoTimeout(duration, dismissOnce)');
    expect(source).toContain('[duration, toast?.id]');
    expect(source).toContain("animationPlayState: paused ? 'paused' : 'running'");
    expect(source).not.toContain('[duration, onDismiss, toast]');
  });
});

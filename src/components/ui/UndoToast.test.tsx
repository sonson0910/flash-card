import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UndoToast, scheduleUndoToastDismissal } from './UndoToast';

const effectRuntime = vi.hoisted(() => ({
  dependencies: undefined as readonly unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
}));

vi.mock('react', () => ({
  useEffect(
    effect: () => void | (() => void),
    dependencies: readonly unknown[],
  ) {
    const changed = !effectRuntime.dependencies
      || effectRuntime.dependencies.length !== dependencies.length
      || dependencies.some((dependency, index) => !Object.is(dependency, effectRuntime.dependencies?.[index]));
    if (!changed) return;
    effectRuntime.cleanup?.();
    effectRuntime.cleanup = effect() ?? undefined;
    effectRuntime.dependencies = dependencies;
  },
}));

vi.mock('lucide-react', () => ({
  RotateCcw: () => null,
  X: () => null,
}));

const appRuntimeSource = readFileSync(
  fileURLToPath(new URL('../../app/AppRuntime.tsx', import.meta.url)),
  'utf8',
);

beforeEach(() => {
  effectRuntime.dependencies = undefined;
  effectRuntime.cleanup = undefined;
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  effectRuntime.dependencies = undefined;
  effectRuntime.cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('UndoToast integration', () => {
  it('passes a stable dismiss callback from AppRuntime', () => {
    expect(appRuntimeSource).toMatch(
      /const dismissUndoToast = useCallback\(\(\) => \{\s*setUndoToast\(null\);\s*\}, \[\]\);/,
    );
    expect(appRuntimeSource).toContain(
      '<UndoToast toast={undoToast} onDismiss={dismissUndoToast} />',
    );
  });

  it('does not reset expiry for the same id and duration', () => {
    const onDismiss = vi.fn();
    const render = () => UndoToast({
      toast: { id: 'toast-1', message: 'Restored', onUndo: vi.fn(), durationMs: 1000 },
      onDismiss,
    });

    render();
    vi.advanceTimersByTime(999);
    render();
    vi.advanceTimersByTime(1);

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('reschedules expiry when toast id or duration changes', () => {
    const onDismiss = vi.fn();
    const render = (id: string, durationMs: number) => UndoToast({
      toast: { id, message: 'Restored', onUndo: vi.fn(), durationMs },
      onDismiss,
    });

    render('toast-1', 1000);
    vi.advanceTimersByTime(500);
    render('toast-2', 1000);
    vi.advanceTimersByTime(500);
    expect(onDismiss).not.toHaveBeenCalled();

    render('toast-2', 2000);
    vi.advanceTimersByTime(1999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('dismisses once after the scheduled duration', () => {
    const onDismiss = vi.fn();
    scheduleUndoToastDismissal(onDismiss, 1000);

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('cleanup cancels a pending dismissal', () => {
    const onDismiss = vi.fn();
    const cleanup = scheduleUndoToastDismissal(onDismiss, 1000);

    cleanup();
    vi.advanceTimersByTime(1000);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

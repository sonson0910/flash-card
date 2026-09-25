import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUndoTimeout, isUndoKeyboardShortcut, UndoToast } from './UndoToast';

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

describe('UndoToast keyboard recovery', () => {
  it('accepts the platform undo shortcut outside editable controls', () => {
    expect(isUndoKeyboardShortcut({ key: 'z', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, target: null })).toBe(true);
    expect(isUndoKeyboardShortcut({ key: 'Z', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false, target: null })).toBe(true);
  });

  it('does not intercept redo or text editing shortcuts', () => {
    const editableTarget = { closest: vi.fn(() => ({} as Element)) };
    expect(isUndoKeyboardShortcut({ key: 'z', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, target: null })).toBe(false);
    expect(isUndoKeyboardShortcut({ key: 'z', metaKey: true, ctrlKey: false, altKey: true, shiftKey: false, target: null })).toBe(false);
    expect(isUndoKeyboardShortcut({ key: 'z', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, target: editableTarget as unknown as EventTarget })).toBe(false);
    expect(editableTarget.closest).toHaveBeenCalledOnce();
  });
});

describe('UndoToast dismissal timer', () => {
  it('does not restart when the parent recreates its callback', () => {
    const source = readFileSync(new URL('./UndoToast.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const onDismissRef = useRef(onDismiss)');
    expect(source).toContain('createUndoTimeout(duration, dismissOnce)');
    expect(source).toContain('[duration, toast?.id]');
    expect(source).toContain("animationPlayState: paused ? 'paused' : 'running'");
    expect(source).toContain('const duration = toast?.durationMs ?? 6000');
    expect(source).toContain('aria-keyshortcuts="Meta+Z Control+Z"');
    expect(source).toContain('role="status"');
    expect(source).toContain('data-undo-toast="true"');
    expect(source).toContain('stacked?: boolean');
    expect(source).not.toContain('[duration, onDismiss, toast]');
  });

  it('keeps standalone positioning by default and flows in the shared stack when requested', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const props = { toast: { id: 'undo-1', message: 'Card deleted', onUndo: vi.fn() }, onDismiss: vi.fn() };
    const render = (stacked?: boolean) => renderToStaticMarkup(
      <I18nProvider i18n={i18n}><UndoToast {...props} stacked={stacked} /></I18nProvider>,
    );
    const standalone = render();
    const inStack = render(true);

    expect(standalone).toContain('fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))]');
    expect(standalone).toContain('lg:bottom-4');
    expect(standalone).toContain('pointer-events-auto');
    expect(inStack).toContain('relative z-[75] w-full');
    expect(inStack).toContain('pointer-events-auto');
    expect(inStack).not.toContain('fixed bottom-');
    expect(inStack).not.toContain('right-4');
  });

  it('shows the deleted headword as a separate Canvas-emphasized subject', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <UndoToast toast={{ id: 'undo-subject', message: 'Card deleted.', subject: 'adapt', onUndo: vi.fn() }} onDismiss={vi.fn()} />
      </I18nProvider>,
    );

    expect(html).toContain('<span class="undo-toast-copy">Card deleted.</span>');
    expect(html).toContain('<span class="undo-toast-subject">adapt</span>');
  });
});

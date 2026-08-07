import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export type AppOverlayKind = 'share' | 'practice' | 'stats' | 'clear';

export interface OverlayScheduler {
  requestAnimationFrame(callback: FrameRequestCallback): unknown;
  cancelAnimationFrame(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface NoticeScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserOverlayScheduler: OverlayScheduler = {
  requestAnimationFrame: callback => globalThis.requestAnimationFrame(callback),
  cancelAnimationFrame: handle => globalThis.cancelAnimationFrame(handle as number),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export const resolveFocusReturnTarget = (
  opener: HTMLElement | null,
  fallbackHeading: HTMLElement | null,
): HTMLElement | null => opener?.isConnected ? opener : fallbackHeading;

export const scheduleOverlayFocusRestore = ({
  event,
  opener,
  fallbackHeading,
  scheduler = browserOverlayScheduler,
}: {
  event: Pick<Event, 'preventDefault'>;
  opener: HTMLElement | null;
  fallbackHeading: HTMLElement | null;
  scheduler?: OverlayScheduler;
}): (() => void) => {
  event.preventDefault();
  let frame: unknown = null;
  const task = scheduler.setTimeout(() => {
    frame = scheduler.requestAnimationFrame(() => {
      resolveFocusReturnTarget(opener, fallbackHeading)?.focus({ preventScroll: true });
    });
  }, 0);

  return () => {
    scheduler.clearTimeout(task);
    if (frame !== null) scheduler.cancelAnimationFrame(frame);
  };
};

export const scheduleNoticeDismissal = (
  notice: string | null,
  dismiss: () => void,
  scheduler: NoticeScheduler = browserOverlayScheduler,
  delayMs = 5000,
): (() => void) => {
  if (!notice) return () => undefined;
  const timer = scheduler.setTimeout(dismiss, delayMs);
  return () => scheduler.clearTimeout(timer);
};

const browserActiveElement = (): HTMLElement | null => {
  const activeElement = globalThis.document?.activeElement;
  return typeof HTMLElement !== 'undefined' && activeElement instanceof HTMLElement
    ? activeElement
    : null;
};

const browserFallbackHeading = (): HTMLElement | null =>
  globalThis.document?.querySelector<HTMLElement>('main h1') ?? null;

export function useOverlayState({
  getActiveElement = browserActiveElement,
  getFallbackHeading = browserFallbackHeading,
  scheduler = browserOverlayScheduler,
}: {
  getActiveElement?: () => HTMLElement | null;
  getFallbackHeading?: () => HTMLElement | null;
  scheduler?: OverlayScheduler;
} = {}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [isPracticeMenuOpen, setIsPracticeMenuOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [hasMountedOverlays, setHasMountedOverlays] = useState(false);
  const shareOpenerRef = useRef<HTMLElement | null>(null);
  const practiceOpenerRef = useRef<HTMLElement | null>(null);
  const statsOpenerRef = useRef<HTMLElement | null>(null);
  const clearOpenerRef = useRef<HTMLElement | null>(null);

  useEffect(
    () => scheduleNoticeDismissal(notice, () => setNotice(null), scheduler),
    [notice, scheduler],
  );

  const rememberOpener = useCallback((
    openerRef: RefObject<HTMLElement | null>,
    explicitOpener?: HTMLElement | null,
  ) => {
    openerRef.current = explicitOpener ?? getActiveElement();
    setHasMountedOverlays(true);
  }, [getActiveElement]);

  const openPractice = useCallback((opener?: HTMLElement | null) => {
    rememberOpener(practiceOpenerRef, opener);
    setIsPracticeMenuOpen(true);
  }, [rememberOpener]);

  const openStats = useCallback((opener?: HTMLElement | null) => {
    rememberOpener(statsOpenerRef, opener);
    setIsStatsOpen(true);
  }, [rememberOpener]);

  const openClearConfirm = useCallback((opener?: HTMLElement | null, canOpen = true) => {
    if (!canOpen) return false;
    rememberOpener(clearOpenerRef, opener);
    setShowClearConfirm(true);
    return true;
  }, [rememberOpener]);

  const openShare = useCallback((link: string, opener?: HTMLElement | null) => {
    rememberOpener(shareOpenerRef, opener);
    setShareLink(link);
  }, [rememberOpener]);

  const restoreFocus = useCallback((event: Pick<Event, 'preventDefault'>, kind: AppOverlayKind) => {
    const openerRefs: Record<AppOverlayKind, RefObject<HTMLElement | null>> = {
      share: shareOpenerRef,
      practice: practiceOpenerRef,
      stats: statsOpenerRef,
      clear: clearOpenerRef,
    };
    return scheduleOverlayFocusRestore({
      event,
      opener: openerRefs[kind].current,
      fallbackHeading: getFallbackHeading(),
      scheduler,
    });
  }, [getFallbackHeading, scheduler]);

  return {
    notice,
    setNotice,
    shareLink,
    setShareLink,
    isPracticeMenuOpen,
    setIsPracticeMenuOpen,
    isStatsOpen,
    setIsStatsOpen,
    showClearConfirm,
    setShowClearConfirm,
    hasMountedOverlays,
    shareOpenerRef,
    practiceOpenerRef,
    statsOpenerRef,
    clearOpenerRef,
    rememberOpener,
    openPractice,
    openStats,
    openClearConfirm,
    openShare,
    restoreFocus,
  };
}

export interface StudyViewTransition {
  finished?: Promise<unknown>;
  updateCallbackDone?: Promise<unknown>;
  skipTransition?: () => void;
}

export type StartStudyViewTransition = (
  updateCallback: () => void | Promise<void>,
) => StudyViewTransition;

interface StudyHandoffOptions {
  source: Element | null;
  root: HTMLElement | null;
  prefersReducedMotion: boolean;
  startViewTransition?: StartStudyViewTransition;
  activate: () => void;
  waitForCard: () => Promise<boolean>;
}

const HANDOFF_MARKER = 'active';
const HANDOFF_RENDER_WAIT_TIMEOUT_MS = 450;
const HANDOFF_ANIMATION_DURATION_MS = 560;
const HANDOFF_CLEANUP_BUFFER_MS = 250;
const HANDOFF_FALLBACK_CLEANUP_TIMEOUT_MS = HANDOFF_RENDER_WAIT_TIMEOUT_MS + HANDOFF_ANIMATION_DURATION_MS + HANDOFF_CLEANUP_BUFFER_MS;

export function waitForStudyCard(
  documentRoot: Pick<Document, 'querySelector'> | null,
  maxWaitMs = HANDOFF_RENDER_WAIT_TIMEOUT_MS,
): Promise<boolean> {
  if (!documentRoot) return Promise.resolve(false);

  return new Promise(resolve => {
    const startedAt = Date.now();
    let settled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
      resolve(ready);
    };
    const check = () => {
      const ready = Boolean(documentRoot.querySelector('[data-study-card]'));
      if (ready || Date.now() - startedAt >= maxWaitMs) {
        finish(ready);
        return;
      }
      timer = globalThis.setTimeout(check, 16);
    };

    check();
  });
}

export function startStudyHandoff(options: StudyHandoffOptions): (() => void) | null {
  let activationAttempted = false;
  const activateOnce = () => {
    if (activationAttempted) return;
    activationAttempted = true;
    options.activate();
  };

  if (!options.source || options.prefersReducedMotion || !options.root || !options.startViewTransition) {
    activateOnce();
    return null;
  }

  const root = options.root;
  root.dataset.studyHandoff = HANDOFF_MARKER;
  let transition: StudyViewTransition | null = null;
  let settled = false;
  let skipRequested = false;
  let skipApplied = false;
  let cleanupTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let fallbackCleanupTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  const settle = () => {
    if (settled) return;
    settled = true;
    if (cleanupTimer !== undefined) globalThis.clearTimeout(cleanupTimer);
    if (fallbackCleanupTimer !== undefined) globalThis.clearTimeout(fallbackCleanupTimer);
    delete root.dataset.studyHandoff;
  };
  const requestSkip = () => {
    skipRequested = true;
    if (!transition || skipApplied) return;
    skipApplied = true;
    try {
      transition?.skipTransition?.();
    } catch {
      // Cleanup must remain reliable when a browser rejects cancellation.
    }
  };
  const cancel = () => {
    if (settled) return;
    requestSkip();
    settle();
  };

  try {
    transition = options.startViewTransition(() => {
      activateOnce();
      return options.waitForCard().then(ready => {
        if (!ready) requestSkip();
      });
    });
  } catch {
    settle();
    activateOnce();
    return null;
  }

  if (skipRequested) requestSkip();
  if (transition.finished) void Promise.resolve(transition.finished).then(settle, settle);
  if (transition.updateCallbackDone) {
    void Promise.resolve(transition.updateCallbackDone).then(() => {
      cleanupTimer = globalThis.setTimeout(settle, HANDOFF_ANIMATION_DURATION_MS + HANDOFF_CLEANUP_BUFFER_MS);
    }, settle);
  } else {
    fallbackCleanupTimer = globalThis.setTimeout(settle, HANDOFF_FALLBACK_CLEANUP_TIMEOUT_MS);
  }
  return cancel;
}

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
  waitForCard: () => Promise<void>;
}

const HANDOFF_MARKER = 'active';
const HANDOFF_CLEANUP_TIMEOUT_MS = 700;

export function waitForStudyCard(
  documentRoot: Pick<Document, 'querySelector'> | null,
  maxWaitMs = 450,
): Promise<void> {
  if (!documentRoot) return Promise.resolve();

  return new Promise(resolve => {
    const startedAt = Date.now();
    let settled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (documentRoot.querySelector('[data-study-card]') || Date.now() - startedAt >= maxWaitMs) {
        finish();
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
  let cleanupTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  const settle = () => {
    if (settled) return;
    settled = true;
    if (cleanupTimer !== undefined) globalThis.clearTimeout(cleanupTimer);
    delete root.dataset.studyHandoff;
  };
  const cancel = () => {
    if (settled) return;
    try {
      transition?.skipTransition?.();
    } catch {
      // Cleanup must remain reliable when a browser rejects cancellation.
    }
    settle();
  };

  try {
    transition = options.startViewTransition(() => {
      activateOnce();
      return options.waitForCard();
    });
  } catch {
    settle();
    activateOnce();
    return null;
  }

  cleanupTimer = globalThis.setTimeout(settle, HANDOFF_CLEANUP_TIMEOUT_MS);
  if (transition.finished) void Promise.resolve(transition.finished).then(settle, settle);
  if (transition.updateCallbackDone) void Promise.resolve(transition.updateCallbackDone).catch(settle);
  return cancel;
}

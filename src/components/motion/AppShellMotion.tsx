import { useEffect, type RefObject } from 'react';

interface AppShellMotionProps {
  appShellRef: RefObject<HTMLDivElement | null>;
  navigationRef: RefObject<HTMLElement | null>;
  viewMode: string;
  viewStageRef: RefObject<HTMLDivElement | null>;
}

const EXPRESSIVE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

function animate(
  element: Element | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (!element || typeof element.animate !== 'function') return null;
  return element.animate(keyframes, { fill: 'both', ...options });
}

export function settleShellAnimations(
  animations: readonly Animation[],
  finish: () => void,
): () => void {
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    finish();
  };
  const fallbackTimer = globalThis.setTimeout(settle, 1_000);
  const fallbackInterval = globalThis.setInterval(settle, 1_000);
  let frameRequest: number | undefined;
  const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis);
  if (requestFrame) {
    const deadline = (globalThis.performance?.now?.() ?? 0) + 1_000;
    const settleOnFrame = (timestamp: number) => {
      if (timestamp >= deadline) {
        settle();
        return;
      }
      frameRequest = requestFrame(settleOnFrame);
    };
    frameRequest = requestFrame(settleOnFrame);
  }
  const settledAnimations = new Set<Animation>();
  const markAnimationSettled = (animation: Animation) => {
    settledAnimations.add(animation);
    if (settledAnimations.size === animations.length) settle();
  };
  animations.forEach(animation => {
    const settle = () => markAnimationSettled(animation);
    animation.addEventListener('finish', settle, { once: true });
    animation.addEventListener('cancel', settle, { once: true });
  });
  const finishedPromises = animations.flatMap(animation => {
    try {
      return [animation.finished];
    } catch {
      return [];
    }
  });
  if (finishedPromises.length > 0) {
    void Promise.allSettled(finishedPromises).then(settle);
  }
  return () => {
    globalThis.clearTimeout(fallbackTimer);
    globalThis.clearInterval(fallbackInterval);
    if (frameRequest !== undefined) cancelFrame?.(frameRequest);
  };
}

export function AppShellMotion({
  appShellRef,
  navigationRef,
  viewMode,
  viewStageRef,
}: AppShellMotionProps) {
  useEffect(() => {
    const viewStage = viewStageRef.current;
    if (!viewStage) return;
    const currentNavigation = () => appShellRef.current?.querySelector<HTMLElement>('nav.app-navigation') ?? navigationRef.current;
    const navigation = currentNavigation();

    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const isInitialEntrance = navigation?.dataset.motionState !== 'ready';
    const animations: Animation[] = [];
    let cancelSettlement: (() => void) | undefined;
    let finished = false;

    const remember = (animation: Animation | null) => {
      if (animation) animations.push(animation);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelSettlement?.();
      currentNavigation()?.setAttribute('data-motion-state', 'ready');
      animations.forEach(animation => animation.cancel());
    };

    if (reducedMotion || typeof viewStage.animate !== 'function') {
      finish();
      return;
    }

    if (!isInitialEntrance) {
      remember(animate(
        viewStage,
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 210, easing: EXPRESSIVE_EASING },
      ));
    } else {
      navigation?.setAttribute('data-motion-state', 'entering');
      remember(animate(
        navigation,
        [
          { transform: 'translateY(-18px) scale(0.99)' },
          { transform: 'translateY(0) scale(1)' },
        ],
        { duration: 460, easing: EXPRESSIVE_EASING },
      ));
      appShellRef.current?.querySelectorAll<HTMLElement>('[data-gsap-brand]').forEach(element => {
        remember(animate(
          element,
          [
            { transform: 'translateX(-14px)' },
            { transform: 'translateX(0)' },
          ],
          { duration: 320, delay: 80, easing: EXPRESSIVE_EASING },
        ));
      });
      appShellRef.current?.querySelectorAll<HTMLElement>('[data-gsap-header-actions]').forEach(element => {
        remember(animate(
          element,
          [
            { transform: 'translateX(14px)' },
            { transform: 'translateX(0)' },
          ],
          { duration: 320, delay: 120, easing: EXPRESSIVE_EASING },
        ));
      });
      remember(animate(
        viewStage,
        [
          { transform: 'translateY(18px) scale(0.992)' },
          { transform: 'translateY(0) scale(1)' },
        ],
        { duration: 420, delay: navigation ? 140 : 0, easing: EXPRESSIVE_EASING },
      ));
    }

    if (animations.length === 0) {
      finish();
      return;
    }
    cancelSettlement = settleShellAnimations(animations, finish);

    return () => finish();
  }, [appShellRef, navigationRef, viewMode, viewStageRef]);

  return null;
}

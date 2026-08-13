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

export function AppShellMotion({
  appShellRef,
  navigationRef,
  viewMode,
  viewStageRef,
}: AppShellMotionProps) {
  useEffect(() => {
    const navigation = navigationRef.current;
    const viewStage = viewStageRef.current;
    if (!viewStage) return;

    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const isInitialEntrance = navigation?.dataset.motionState !== 'ready';
    const animations: Animation[] = [];
    let fallbackTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let finished = false;

    const remember = (animation: Animation | null) => {
      if (animation) animations.push(animation);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      if (fallbackTimer !== undefined) globalThis.clearTimeout(fallbackTimer);
      navigation?.setAttribute('data-motion-state', 'ready');
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
          { transform: 'translateY(16px) scale(0.992)' },
          { transform: 'translateY(0) scale(1)' },
        ],
        { duration: 380, easing: EXPRESSIVE_EASING },
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
    const settledAnimations = new Set<Animation>();
    const markAnimationSettled = (animation: Animation) => {
      settledAnimations.add(animation);
      if (settledAnimations.size === animations.length) finish();
    };
    animations.forEach(animation => {
      const settle = () => markAnimationSettled(animation);
      animation.addEventListener('finish', settle, { once: true });
      animation.addEventListener('cancel', settle, { once: true });
    });
    void Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
    fallbackTimer = globalThis.setTimeout(finish, 1_000);

    return () => finish();
  }, [appShellRef, navigationRef, viewMode, viewStageRef]);

  return null;
}

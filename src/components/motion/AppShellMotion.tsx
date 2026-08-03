import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import type { RefObject } from 'react';

gsap.registerPlugin(useGSAP);

interface AppShellMotionProps {
  appShellRef: RefObject<HTMLDivElement | null>;
  navigationRef: RefObject<HTMLElement | null>;
  viewMode: string;
  viewStageRef: RefObject<HTMLDivElement | null>;
}

export function AppShellMotion({
  appShellRef,
  navigationRef,
  viewMode,
  viewStageRef,
}: AppShellMotionProps) {
  useGSAP(() => {
    const navigation = navigationRef.current;
    const viewStage = viewStageRef.current;
    if (!viewStage) return;
    const isInitialEntrance = navigation?.dataset.motionState !== 'ready';
    const media = gsap.matchMedia();

    media.add(
      {
        reduced: '(prefers-reduced-motion: reduce)',
        expressive: '(prefers-reduced-motion: no-preference)',
      },
      context => {
        const targets = [navigation, viewStage].filter(Boolean);
        if (context.conditions?.reduced) {
          gsap.set(targets, { clearProps: 'transform,opacity,visibility' });
          navigation?.setAttribute('data-motion-state', 'ready');
          return;
        }

        if (!isInitialEntrance) {
          gsap.fromTo(
            viewStage,
            { autoAlpha: 0, y: 16, scale: 0.992 },
            {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              duration: 0.38,
              ease: 'expo.out',
              clearProps: 'transform,opacity,visibility',
            },
          );
          return;
        }

        navigation?.setAttribute('data-motion-state', 'entering');
        const timeline = gsap.timeline({ defaults: { ease: 'expo.out' } });
        if (navigation) {
          timeline
            .fromTo(
              navigation,
              { autoAlpha: 0, y: -18, scale: 0.99 },
              {
                autoAlpha: 1,
                y: 0,
                scale: 1,
                duration: 0.46,
                clearProps: 'transform,opacity,visibility',
              },
            )
            .fromTo(
              '[data-gsap-brand]',
              { autoAlpha: 0, x: -14 },
              { autoAlpha: 1, x: 0, duration: 0.32, clearProps: 'transform,opacity,visibility' },
              '<0.08',
            )
            .fromTo(
              '[data-gsap-header-actions]',
              { autoAlpha: 0, x: 14 },
              { autoAlpha: 1, x: 0, duration: 0.32, clearProps: 'transform,opacity,visibility' },
              '<0.04',
            );
        }
        timeline.fromTo(
          viewStage,
          { autoAlpha: 0, y: 18, scale: 0.992 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.42, clearProps: 'transform,opacity,visibility' },
          navigation ? '<0.14' : 0,
        );
        timeline.eventCallback('onComplete', () => {
          navigation?.setAttribute('data-motion-state', 'ready');
        });
      },
    );

    return () => media.revert();
  }, { scope: appShellRef, dependencies: [viewMode], revertOnUpdate: true });

  return null;
}

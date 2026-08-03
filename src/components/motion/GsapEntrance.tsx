import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  forwardRef,
  useRef,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from 'react';
import { getGsapEntranceMotion, type GsapEntranceVariant } from '../../lib/motion';

gsap.registerPlugin(useGSAP);

interface GsapEntranceProps extends HTMLAttributes<HTMLDivElement> {
  animationKey?: string | number | boolean;
  children: ReactNode;
  direction?: 1 | -1;
  onEntered?: () => void;
  variant?: GsapEntranceVariant;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as MutableRefObject<T | null>).current = value;
}

export const GsapEntrance = forwardRef<HTMLDivElement, GsapEntranceProps>(function GsapEntrance({
  animationKey = 'mount',
  children,
  direction = 1,
  onEntered,
  variant = 'view',
  ...props
}, forwardedRef) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const onEnteredRef = useRef(onEntered);
  onEnteredRef.current = onEntered;

  useGSAP(() => {
    const element = elementRef.current;
    if (!element) return;
    const media = gsap.matchMedia();
    media.add(
      {
        reduced: '(prefers-reduced-motion: reduce)',
        expressive: '(prefers-reduced-motion: no-preference)',
      },
      context => {
        const animation = getGsapEntranceMotion(variant, direction, Boolean(context.conditions?.reduced));
        gsap.fromTo(element, animation.from, {
          ...animation.to,
          force3D: !context.conditions?.reduced,
          onComplete: () => {
            gsap.set(element, { clearProps: 'transform,opacity,visibility' });
            onEnteredRef.current?.();
          },
        });
      },
    );
    return () => media.revert();
  }, { scope: elementRef, dependencies: [animationKey, direction, variant], revertOnUpdate: true });

  return (
    <div
      {...props}
      ref={node => {
        elementRef.current = node;
        assignRef(forwardedRef, node);
      }}
      data-gsap-entrance={variant}
    >
      {children}
    </div>
  );
});

import gsap from 'gsap';
import { useEffect, useRef } from 'react';

interface CountUpProps {
  readonly to: number;
  readonly className?: string;
  readonly duration?: number;
  readonly suffix?: string;
}

const formatCount = (value: number): string => Math.round(value).toLocaleString('en-US');

// Adapted from React Bits CountUp, using the GSAP runtime already shipped by this app.
export function CountUp({ to, className, duration = 0.5, suffix = '' }: CountUpProps) {
  const visualRef = useRef<HTMLSpanElement | null>(null);
  const previousValueRef = useRef(0);
  const finalText = `${formatCount(to)}${suffix}`;

  useEffect(() => {
    const element = visualRef.current;
    if (!element) return;
    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion) {
      element.textContent = formatCount(to);
      previousValueRef.current = to;
      return;
    }

    const counter = { value: previousValueRef.current };
    const tween = gsap.to(counter, {
      value: to,
      duration,
      ease: 'expo.out',
      onUpdate: () => {
        element.textContent = formatCount(counter.value);
        previousValueRef.current = counter.value;
      },
    });
    return () => { tween.kill(); };
  }, [duration, to]);

  return (
    <>
      <span ref={visualRef} className={className} data-count-up="true" aria-hidden="true">{formatCount(previousValueRef.current)}</span>
      <span className="sr-only">{finalText}</span>
    </>
  );
}

import gsap from 'gsap';
import { useEffect, useRef } from 'react';
import { useUiLocale } from '../../i18n/I18nProvider';
import { formatNumber } from '../../lib/format';
import { useReducedMotion } from '../../lib/motionPreference';

interface CountUpProps {
  readonly to: number;
  readonly className?: string;
  readonly duration?: number;
  readonly suffix?: string;
}

const formatCount = (value: number): string => formatNumber(Math.round(value));

// Adapted from React Bits CountUp, using the GSAP runtime already shipped by this app.
export function CountUp({ to, className, duration = 0.5, suffix = '' }: CountUpProps) {
  const locale = useUiLocale();
  const visualRef = useRef<HTMLSpanElement | null>(null);
  const previousValueRef = useRef(0);
  const finalText = `${formatCount(to)}${suffix}`;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const element = visualRef.current;
    if (!element) return;
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
  }, [duration, locale, reducedMotion, to]);

  return (
    <>
      <span ref={visualRef} className={className} data-count-up="true" aria-hidden="true">{formatCount(previousValueRef.current)}</span>
      <span className="sr-only">{finalText}</span>
    </>
  );
}

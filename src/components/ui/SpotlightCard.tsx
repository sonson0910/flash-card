import { useEffect, useRef, type HTMLAttributes, type PointerEvent } from 'react';
import { getSpotlightPosition } from '../../lib/motion';

interface SpotlightCardProps extends HTMLAttributes<HTMLDivElement> {
  readonly spotlightColor?: string;
}

export function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(8, 145, 178, 0.16)',
  ...props
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const boundsRef = useRef<DOMRect | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const frameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      || !globalThis.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;

    pointerRef.current = { x: event.clientX, y: event.clientY };
    boundsRef.current ??= event.currentTarget.getBoundingClientRect();
    if (frameRef.current !== null) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const card = cardRef.current;
      const bounds = boundsRef.current;
      if (!card || !bounds) return;
      const position = getSpotlightPosition(pointerRef.current.x, pointerRef.current.y, bounds);
      card.style.setProperty('--spotlight-x', `${position.x}%`);
      card.style.setProperty('--spotlight-y', `${position.y}%`);
    });
  };

  return (
    <div
      {...props}
      ref={cardRef}
      data-react-bits="spotlight-card"
      className={`spotlight-card relative overflow-hidden ${className}`}
      onPointerEnter={event => { boundsRef.current = event.currentTarget.getBoundingClientRect(); }}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => { boundsRef.current = null; }}
    >
      <div
        aria-hidden="true"
        className="spotlight-card__glow pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%), ${spotlightColor}, transparent 72%)` }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

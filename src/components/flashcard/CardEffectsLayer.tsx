import gsap from 'gsap';
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { getSpotlightPosition } from '../../lib/motion';

export interface CardAura {
  core: string;
  mid: string;
  outer: string;
}

function getCategoryAura(category?: string): CardAura {
  const cat = (category || '').toLowerCase();
  if (cat.includes('nature') || cat.includes('environment')) return { core: 'rgba(16, 185, 129, 0.7)', mid: 'rgba(6, 182, 212, 0.45)', outer: 'rgba(5, 150, 105, 0.2)' };
  if (cat.includes('tech') || cat.includes('science')) return { core: 'rgba(6, 182, 212, 0.8)', mid: 'rgba(59, 130, 246, 0.5)', outer: 'rgba(147, 51, 234, 0.25)' };
  if (cat.includes('emotion') || cat.includes('feeling') || cat.includes('food')) return { core: 'rgba(244, 63, 94, 0.75)', mid: 'rgba(251, 146, 60, 0.45)', outer: 'rgba(236, 72, 153, 0.2)' };
  if (cat.includes('work') || cat.includes('business')) return { core: 'rgba(139, 92, 246, 0.75)', mid: 'rgba(6, 182, 212, 0.45)', outer: 'rgba(99, 102, 241, 0.2)' };
  return { core: 'rgba(6, 182, 212, 0.75)', mid: 'rgba(14, 165, 233, 0.45)', outer: 'rgba(99, 102, 241, 0.2)' };
}

interface UseCardEffectsOptions {
  category?: string;
  faceRef: RefObject<HTMLDivElement | null>;
  spotlightRef: RefObject<HTMLDivElement | null>;
  reduceMotion: boolean;
  isFlipAnimating: boolean;
  spotlightBackground: string;
}

export function useCardEffects({ category, faceRef, spotlightRef, reduceMotion, isFlipAnimating, spotlightBackground }: UseCardEffectsOptions) {
  const [isHovered, setIsHovered] = useState(false);
  const rafTiltRef = useRef<number | null>(null);
  const spotlightBoundsRef = useRef<DOMRect | null>(null);
  const aura = getCategoryAura(category);

  useEffect(() => () => {
    if (rafTiltRef.current !== null) window.cancelAnimationFrame(rafTiltRef.current);
  }, []);

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (reduceMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches || rafTiltRef.current !== null) return;
    const { clientX, clientY, currentTarget } = event;
    rafTiltRef.current = window.requestAnimationFrame(() => {
      rafTiltRef.current = null;
      const bounds = spotlightBoundsRef.current ?? currentTarget.getBoundingClientRect();
      spotlightBoundsRef.current = bounds;
      const position = getSpotlightPosition(clientX, clientY, bounds);
      for (const target of [spotlightRef.current, faceRef.current]) {
        target?.style.setProperty('--spotlight-x', `${position.x}%`);
        target?.style.setProperty('--spotlight-y', `${position.y}%`);
      }
      if (!isFlipAnimating && faceRef.current) {
        const px = ((clientX - bounds.left) / bounds.width - 0.5) * 2;
        const py = ((clientY - bounds.top) / bounds.height - 0.5) * 2;
        gsap.to(faceRef.current, { rotationX: -py * 4, rotationY: px * 4, duration: 0.28, ease: 'power2.out', overwrite: 'auto' });
      }
    });
  };

  const handleMouseLeave = () => {
    if (rafTiltRef.current !== null) {
      window.cancelAnimationFrame(rafTiltRef.current);
      rafTiltRef.current = null;
    }
    setIsHovered(false);
    spotlightBoundsRef.current = null;
    for (const target of [spotlightRef.current, faceRef.current]) {
      target?.style.setProperty('--spotlight-x', '50%');
      target?.style.setProperty('--spotlight-y', '50%');
    }
    if (!isFlipAnimating && faceRef.current) gsap.to(faceRef.current, { rotationX: 0, rotationY: 0, duration: 0.35, ease: 'power2.out', overwrite: 'auto' });
  };

  const handleMouseEnter = (event: MouseEvent<HTMLDivElement>) => {
    if (!reduceMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      spotlightBoundsRef.current = event.currentTarget.getBoundingClientRect();
      setIsHovered(true);
    }
  };

  return { aura, spotlightBackground, isHovered, handleMouseEnter, handleMouseMove, handleMouseLeave };
}

interface CardEffectsLayerProps {
  aura?: CardAura;
  spotlightRef?: RefObject<HTMLDivElement | null>;
  isHovered?: boolean;
  spotlightBackground?: string;
  holo?: boolean;
}

export function CardEffectsLayer({ aura, spotlightRef, isHovered = false, spotlightBackground, holo = false }: CardEffectsLayerProps) {
  return (
    <>
      {aura && (
        <div
          className="pointer-events-none absolute -inset-3 sm:-inset-4 z-0 rounded-[44px] opacity-0 blur-xl transition-opacity duration-300 ease-out will-change-[opacity] group-hover:opacity-35 group-focus-within:opacity-35"
          style={{ background: `radial-gradient(ellipse at 50% 38%, ${aura.core} 0%, ${aura.mid} 45%, ${aura.outer} 70%, transparent 85%)` }}
          aria-hidden="true"
        />
      )}
      {spotlightRef && (
        <div
          ref={spotlightRef}
          className="absolute inset-0 pointer-events-none z-30 transition-opacity duration-200"
          style={{
            background: spotlightBackground,
            opacity: isHovered ? 1 : 0,
          }}
        />
      )}
      {holo && <div className="flashcard-holo" aria-hidden="true" />}
    </>
  );
}

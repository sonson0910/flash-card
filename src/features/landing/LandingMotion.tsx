import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useRef, type ReactNode } from 'react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

interface LandingMotionProps {
  readonly children: ReactNode;
}

export function LandingMotion({ children }: LandingMotionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return;

    const media = gsap.matchMedia();
    media.add(
      {
        desktop: '(min-width: 1024px)',
        mobile: '(max-width: 1023px)',
        reduced: '(prefers-reduced-motion: reduce)',
      },
      context => {
        const heroImage = root.querySelector<HTMLElement>('[data-hero-image]');
        const theaterFigure = root.querySelector<HTMLElement>('[data-theater-figure]');
        const theaterCopy = root.querySelector<HTMLElement>('[data-theater-copy]');
        const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-journey-card]'));
        const cardsContainer = root.querySelector<HTMLElement>('[data-journey-cards]');
        const journeySection = root.querySelector<HTMLElement>('[data-journey-section]');
        const journeyPin = root.querySelector<HTMLElement>('[data-journey-pin]');
        const reduced = Boolean(context.conditions?.reduced);

        if (reduced) {
          gsap.set([heroImage, theaterFigure, theaterCopy], { clearProps: 'transform,opacity,visibility' });
          gsap.set(cardsContainer, { position: 'relative', inset: 'auto', display: 'grid' });
          gsap.set(journeyPin, { minHeight: 'auto' });
          gsap.set(cards, { position: 'relative', inset: 'auto', opacity: 1, visibility: 'visible', transform: 'none' });
          return;
        }

        if (heroImage) {
          gsap.fromTo(heroImage, { scale: 1.09, opacity: 0.48 }, {
            scale: 1,
            opacity: 0.7,
            ease: 'none',
            scrollTrigger: {
              trigger: heroImage,
              start: 'top top',
              end: 'bottom top',
              scrub: 1,
            },
          });
        }

        if (theaterFigure) {
          gsap.fromTo(theaterFigure, { y: 34, opacity: 0.2 }, {
            y: 0,
            opacity: 1,
            duration: 0.8,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: theaterFigure,
              start: 'top 78%',
              toggleActions: 'play none none reverse',
            },
          });
        }

        if (theaterCopy) {
          gsap.fromTo(theaterCopy, { y: 22, opacity: 0.35 }, {
            y: 0,
            opacity: 1,
            duration: 0.7,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: theaterCopy,
              start: 'top 82%',
              toggleActions: 'play none none reverse',
            },
          });
        }

        if (cards.length && context.conditions?.desktop && journeySection && journeyPin) {
          gsap.set(cards, { position: 'absolute', inset: 0, autoAlpha: 0, y: 28, scale: 0.96 });
          gsap.set(cards[0], { autoAlpha: 1, y: 0, scale: 1 });
          const timeline = gsap.timeline({
            scrollTrigger: {
              trigger: journeySection,
              start: 'top top',
              end: () => `+=${Math.max(window.innerHeight * 2.8, 1800)}`,
              pin: journeyPin,
              pinSpacing: true,
              scrub: 1,
              invalidateOnRefresh: true,
            },
          });

          cards.slice(1).forEach((card, index) => {
            const previousCard = cards[index];
            timeline
              .to(previousCard, { scale: 0.9, y: -42, autoAlpha: 0, duration: 0.5, ease: 'none' }, `stage-${index}`)
              .to(card, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'none' }, `stage-${index}+=0.45`);
          });
        } else if (cards.length) {
          gsap.fromTo(cards, { y: 24, opacity: 0.25 }, {
            y: 0,
            opacity: 1,
            duration: 0.62,
            ease: 'power3.out',
            stagger: 0.09,
            scrollTrigger: {
              trigger: cards[0],
              start: 'top 84%',
              toggleActions: 'play none none reverse',
            },
          });
        }
      },
    );

    return () => media.revert();
  }, { scope: rootRef, revertOnUpdate: true });

  return <div ref={rootRef}>{children}</div>;
}

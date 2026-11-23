import { CalendarDays, MoonStar, Sparkles, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

/** A badge medal's icon: decorative, sized by the medal. */
export type BadgeGlyph = (props: { readonly size?: number }) => ReactElement;

/** Stroke icons drawn on the classic achievements board. */
const classicPaths = {
  seed: 'M12 20v-8M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2.5-5.5-6-5.5 0 3.5 2.5 5.5 6 5.5z',
  flame: 'M12 2c1 3.5-1.5 5.5-1.5 8.2 0 1.4 1 2.5 2.3 2.5 1.5 0 2.4-1.2 2.2-3 2.3 1.7 3.5 4.3 3.5 6.8C18.5 20 15.6 22 12 22s-6.5-2.3-6.5-5.9c0-4.7 4.3-7 6.5-14.1z',
  hundred: 'M4 5h11a3 3 0 0 1 3 3v12H7a3 3 0 0 1-3-3zM4 17a3 3 0 0 1 3-3h11M9 8h5',
  ear: 'M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0M10 9a2 2 0 0 1 4 0',
  moon: 'M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z',
  hoard: 'M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
} as const;

/** Filled icons drawn on the Crystal collection board. */
const crystalPaths = {
  star: 'M12 1.5l3 7.1 7.7.6-5.9 5 1.8 7.5L12 17.7l-6.6 4 1.8-7.5-5.9-5 7.7-.6z',
  trail: 'M3 13l4-2 3 3 4-5 3 3 4-3-2 6-4-1-3 4-3-3-4 2z',
  flame: 'M12 2c1 3.5-1.5 5.5-1.5 8.2 0 1.4 1 2.5 2.3 2.5 1.5 0 2.4-1.2 2.2-3 2.3 1.7 3.5 4.3 3.5 6.8C18.5 20 15.6 22 12 22s-6.5-2.3-6.5-5.9c0-4.7 4.3-7 6.5-14.1z',
  book: 'M3 5l8-2v16l-8 2zM21 5l-8-2v16l8 2z',
  crystal: 'M12 1l7 7-7 15L5 8z',
} as const;

const strokeGlyph = (d: string): BadgeGlyph => function StrokeGlyph({ size = 28 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={d} /></svg>;
};

const lucideGlyph = (Icon: LucideIcon): BadgeGlyph => function LucideGlyph({ size = 28 }) {
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" focusable="false" />;
};

const filledGlyph = (d: string): BadgeGlyph => function FilledGlyph({ size = 26 }) {
  return <svg className="ach-glyph-filled" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={d} /></svg>;
};

/** Classic medal icon per recorded badge: the board's icon where the board draws the same idea. */
export const classicBadgeGlyphs: Readonly<Record<string, BadgeGlyph>> = {
  'first-review': strokeGlyph(classicPaths.seed),
  'active-days-3': lucideGlyph(CalendarDays),
  'active-days-5': lucideGlyph(MoonStar),
  'reviewed-10': lucideGlyph(Sparkles),
  'day-xp-100': strokeGlyph(classicPaths.bolt),
  'streak-7': strokeGlyph(classicPaths.flame),
  'late-reviews-10': strokeGlyph(classicPaths.moon),
  'spelling-50': strokeGlyph(classicPaths.ear),
  'xp-500': strokeGlyph(classicPaths.hoard),
  'mastered-50': strokeGlyph(classicPaths.crown),
  'mastered-100': strokeGlyph(classicPaths.hundred),
  'web-wanderer': strokeGlyph(classicPaths.map),
};

/** Crystal medal icon per recorded badge, from the Crystal board's filled set. */
export const crystalBadgeGlyphs: Readonly<Record<string, BadgeGlyph>> = {
  'first-review': filledGlyph(crystalPaths.star),
  'active-days-3': filledGlyph(crystalPaths.star),
  'active-days-5': filledGlyph(crystalPaths.star),
  'reviewed-10': filledGlyph(crystalPaths.book),
  'day-xp-100': filledGlyph(crystalPaths.star),
  'streak-7': filledGlyph(crystalPaths.flame),
  'late-reviews-10': filledGlyph(crystalPaths.star),
  'spelling-50': filledGlyph(crystalPaths.book),
  'xp-500': filledGlyph(crystalPaths.crystal),
  'mastered-50': filledGlyph(crystalPaths.crystal),
  'mastered-100': filledGlyph(crystalPaths.crystal),
  'web-wanderer': filledGlyph(crystalPaths.trail),
};

export const glyphFromIcon = lucideGlyph;

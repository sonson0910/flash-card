import { lazy, Suspense, useRef } from 'react';
import { useNeedsOnboarding } from '../courses/CourseGate';

const OnboardingJourney = lazy(() => import('./OnboardingJourney').then(module => ({ default: module.OnboardingJourney })));

export interface OnboardingGateProps {
  readonly ownerId: string | null;
  /**
   * True whenever the overlay must stay hidden even though the course
   * profile document is absent: the owner's existing library data has not
   * resolved yet (no flash while unknown), or the current view is the
   * landing page. The caller derives this and `hasCards` from data it
   * already loaded, so checking them here costs no extra Firestore read.
   */
  readonly suppress: boolean;
  /**
   * Whether the owner's library currently holds any card. Once true for an
   * owner it stays latched for the session, so deleting the last card never
   * throws a legacy user into onboarding (and over the delete Undo).
   */
  readonly hasCards: boolean;
}

/**
 * Mounted once near the app root next to `CourseProvider`. Its own module
 * stays a thin lazy-mount wrapper: the journey's steps, forms and starter
 * card catalog only load once a signed-in owner with no course profile yet,
 * and no existing library, actually needs them.
 */
export function OnboardingGate({ ownerId, suppress, hasCards }: OnboardingGateProps) {
  const needsOnboarding = useNeedsOnboarding();
  const ownerWithCards = useRef<string | null>(null);
  if (hasCards) ownerWithCards.current = ownerId;
  if (!ownerId || suppress || ownerWithCards.current === ownerId || !needsOnboarding) return null;
  return <Suspense fallback={null}><OnboardingJourney ownerId={ownerId} /></Suspense>;
}

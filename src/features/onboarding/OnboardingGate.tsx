import { lazy, Suspense, useRef } from 'react';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import { useNeedsOnboarding } from '../courses/CourseGate';
import { hasOnboardingInProgress } from './onboardingModel';

const OnboardingJourney = lazy(() => Promise.all([
  import('./OnboardingJourney'), loadCatalog(getActiveUiLocale(), 'settings'),
]).then(([module]) => ({ default: module.OnboardingJourney })));

export interface OnboardingGateProps {
  readonly ownerId: string | null;
  /**
   * True when navigation or identity state requires the overlay to stay hidden.
   */
  readonly suppress: boolean;
  /** True once the current owner's library has resolved, including an empty library. */
  readonly libraryReady: boolean;
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
export function OnboardingGate({ ownerId, suppress, libraryReady, hasCards }: OnboardingGateProps) {
  const needsOnboarding = useNeedsOnboarding();
  const ownerState = useRef(new Map<string, 'legacy' | 'started'>());
  if (ownerId && !suppress && libraryReady && needsOnboarding && !ownerState.current.has(ownerId)) {
    ownerState.current.set(ownerId, hasCards && !hasOnboardingInProgress(ownerId) ? 'legacy' : 'started');
  }
  if (!ownerId || suppress || !needsOnboarding || ownerState.current.get(ownerId) !== 'started') return null;
  return <Suspense fallback={null}><OnboardingJourney key={ownerId} ownerId={ownerId} /></Suspense>;
}

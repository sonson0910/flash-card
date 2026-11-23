import { useSyncExternalStore } from 'react';

export interface LandingSignInState {
  readonly busy: boolean;
  readonly error: string | null;
}

const IDLE: LandingSignInState = { busy: false, error: null };
let current = IDLE;
const listeners = new Set<() => void>();

/** The app runtime is hidden on the landing page, so it publishes sign-in progress for the page to show. */
export const publishLandingSignInState = (next: LandingSignInState): void => {
  if (next.busy === current.busy && next.error === current.error) return;
  current = next;
  listeners.forEach(listener => listener());
};

export const getLandingSignInState = (): LandingSignInState => current;

export const subscribeLandingSignInState = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const useLandingSignInState = (): LandingSignInState => useSyncExternalStore(subscribeLandingSignInState, getLandingSignInState, () => IDLE);

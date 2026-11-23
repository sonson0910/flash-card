import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLandingSignInState, publishLandingSignInState, subscribeLandingSignInState } from './landingSignInState';

describe('landing sign-in state', () => {
  afterEach(() => publishLandingSignInState({ busy: false, error: null }));

  it('tells subscribers when the runtime reports progress or a failure', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLandingSignInState(listener);

    publishLandingSignInState({ busy: true, error: null });
    publishLandingSignInState({ busy: false, error: 'popup closed' });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(getLandingSignInState()).toEqual({ busy: false, error: 'popup closed' });
    unsubscribe();
    publishLandingSignInState({ busy: false, error: null });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify when nothing changed', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLandingSignInState(listener);
    publishLandingSignInState({ busy: false, error: null });
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccountProfileRecord,
  CompleteAccountProfileRequest,
} from '../../../functions/src/account-profile-contract';
import { app, db } from '../../lib/firebase';
import { createFirebaseAccountProfilePort, type AccountProfilePort, type AccountProfileState } from './accountProfilePort';

export type AccountProfileGateStatus = 'signed-out' | 'loading' | 'error' | AccountProfileState['status'];

export interface AccountProfileGate {
  readonly status: AccountProfileGateStatus;
  readonly profile: AccountProfileRecord | null;
  readonly restrictedAt: string | null;
  /** Sends the completed form to the server; resolves with the server's decision for this owner. */
  readonly submit: (request: Omit<CompleteAccountProfileRequest, 'ownerId'>) => Promise<AccountProfileState>;
  readonly retry: () => void;
}

export interface AccountProfileGateOptions {
  /**
   * True while Auth has lost the session but the app keeps the owner. The owner-only reads are denied
   * then, so the gate stops listening and starts again once the learner has signed in again.
   */
  readonly sessionLost?: boolean;
  readonly port?: AccountProfilePort | null;
}

/** How long the gate waits for a confirmed answer before it offers a retry instead of an endless loading panel. */
export const ACCOUNT_PROFILE_ANSWER_TIMEOUT_MS = 15_000;

type OwnedState =
  | { readonly ownerId: string; readonly kind: 'state'; readonly state: AccountProfileState }
  | { readonly ownerId: string; readonly kind: 'error' };

const isDecided = (owned: OwnedState): boolean => owned.kind === 'state' && owned.state.status !== 'required';

// Clients never delete the record or the marker, so once the server decided for this owner nothing the
// listener reports later may take the decision back: neither a late snapshot that still shows neither
// document (a metadata-only change racing the callable) nor a read error (Auth dropping the session
// denies the owner-only reads while the shell keeps the owner and offers to sign in again).
const keepDecided = (previous: OwnedState | null, next: OwnedState): OwnedState =>
  previous?.ownerId === next.ownerId && isDecided(previous) && !isDecided(next) ? previous : next;

let defaultPort: AccountProfilePort | null = null;
const firebasePort = (): AccountProfilePort | null => {
  if (!app || !db) return null;
  defaultPort ??= createFirebaseAccountProfilePort(app, db);
  return defaultPort;
};

/**
 * Follows the signed-in owner's account profile. The state is keyed by owner so a switch of account
 * never shows the previous owner's profile or restriction, even for one render, and it is forgotten
 * whenever the owner changes, sign-out included, so the next sign-in reads the server again.
 */
export function useAccountProfileGate(
  ownerId: string | null,
  { sessionLost = false, port = firebasePort() }: AccountProfileGateOptions = {},
): AccountProfileGate {
  const [owned, setOwned] = useState<OwnedState | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A new object for every owner change, so a request sent for an earlier sign-in of the same
  // account cannot publish into a later one.
  const scopeRef = useRef({ ownerId });
  if (scopeRef.current.ownerId !== ownerId) scopeRef.current = { ownerId };

  useEffect(() => () => setOwned(null), [ownerId]);

  useEffect(() => {
    if (!ownerId || sessionLost) return undefined;
    if (!port) {
      setOwned({ ownerId, kind: 'error' });
      return undefined;
    }
    const timer = setTimeout(() => {
      setOwned(previous => previous?.ownerId === ownerId ? previous : { ownerId, kind: 'error' });
    }, ACCOUNT_PROFILE_ANSWER_TIMEOUT_MS);
    const stop = port.subscribe(
      ownerId,
      state => {
        clearTimeout(timer);
        setOwned(previous => keepDecided(previous, { ownerId, kind: 'state', state }));
      },
      () => {
        clearTimeout(timer);
        setOwned(previous => keepDecided(previous, { ownerId, kind: 'error' }));
      },
    );
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [attempt, ownerId, port, sessionLost]);

  const submit = useCallback<AccountProfileGate['submit']>(async request => {
    const scope = scopeRef.current;
    const requestOwner = scope.ownerId;
    if (!port || !requestOwner) throw new Error('Sign in is required.');
    const response = await port.complete({ ...request, ownerId: requestOwner });
    const state: AccountProfileState = response.status === 'complete'
      ? { status: 'complete', profile: response.profile }
      : { status: 'restricted', restrictedAt: response.restrictedAt };
    if (scopeRef.current === scope) {
      setOwned(previous => keepDecided(previous, { ownerId: requestOwner, kind: 'state', state }));
    }
    return state;
  }, [port]);

  const retry = useCallback(() => {
    setOwned(null);
    setAttempt(value => value + 1);
  }, []);

  return useMemo<AccountProfileGate>(() => {
    const current = owned?.ownerId === ownerId ? owned : null;
    const base = { submit, retry };
    if (!ownerId) return { ...base, status: 'signed-out', profile: null, restrictedAt: null };
    if (!current) return { ...base, status: 'loading', profile: null, restrictedAt: null };
    if (current.kind === 'error') return { ...base, status: 'error', profile: null, restrictedAt: null };
    const { state } = current;
    if (state.status === 'complete') return { ...base, status: 'complete', profile: state.profile, restrictedAt: null };
    if (state.status === 'restricted') return { ...base, status: 'restricted', profile: null, restrictedAt: state.restrictedAt };
    return { ...base, status: 'required', profile: null, restrictedAt: null };
  }, [owned, ownerId, retry, submit]);
}

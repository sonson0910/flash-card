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

type OwnedState =
  | { readonly ownerId: string; readonly kind: 'state'; readonly state: AccountProfileState }
  | { readonly ownerId: string; readonly kind: 'error' };

// Clients never delete the record or the marker, so once the server decided, a late snapshot that still
// shows neither document (for example a metadata-only change racing the callable) must not reopen the form.
const keepDecided = (previous: OwnedState | null, next: OwnedState): OwnedState =>
  previous?.ownerId === next.ownerId && previous.kind === 'state' && previous.state.status !== 'required'
    && next.kind === 'state' && next.state.status === 'required'
    ? previous
    : next;

let defaultPort: AccountProfilePort | null = null;
const firebasePort = (): AccountProfilePort | null => {
  if (!app || !db) return null;
  defaultPort ??= createFirebaseAccountProfilePort(app, db);
  return defaultPort;
};

/**
 * Follows the signed-in owner's account profile. The state is keyed by owner so a switch of account
 * never shows the previous owner's profile or restriction, even for one render.
 */
export function useAccountProfileGate(
  ownerId: string | null,
  port: AccountProfilePort | null = firebasePort(),
): AccountProfileGate {
  const [owned, setOwned] = useState<OwnedState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;

  useEffect(() => {
    if (!ownerId) return undefined;
    if (!port) {
      setOwned({ ownerId, kind: 'error' });
      return undefined;
    }
    return port.subscribe(
      ownerId,
      state => setOwned(previous => keepDecided(previous, { ownerId, kind: 'state', state })),
      () => setOwned({ ownerId, kind: 'error' }),
    );
  }, [attempt, ownerId, port]);

  const submit = useCallback<AccountProfileGate['submit']>(async request => {
    const requestOwner = ownerRef.current;
    if (!port || !requestOwner) throw new Error('Sign in is required.');
    const response = await port.complete({ ...request, ownerId: requestOwner });
    const state: AccountProfileState = response.status === 'complete'
      ? { status: 'complete', profile: response.profile }
      : { status: 'restricted', restrictedAt: response.restrictedAt };
    if (ownerRef.current === requestOwner) {
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

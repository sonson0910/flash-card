import type { FirebaseApp } from 'firebase/app';
import { doc, onSnapshot, type DocumentSnapshot, type Firestore } from 'firebase/firestore';
import { getSonFlashFunctions } from '../../lib/firebase';
import {
  ACCOUNT_PROFILE_DOCUMENT_ID,
  AGE_RESTRICTION_DOCUMENT_ID,
  parseAccountProfileRecord,
  parseAgeRestrictionMarker,
  type AccountProfileRecord,
  type CompleteAccountProfileRequest,
  type CompleteAccountProfileResponse,
} from '../../../functions/src/account-profile-contract';

export type AccountProfileState =
  | { readonly status: 'required' }
  | { readonly status: 'restricted'; readonly restrictedAt: string }
  | { readonly status: 'complete'; readonly profile: AccountProfileRecord };

export type AccountProfileErrorCode = 'consent-outdated' | 'invalid' | 'rate-limited' | 'read-failed' | 'save-failed';

export class AccountProfileError extends Error {
  constructor(readonly code: AccountProfileErrorCode, options?: { cause?: unknown }) {
    super(`Account profile ${code}.`, options);
    this.name = 'AccountProfileError';
  }
}

export interface AccountProfilePort {
  /** Reports the server-owned profile state for one owner; never reports `required` from cache alone. */
  subscribe(
    ownerId: string,
    onState: (state: AccountProfileState) => void,
    onError: (error: AccountProfileError) => void,
  ): () => void;
  complete(request: CompleteAccountProfileRequest): Promise<CompleteAccountProfileResponse>;
}

type DocumentRead = { readonly exists: boolean; readonly confirmed: boolean; readonly data: unknown };

const read = (snapshot: DocumentSnapshot): DocumentRead => ({
  exists: snapshot.exists(),
  confirmed: !snapshot.metadata.fromCache,
  data: snapshot.exists() ? snapshot.data() : undefined,
});

/**
 * Derives the gate state from the two server-written documents. A marker wins over a record, as on the
 * server. Absence only counts once the server confirmed it, so a cold cache never shows the profile step
 * to an account that already completed it, while a cached record keeps the app usable offline.
 */
export const accountProfileStateFrom = (
  marker: DocumentRead | null,
  record: DocumentRead | null,
): AccountProfileState | null => {
  if (marker?.exists) return { status: 'restricted', restrictedAt: parseAgeRestrictionMarker(marker.data).restrictedAt };
  if (record?.exists) return { status: 'complete', profile: parseAccountProfileRecord(record.data) };
  if (marker?.confirmed && record?.confirmed) return { status: 'required' };
  return null;
};

const callableCode = (error: unknown): string => {
  if (!error || typeof error !== 'object') return '';
  const details = (error as { details?: unknown }).details;
  if (details && typeof details === 'object' && typeof (details as { reason?: unknown }).reason === 'string') {
    return (details as { reason: string }).reason;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.replace(/^functions\//, '') : '';
};

export const accountProfileErrorFrom = (error: unknown): AccountProfileError => {
  if (error instanceof AccountProfileError) return error;
  const code = callableCode(error);
  if (code === 'consent-outdated') return new AccountProfileError('consent-outdated', { cause: error });
  if (code === 'invalid-argument') return new AccountProfileError('invalid', { cause: error });
  if (code === 'resource-exhausted') return new AccountProfileError('rate-limited', { cause: error });
  return new AccountProfileError('save-failed', { cause: error });
};

export const createFirebaseAccountProfilePort = (app: FirebaseApp, database: Firestore): AccountProfilePort => ({
  subscribe(ownerId, onState, onError) {
    let marker: DocumentRead | null = null;
    let record: DocumentRead | null = null;
    let stopped = false;
    const publish = () => {
      if (stopped) return;
      try {
        const state = accountProfileStateFrom(marker, record);
        if (state) onState(state);
      } catch (error) {
        onError(new AccountProfileError('read-failed', { cause: error }));
      }
    };
    const fail = (error: unknown) => {
      if (!stopped) onError(new AccountProfileError('read-failed', { cause: error }));
    };
    const profile = (id: string) => doc(database, 'users', ownerId, 'profile', id);
    const stopMarker = onSnapshot(profile(AGE_RESTRICTION_DOCUMENT_ID), { includeMetadataChanges: true }, snapshot => {
      marker = read(snapshot);
      publish();
    }, fail);
    const stopRecord = onSnapshot(profile(ACCOUNT_PROFILE_DOCUMENT_ID), { includeMetadataChanges: true }, snapshot => {
      record = read(snapshot);
      publish();
    }, fail);
    return () => {
      stopped = true;
      stopMarker();
      stopRecord();
    };
  },
  async complete(request) {
    try {
      const { httpsCallable } = await import('firebase/functions');
      const callable = httpsCallable<CompleteAccountProfileRequest, CompleteAccountProfileResponse>(
        await getSonFlashFunctions(app), 'completeAccountProfile',
      );
      const response = (await callable(request)).data;
      return response.status === 'restricted'
        ? { status: 'restricted', restrictedAt: parseAgeRestrictionMarker({ restrictedAt: response.restrictedAt }).restrictedAt }
        : { status: 'complete', profile: parseAccountProfileRecord(response.profile) };
    } catch (error) {
      throw accountProfileErrorFrom(error);
    }
  },
});

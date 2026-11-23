import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import {
  ACCOUNT_PROFILE_DOCUMENT_ID,
  AGE_RESTRICTION_DOCUMENT_ID,
  createAccountProfileRecord,
  evaluateBirthYear,
  isCurrentConsent,
  parseAccountProfileRecord,
  parseAgeRestrictionMarker,
  type CompleteAccountProfileRequest,
  type CompleteAccountProfileResponse,
} from './account-profile-contract.js';
import { stopReminderDeliveryForOwner } from './reminderSettingsPersistence.js';

export const ACCOUNT_PROFILE_PATH = `users/{uid}/profile/${ACCOUNT_PROFILE_DOCUMENT_ID}`;
export const AGE_RESTRICTION_PATH = `users/{uid}/profile/${AGE_RESTRICTION_DOCUMENT_ID}`;

export class AccountProfileOwnerMismatchError extends Error {
  constructor() {
    super('Account profile request owner does not match the authenticated owner.');
    this.name = 'AccountProfileOwnerMismatchError';
  }
}

export class AccountProfileConsentOutdatedError extends Error {
  constructor() {
    super('The accepted terms or privacy policy version is not current. Reload and review them again.');
    this.name = 'AccountProfileConsentOutdatedError';
  }
}

export class AccountProfileStoredDataError extends Error {
  constructor(readonly cause: unknown) {
    super('The stored account profile is invalid.');
    this.name = 'AccountProfileStoredDataError';
  }
}

const storedOrThrow = <T>(parse: (value: unknown) => T, value: DocumentData | undefined): T => {
  try {
    return parse(value);
  } catch (error) {
    throw new AccountProfileStoredDataError(error);
  }
};

/**
 * Completes the account profile once. An existing restriction marker wins over everything; an existing
 * record is returned unchanged; otherwise the outcome of the age rule writes either the record or the
 * marker (which holds only the time, never the birth year).
 */
export const completeAccountProfile = async (
  database: Firestore,
  authenticatedOwnerId: string,
  request: CompleteAccountProfileRequest,
  now: () => Date = () => new Date(),
): Promise<CompleteAccountProfileResponse> => {
  if (request.ownerId !== authenticatedOwnerId) throw new AccountProfileOwnerMismatchError();
  if (!isCurrentConsent(request.consent)) throw new AccountProfileConsentOutdatedError();
  // Every request is checked against the rule, even when stored state decides the answer below.
  const at = now();
  const timestamp = at.toISOString();
  const outcome = evaluateBirthYear(request.birthYear, at);
  const profile = database.collection('users').doc(authenticatedOwnerId).collection('profile');
  const recordReference = profile.doc(ACCOUNT_PROFILE_DOCUMENT_ID);
  const markerReference = profile.doc(AGE_RESTRICTION_DOCUMENT_ID);
  return database.runTransaction(async (transaction: Transaction): Promise<CompleteAccountProfileResponse> => {
    const [marker, record] = await Promise.all([transaction.get(markerReference), transaction.get(recordReference)]);
    if (marker.exists) {
      return { status: 'restricted', restrictedAt: storedOrThrow(parseAgeRestrictionMarker, marker.data()).restrictedAt };
    }
    if (record.exists) {
      return { status: 'complete', profile: storedOrThrow(parseAccountProfileRecord, record.data()) };
    }
    if (outcome === 'restricted') {
      // A restricted account gets no outreach, and it cannot reach the settings that would turn it off.
      await stopReminderDeliveryForOwner(transaction, database, authenticatedOwnerId, at);
      transaction.create(markerReference, { restrictedAt: timestamp });
      return { status: 'restricted', restrictedAt: timestamp };
    }
    const created = createAccountProfileRecord(request, timestamp);
    transaction.create(recordReference, created as unknown as DocumentData);
    return { status: 'complete', profile: created };
  });
};

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';

/**
 * Whether the server recorded that this account's cards came from the onboarding starter batch.
 * `createStarterCards` stamps `onboardingStartedAt` on the card usage document in the same
 * transaction that writes the cards, so a browser that never saw the journey can tell those
 * cards from an existing learner's library. A missing document or field means "no record".
 */
export async function readOnboardingStarted(ownerId: string): Promise<boolean> {
  if (!db) return false;
  const snapshot = await getDoc(doc(db, 'users', ownerId, 'profile', 'resource_usage'));
  return snapshot.exists() && snapshot.data()?.onboardingStartedAt != null;
}

import { countCardsDueTomorrow } from '../../lib/cardRepository';
import { auth, db } from '../../lib/firebase';

export async function loadTomorrowDueCount(targetLanguage?: string): Promise<number> {
  const ownerId = auth?.currentUser?.uid;
  if (!ownerId || !db) throw new Error('Recap count is unavailable.');
  const count = await countCardsDueTomorrow(db, ownerId, targetLanguage);
  if (auth?.currentUser?.uid !== ownerId) throw new Error('Recap owner changed.');
  return count;
}

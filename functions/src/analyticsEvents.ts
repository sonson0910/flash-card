import { createHmac } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

export const purchaseIntentOfferId = 'pro-vn-30d-v1';

export function analyticsPseudonym(uid: string, key: string): string {
  if (!uid || key.length < 32) throw new Error('Analytics pseudonym key is unavailable.');
  return createHmac('sha256', key).update(uid).digest('hex').slice(0, 32);
}

export async function writePurchaseIntent(database: Firestore, uid: string, key: string,
  trigger: 'quota' | 'menu', displayPriceVnd: number | null, now = new Date()): Promise<void> {
  await database.collection('analytics_events').add({
    name: 'purchase_intent', pid: analyticsPseudonym(uid, key),
    at: now, expiresAt: new Date(now.getTime() + 180 * 86_400_000),
    props: { trigger, offerId: purchaseIntentOfferId, displayPriceVnd },
  });
}

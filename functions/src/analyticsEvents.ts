import { createHmac } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { dayKey } from './aiCostLedger.js';

export const purchaseIntentOfferId = 'pro-vn-30d-v1';
const HEX_REF = /^[a-f0-9]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_VERSION = /^\d+\.\d+\.\d+$/;
const enumValue = (...values: string[]) => (value: unknown): boolean => typeof value === 'string' && values.includes(value);
const integer = (maximum: number) => (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
const schemas = {
  capture_completed: { origin: enumValue('ai', 'manual'), cardRef: (value: unknown) => typeof value === 'string' && HEX_REF.test(value) },
  ai_card_completed: { opRef: (value: unknown) => typeof value === 'string' && HEX_REF.test(value), tier: enumValue('free', 'pro') },
  review_completed: {
    rating: enumValue('again', 'hard', 'good', 'easy'), cardAgeDays: integer(36_500),
    xpAwarded: integer(1_000), cardRef: (value: unknown) => typeof value === 'string' && HEX_REF.test(value),
  },
  quota_exhausted: { kind: enumValue('card', 'daily-allowance', 'account-spend'), tier: enumValue('free', 'pro') },
  pro_granted: { source: enumValue('operator') },
  pro_revoked: { source: enumValue('operator') },
  pro_expired: { offerId: enumValue(purchaseIntentOfferId) },
  card_reported: { reason: enumValue('wrong-meaning', 'wrong-example', 'wrong-pronunciation', 'wrong-image', 'offensive', 'other') },
  purchase_intent: {
    trigger: enumValue('quota', 'menu'), offerId: enumValue(purchaseIntentOfferId),
    displayPriceVnd: (value: unknown) => value === null || (Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 1_000_000_000),
  },
  capture_started: { requestId: (value: unknown) => typeof value === 'string' && UUID.test(value), surface: enumValue('extension', 'app'), appVersion: (value: unknown) => typeof value === 'string' && APP_VERSION.test(value) },
  capture_failed: {
    requestId: (value: unknown) => typeof value === 'string' && UUID.test(value), surface: enumValue('extension', 'app'),
    latencyMs: integer(600_000), errorCode: enumValue('auth', 'quota', 'allowance', 'spend', 'network', 'timeout', 'provider', 'save', 'unknown'),
    appVersion: (value: unknown) => typeof value === 'string' && APP_VERSION.test(value),
  },
  paywall_viewed: { trigger: enumValue('quota', 'menu'), offerId: enumValue(purchaseIntentOfferId) },
} as const;

export type AnalyticsEventName = keyof typeof schemas;
export type AnalyticsProps = Record<string, unknown>;
export type ClientEventName = 'capture_started' | 'capture_failed' | 'paywall_viewed';
export interface ClientEvent { name: ClientEventName; props: AnalyticsProps }

export function validateAnalyticsProps(name: AnalyticsEventName, value: unknown, dropUnknown = false): AnalyticsProps {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid analytics props.');
  const props = value as AnalyticsProps;
  const schema = schemas[name] as Record<string, (candidate: unknown) => boolean>;
  const clean: AnalyticsProps = {};
  for (const [key, valid] of Object.entries(schema)) {
    if (!valid(props[key])) throw new Error(`Invalid analytics property: ${key}.`);
    clean[key] = props[key];
  }
  if (!dropUnknown && Object.keys(props).some(key => !Object.hasOwn(schema, key))) {
    throw new Error('Unknown analytics property.');
  }
  return clean;
}

export function parseClientEvents(value: unknown): ClientEvent[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error('Client event batch must contain 1–20 events.');
  return value.map(event => {
    if (!event || typeof event !== 'object' || Array.isArray(event)
      || Object.keys(event).some(key => key !== 'name' && key !== 'props')) throw new Error('Invalid client event.');
    const name = (event as { name?: unknown }).name;
    if (name !== 'capture_started' && name !== 'capture_failed' && name !== 'paywall_viewed') {
      throw new Error('Unsupported client event.');
    }
    return { name, props: validateAnalyticsProps(name, (event as { props?: unknown }).props, true) };
  });
}

const hmac = (value: string, key: string): string => {
  if (!value || key.length < 32) throw new Error('Analytics pseudonym key is unavailable.');
  return createHmac('sha256', key).update(value).digest('hex').slice(0, 32);
};
export const analyticsPseudonym = (uid: string, key: string): string => hmac(uid, key);
export const analyticsCardRef = (uid: string, cardId: string, key: string): string => hmac(JSON.stringify([uid, cardId]), key);
export const analyticsOpRef = (operationId: string, key: string): string => hmac(operationId, key);

export async function writeAnalyticsEvent(database: Firestore, uid: string, key: string,
  name: AnalyticsEventName, props: AnalyticsProps, now = new Date()): Promise<void> {
  await database.collection('analytics_events').add({
    name, pid: analyticsPseudonym(uid, key), ts: now, day: dayKey(now, 'Asia/Ho_Chi_Minh'),
    props: validateAnalyticsProps(name, props), expiresAt: new Date(now.getTime() + 180 * 86_400_000),
  });
}

export async function emitAnalyticsBestEffort(database: Firestore, uid: string, key: string,
  enabled: boolean, name: AnalyticsEventName, props: AnalyticsProps, now = new Date()): Promise<void> {
  if (!enabled) return;
  try { await writeAnalyticsEvent(database, uid, key, name, props, now); }
  catch (error) {
    console.error('analytics-event-failed', { name, errorName: error instanceof Error ? error.name : 'UnknownError' });
  }
}

export async function writePurchaseIntent(database: Firestore, uid: string, key: string,
  trigger: 'quota' | 'menu', displayPriceVnd: number | null, now = new Date()): Promise<void> {
  await writeAnalyticsEvent(database, uid, key, 'purchase_intent',
    { trigger, offerId: purchaseIntentOfferId, displayPriceVnd }, now);
}

export class ClientEventLimitError extends Error {}

export async function writeClientEvents(database: Firestore, uid: string, key: string,
  events: ClientEvent[], now = new Date()): Promise<void> {
  const owner = database.collection('users').doc(uid);
  const rateRef = owner.collection('analytics_rate').doc('current');
  const pid = analyticsPseudonym(uid, key);
  const day = dayKey(now, 'Asia/Ho_Chi_Minh');
  const eventDocs = events.map(event => ({
    ref: database.collection('analytics_events').doc(),
    data: {
      name: event.name, pid, ts: now, day,
      props: validateAnalyticsProps(event.name, event.props),
      expiresAt: new Date(now.getTime() + 180 * 86_400_000),
    },
  }));
  await database.runTransaction(async transaction => {
    const current = (await transaction.get(rateRef)).data();
    const startedAt = Number(current?.windowStartedAtMs);
    const fresh = Number.isSafeInteger(startedAt) && startedAt <= now.getTime()
      && now.getTime() - startedAt < 3_600_000;
    const used = fresh && Number.isSafeInteger(current?.events) && Number(current?.events) >= 0
      ? Number(current?.events) : 0;
    if (used + events.length > 300) throw new ClientEventLimitError('Client event limit reached.');
    transaction.set(rateRef, { windowStartedAtMs: fresh ? startedAt : now.getTime(), events: used + events.length });
    for (const event of eventDocs) transaction.create(event.ref, event.data);
  });
}

import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  analyticsCardRef, analyticsOpRef, analyticsPseudonym, ClientEventLimitError,
  parseClientEvents, validateAnalyticsProps, writeAnalyticsEvent, writeClientEvents,
  type AnalyticsEventName,
} from '../src/analyticsEvents.js';

const key = 'x'.repeat(32);
const ref = 'a'.repeat(32);
const requestId = '123e4567-e89b-42d3-a456-426614174000';
const fixtures: Record<AnalyticsEventName, Record<string, unknown>> = {
  capture_completed: { origin: 'ai', cardRef: ref },
  ai_card_completed: { opRef: ref, tier: 'free' },
  review_completed: { rating: 'good', cardAgeDays: 2, xpAwarded: 0, cardRef: ref },
  quota_exhausted: { kind: 'card', tier: 'free' },
  pro_granted: { source: 'operator' }, pro_revoked: { source: 'operator' },
  pro_expired: { offerId: 'pro-vn-30d-v1' },
  card_reported: { reason: 'wrong-meaning' },
  purchase_intent: { trigger: 'quota', offerId: 'pro-vn-30d-v1', displayPriceVnd: null },
  capture_started: { requestId, surface: 'app', appVersion: '1.0.0' },
  capture_failed: { requestId, surface: 'app', latencyMs: 500, errorCode: 'network', appVersion: '1.0.0' },
  paywall_viewed: { trigger: 'menu', offerId: 'pro-vn-30d-v1' },
};

describe('private analytics event schemas', () => {
  it('rejects private sentences, URLs and raw card ids in every property', () => {
    for (const [name, props] of Object.entries(fixtures) as Array<[AnalyticsEventName, Record<string, unknown>]>) {
      expect(validateAnalyticsProps(name, props)).toEqual(props);
      for (const property of Object.keys(props)) {
        for (const privateValue of ['The whole private sentence.', 'https://example.test/page', 'word-secret']) {
          expect(() => validateAnalyticsProps(name, { ...props, [property]: privateValue })).toThrow();
        }
      }
      expect(() => validateAnalyticsProps(name, { ...props, privateText: 'secret' })).toThrow();
    }
  });

  it('uses per-owner card refs and non-reversible operation refs', () => {
    expect(analyticsCardRef('owner-a', 'word-lead', key)).not.toBe(analyticsCardRef('owner-b', 'word-lead', key));
    expect(analyticsOpRef(requestId, key)).toMatch(/^[a-f0-9]{32}$/);
    expect(analyticsOpRef(requestId, key)).not.toContain(requestId);
  });

  it('accepts only client events, drops unknown props and rejects invalid known values', () => {
    expect(parseClientEvents([{ name: 'capture_started', props: { ...fixtures.capture_started, ignored: 'private' } }]))
      .toEqual([{ name: 'capture_started', props: fixtures.capture_started }]);
    for (const value of [[{ name: 'purchase_intent', props: fixtures.purchase_intent }],
      [{ name: 'capture_failed', props: { ...fixtures.capture_failed, errorCode: 'private sentence' } }],
      Array.from({ length: 21 }, () => ({ name: 'paywall_viewed', props: fixtures.paywall_viewed }))]) {
      expect(() => parseClientEvents(value)).toThrow();
    }
  });

  it('writes only validated props, a pseudonym, local day and 180-day expiry', async () => {
    const add = vi.fn(async () => undefined);
    const database = { collection: () => ({ add }) } as unknown as Firestore;
    const now = new Date('2026-09-23T17:00:00.000Z');
    await writeAnalyticsEvent(database, 'owner-a', key, 'capture_completed',
      { origin: 'ai', cardRef: analyticsCardRef('owner-a', 'word-lead', key) }, now);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({
      name: 'capture_completed', pid: analyticsPseudonym('owner-a', key),
      day: '2026-09-24', ts: now, expiresAt: new Date(now.getTime() + 180 * 86_400_000),
    }));
    expect(JSON.stringify(add.mock.calls[0])).not.toContain('owner-a');
    expect(JSON.stringify(add.mock.calls[0])).not.toContain('word-lead');
  });

  it('rejects a batch beyond 300 events per hour atomically', async () => {
    const set = vi.fn();
    const create = vi.fn();
    const database = {
      collection: (name: string) => name === 'users'
        ? { doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }
        : { doc: () => ({}) },
      runTransaction: (callback: (transaction: unknown) => Promise<unknown>) => callback({
        get: async () => ({ data: () => ({ windowStartedAtMs: 1_790_203_200_000, events: 300 }) }),
        set, create,
      }),
    } as unknown as Firestore;
    await expect(writeClientEvents(database, 'owner-a', key,
      [{ name: 'paywall_viewed', props: fixtures.paywall_viewed }],
      new Date(1_790_203_200_001))).rejects.toBeInstanceOf(ClientEventLimitError);
    expect(set).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

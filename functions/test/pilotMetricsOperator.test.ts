import { describe, expect, it } from 'vitest';
import { analyticsCardRef, analyticsOpRef, analyticsPseudonym } from '../src/analyticsEvents.js';
import { summarizePilotMetrics } from '../src/pilotMetricsOperator.js';

const key = 'metrics-secret'.padEnd(32, 'x');
const start = new Date('2026-09-01T00:00:00.000Z');
const at = (days: number, hours = 0) => new Date(start.getTime() + days * 86_400_000 + hours * 3_600_000);
const uid = 'learner';
const founder = 'founder';
const cardRef = (owner: string, id: string) => analyticsCardRef(owner, id, key);

describe('pilot metrics', () => {
  it('computes cohort numerators, exclusions, D7 and pre-event card/review backfill', () => {
    const cards = Array.from({ length: 5 }, (_, index) => ({
      uid, id: `word-${index}`, origin: 'ai', createdAt: at(0, index),
      reviewTimes: index === 0 ? [at(0, 6), at(7)] : [],
    }));
    cards.push({ uid: founder, id: 'friend-card', origin: 'ai', createdAt: at(0), reviewTimes: [] });
    const report = summarizePilotMetrics({
      learners: [{ uid, signupAt: at(0), tier: 'free' }, { uid: founder, signupAt: at(0), tier: 'pro' }],
      events: [
        { pid: analyticsPseudonym(uid, key), name: 'purchase_intent', ts: at(2), props: { displayPriceVnd: 85_000 } },
        { pid: analyticsPseudonym(uid, key), name: 'card_reported', ts: at(2), props: {} },
        { pid: analyticsPseudonym(uid, key), name: 'ai_card_completed', ts: at(0, 1),
          props: { opRef: analyticsOpRef('op-1', key), tier: 'free' } },
        { pid: analyticsPseudonym(founder, key), name: 'purchase_intent', ts: at(2), props: { displayPriceVnd: null } },
      ],
      ledger: [{ uid, operationId: 'op-1', action: 'word', outcome: 'ok',
        estimatedUsdMicros: 700, latencyMs: 1200, createdAt: at(0, 1) }],
      cards, excludedUids: [founder], from: at(0), to: at(1), now: at(10), key,
    });
    expect(report.raw.signups).toBe(2);
    expect(report.icp.signups).toBe(1);
    expect(report.excludedSignups).toBe(1);
    expect(report.icp.activation24h).toMatchObject({ numerator: 1, denominator: 1 });
    expect(report.icp.d7ReviewRetention).toMatchObject({ numerator: 1, denominator: 1 });
    expect(report.icp.captureToReview7d).toMatchObject({ numerator: 1, denominator: 5 });
    expect(report.icp.pricedPurchaseIntentLearners).toBe(1);
    expect(report.raw.unpricedPurchaseIntentLearners).toBe(1);
    expect(report.icp.reportedCardsPer100.per100).toBe(20);
    expect(report.icp.aiCardCostUsdMicros).toMatchObject({ count: 1, mean: 700, p95: 700, joinedEventCount: 1 });
    expect(report.icp.generationLatencyP95Ms).toBe(1200);
    expect(report.icp.costPerMau.free.costPerActiveUsdMicros).toBe(700);
    expect(report.icp.topAccounts[0].pid).not.toBe(uid);
    expect(JSON.stringify(report)).not.toContain('friend-card');
    expect(cardRef(uid, 'word-0')).not.toBe(cardRef(founder, 'word-0'));
  });

  it('leaves D7 and cost denominators empty for a fresh cohort', () => {
    const report = summarizePilotMetrics({ learners: [{ uid, signupAt: at(0), tier: 'free' }],
      events: [], ledger: [], cards: [], excludedUids: [], from: at(0), to: at(1), now: at(2), key });
    expect(report.icp.d7ReviewRetention).toEqual({ numerator: 0, denominator: 0, rate: null });
    expect(report.icp.aiCardCostUsdMicros.p95).toBeNull();
  });
});

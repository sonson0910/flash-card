import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { analyticsCardRef, analyticsOpRef, analyticsPseudonym } from './analyticsEvents.js';
import { dayKey } from './aiCostLedger.js';
import { validatePilotTarget } from './pilotTarget.js';

type Event = { pid: string; name: string; ts: Date; props: Record<string, unknown> };
type Ledger = { uid: string; operationId: string | null; action: string; outcome: string;
  estimatedUsdMicros: number; latencyMs: number; createdAt: Date };
type Card = { uid: string; id: string; origin: string; createdAt: Date; reviewTimes: Date[] };
type Learner = { uid: string; signupAt: Date; tier: 'free' | 'pro' };
export type PilotMetricsInput = { learners: Learner[]; events: Event[]; ledger: Ledger[];
  cards: Card[]; excludedUids: string[]; from: Date; to: Date; now: Date; key: string };

const DAY = 86_400_000;
const within = (date: Date, start: Date, end: Date): boolean =>
  date.getTime() >= start.getTime() && date.getTime() < end.getTime();
const count = (numerator: number, denominator: number) => ({ numerator, denominator,
  rate: denominator ? numerator / denominator : null });
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const p95 = (values: number[]) => values.length
  ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : null;
const millis = (value: unknown): number => value instanceof Date ? value.getTime()
  : value && typeof value === 'object' && 'toDate' in value
    && typeof (value as { toDate?: unknown }).toDate === 'function'
    ? (value as { toDate(): Date }).toDate().getTime()
    : typeof value === 'string' ? Date.parse(value) : NaN;
const date = (value: unknown): Date | null => {
  const time = millis(value);
  return Number.isFinite(time) ? new Date(time) : null;
};
const number = (value: unknown): number => Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0;

export function summarizePilotMetrics(input: PilotMetricsInput) {
  const build = (selected: Learner[]) => {
    const selectedUids = new Set(selected.map(user => user.uid));
    const byPid = new Map(selected.map(user => [analyticsPseudonym(user.uid, input.key), user]));
    const events = input.events.filter(event => byPid.has(event.pid) && within(event.ts, input.from, input.now));
    const ledger = input.ledger.filter(row => selectedUids.has(row.uid) && within(row.createdAt, input.from, input.now));
    const cards = input.cards.filter(card => selectedUids.has(card.uid) && within(card.createdAt, input.from, input.now));
    const reviews = new Map<string, Date[]>();
    for (const card of input.cards) {
      if (!selectedUids.has(card.uid)) continue;
      const ref = analyticsCardRef(card.uid, card.id, input.key);
      reviews.set(ref, card.reviewTimes.filter(time => within(time, input.from, input.now)));
    }
    for (const event of events.filter(item => item.name === 'review_completed')) {
      const ref = event.props.cardRef;
      if (typeof ref !== 'string') continue;
      const times = reviews.get(ref) ?? [];
      times.push(event.ts);
      reviews.set(ref, times);
    }
    const aiCaptures = new Map<string, number>();
    const reviewByUser = new Map<string, Date[]>();
    for (const user of selected) {
      const pid = analyticsPseudonym(user.uid, input.key);
      const firstDayEnd = new Date(user.signupAt.getTime() + DAY);
      const cardCount = cards.filter(card => card.uid === user.uid && card.origin === 'ai'
        && within(card.createdAt, user.signupAt, firstDayEnd)).length;
      const eventCardCount = new Set(events.filter(event => event.pid === pid && event.name === 'capture_completed'
        && event.props.origin === 'ai' && within(event.ts, user.signupAt, firstDayEnd))
        .map(event => event.props.cardRef)).size;
      const aiEventCount = events.filter(event => event.pid === pid && event.name === 'ai_card_completed'
        && within(event.ts, user.signupAt, firstDayEnd)).length;
      aiCaptures.set(user.uid, Math.max(cardCount, eventCardCount, aiEventCount));
      const times = input.cards.filter(card => card.uid === user.uid).flatMap(card => card.reviewTimes);
      times.push(...events.filter(event => event.pid === pid && event.name === 'review_completed').map(event => event.ts));
      reviewByUser.set(user.uid, times);
    }
    const activation = selected.filter(user => (aiCaptures.get(user.uid) ?? 0) >= 5
      && (reviewByUser.get(user.uid) ?? []).some(time => within(time, user.signupAt,
        new Date(user.signupAt.getTime() + DAY)))).length;
    const d7Eligible = selected.filter(user => input.now.getTime() >= user.signupAt.getTime() + 9 * DAY);
    const d7Retained = d7Eligible.filter(user => (reviewByUser.get(user.uid) ?? []).some(time =>
      within(time, new Date(user.signupAt.getTime() + 6 * DAY),
        new Date(user.signupAt.getTime() + 9 * DAY)))).length;
    const agedCaptures = cards.filter(card => input.now.getTime() >= card.createdAt.getTime() + 7 * DAY);
    const reviewedCaptures = agedCaptures.filter(card => (reviews.get(analyticsCardRef(card.uid, card.id, input.key)) ?? [])
      .some(time => time.getTime() >= card.createdAt.getTime() && time.getTime() < card.createdAt.getTime() + 7 * DAY)).length;
    const purchaseIntents = new Set(events.filter(event => event.name === 'purchase_intent'
      && Number.isSafeInteger(event.props.displayPriceVnd) && Number(event.props.displayPriceVnd) > 0)
      .map(event => event.pid)).size;
    const unpricedIntents = new Set(events.filter(event => event.name === 'purchase_intent'
      && event.props.displayPriceVnd === null).map(event => event.pid)).size;
    const reports = events.filter(event => event.name === 'card_reported').length;
    const wordCalls = ledger.filter(row => row.action === 'word');
    const failedCalls = wordCalls.filter(row => row.outcome !== 'ok').length;
    const clientFailures = new Set(events.filter(event => event.name === 'capture_failed')
      .map(event => `${event.pid}:${event.props.requestId}`)).size;
    const successes = wordCalls.filter(row => row.outcome === 'ok').length;
    const costsByTier = (tier: 'free' | 'pro') => {
      const people = selected.filter(user => user.tier === tier);
      const monthStart = new Date(input.now.getTime() - 30 * DAY);
      const recentEvents = events.filter(event => event.ts >= monthStart);
      const recentLedger = ledger.filter(row => row.createdAt >= monthStart);
      const active = people.filter(user => recentEvents.some(event => event.pid === analyticsPseudonym(user.uid, input.key))
        || recentLedger.some(row => row.uid === user.uid)).length;
      const cost = recentLedger.filter(row => people.some(user => user.uid === row.uid))
        .reduce((sum, row) => sum + row.estimatedUsdMicros, 0);
      return { activeAccounts: active, costUsdMicros: cost, costPerActiveUsdMicros: active ? cost / active : null };
    };
    const successCosts = wordCalls.filter(row => row.outcome === 'ok').map(row => row.estimatedUsdMicros);
    const joined = wordCalls.filter(row => row.outcome === 'ok' && row.operationId
      && events.some(event => event.name === 'ai_card_completed'
        && event.pid === analyticsPseudonym(row.uid, input.key)
        && event.props.opRef === analyticsOpRef(row.operationId!, input.key))).length;
    const dayCosts = new Map<string, number>();
    for (const row of ledger) {
      const day = dayKey(row.createdAt, 'Asia/Ho_Chi_Minh');
      dayCosts.set(day, (dayCosts.get(day) ?? 0) + row.estimatedUsdMicros);
    }
    const daily = [...dayCosts].map(([day, costUsdMicros]) => ({ day, costUsdMicros }));
    const topAccounts = [...new Set(ledger.map(row => row.uid))].map(uid => ({
      pid: analyticsPseudonym(uid, input.key),
      costUsdMicros: ledger.filter(row => row.uid === uid).reduce((sum, row) => sum + row.estimatedUsdMicros, 0),
    })).sort((a, b) => b.costUsdMicros - a.costUsdMicros).slice(0, 5);
    return {
      signups: selected.length,
      activation24h: count(activation, selected.length),
      d7ReviewRetention: count(d7Retained, d7Eligible.length),
      captureToReview7d: count(reviewedCaptures, agedCaptures.length),
      pricedPurchaseIntentLearners: purchaseIntents,
      unpricedPurchaseIntentLearners: unpricedIntents,
      reportedCardsPer100: { numerator: reports, denominator: cards.length,
        per100: cards.length ? reports * 100 / cards.length : null },
      captureFailure: count(Math.max(failedCalls, clientFailures), successes + Math.max(failedCalls, clientFailures)),
      generationLatencyP95Ms: p95(wordCalls.map(row => row.latencyMs)),
      aiCardCostUsdMicros: { count: successCosts.length, mean: mean(successCosts), p95: p95(successCosts), joinedEventCount: joined },
      costPerMau: { free: costsByTier('free'), pro: costsByTier('pro') },
      dailyCostUsdMicros: daily, topAccounts,
      sourceCounts: { events: events.length, ledgerRows: ledger.length, cards: cards.length },
    };
  };
  const cohort = input.learners.filter(user => within(user.signupAt, input.from, input.to));
  const excluded = new Set(input.excludedUids);
  return { window: { from: input.from.toISOString(), to: input.to.toISOString(), asOf: input.now.toISOString() },
    raw: build(cohort), icp: build(cohort.filter(user => !excluded.has(user.uid))),
    excludedSignups: cohort.filter(user => excluded.has(user.uid)).length,
    notes: ['Purchase intent is a priced button press; interview confirmation must be checked separately.',
      'MAU is activity in the trailing 30 days; tier uses current plan and historical changes are not reconstructed.',
      'Client capture failures can be lost when the extension worker closes; failure rate is an estimate.',
      'Review backfill uses retained receipts and card review history.'],
  };
}

export function validateMetricsRequest(environment: NodeJS.ProcessEnv) {
  const target = validatePilotTarget(environment);
  const from = date(environment.PILOT_METRICS_FROM);
  const to = date(environment.PILOT_METRICS_TO);
  const key = environment.ANALYTICS_PSEUDONYM_KEY ?? '';
  if (!from || !to || from >= to || to.getTime() - from.getTime() > 120 * DAY
    || key.length < 32) throw new Error('Provide a cohort window <=120 days and ANALYTICS_PSEUDONYM_KEY.');
  return { ...target, from, to, key };
}

if (require.main === module) {
  const input = validateMetricsRequest(process.env);
  const app = getApps()[0] ?? initializeApp({ projectId: input.projectId });
  const database = getFirestore(app, input.databaseId);
  const run = async () => {
    const now = new Date();
    const learners: Learner[] = [];
    let page: string | undefined;
    do {
      const batch = await getAuth(app).listUsers(1000, page);
      for (const user of batch.users) {
        const signupAt = date(user.metadata.creationTime);
        if (signupAt && within(signupAt, input.from, input.to)) {
          const plan = await database.collection('users').doc(user.uid).collection('profile').doc('plan').get();
          const expiry = date(plan.data()?.expiresAt);
          learners.push({ uid: user.uid, signupAt,
            tier: plan.data()?.tier === 'pro' && expiry && expiry > now ? 'pro' : 'free' });
        }
      }
      page = batch.pageToken;
    } while (page);
    const events = (await database.collection('analytics_events').where('ts', '>=', input.from)
      .where('ts', '<', now).get()).docs.flatMap(snapshot => {
      const row = snapshot.data(); const ts = date(row.ts);
      return ts && typeof row.pid === 'string' && typeof row.name === 'string'
        ? [{ pid: row.pid, name: row.name, ts, props: row.props ?? {} }] : [];
    });
    const ledger = (await database.collection('ai_cost_ledger').where('createdAt', '>=', input.from)
      .where('createdAt', '<', now).get()).docs.flatMap(snapshot => {
      const row = snapshot.data(); const createdAt = date(row.createdAt);
      return createdAt && typeof row.uid === 'string' ? [{ uid: row.uid,
        operationId: typeof row.operationId === 'string' ? row.operationId : null,
        action: row.action, outcome: row.outcome, estimatedUsdMicros: number(row.estimatedUsdMicros),
        latencyMs: number(row.latencyMs), createdAt }] : [];
    });
    const cards: Card[] = [];
    for (const user of learners) {
      const owner = database.collection('users').doc(user.uid);
      const [storedCards, receipts] = await Promise.all([
        owner.collection('cards').get(), owner.collection('review_receipts').get(),
      ]);
      const receiptTimes = new Map<string, Date[]>();
      for (const receipt of receipts.docs) {
        const row = receipt.data(); const time = date(row.createdAt);
        if (typeof row.cardId === 'string' && time) receiptTimes.set(row.cardId,
          [...(receiptTimes.get(row.cardId) ?? []), time]);
      }
      for (const card of storedCards.docs) {
        const row = card.data(); const createdAt = date(row.createdAt);
        if (!createdAt) continue;
        const history = Array.isArray(row.reviewHistory) ? row.reviewHistory : [];
        const historyTimes = history.flatMap((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return [];
          const value = entry as Record<string, unknown>;
          const time = date(value.reviewedAt ?? value.date ?? value.timestamp);
          return time ? [time] : [];
        });
        cards.push({ uid: user.uid, id: card.id, origin: row.origin,
          createdAt, reviewTimes: [...historyTimes, ...(receiptTimes.get(card.id) ?? [])] });
      }
    }
    const exclusions = await database.collection('_serviceConfig').doc('pilotExclusions').get();
    const excludedUids = exclusions.data()?.uids;
    if (excludedUids !== undefined && (!Array.isArray(excludedUids)
      || excludedUids.some((uid: unknown) => typeof uid !== 'string'))) {
      throw new Error('pilotExclusions.uids must be a UID array.');
    }
    return summarizePilotMetrics({ learners, events, ledger, cards,
      excludedUids: excludedUids ?? [], from: input.from, to: input.to, now, key: input.key });
  };
  run().then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch(error => { process.stderr.write(`Pilot metrics failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      process.exitCode = 1; });
}

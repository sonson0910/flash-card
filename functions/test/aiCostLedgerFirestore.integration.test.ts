import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMeteredGemini } from '../src/aiCostLedger.js';
import { readAiCostReport } from '../src/aiCostReportOperator.js';
import { PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('Firestore AI spend accounting', () => {
  let app: App;
  let database: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'ai-spend-integration');
    database = getFirestore(app, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
  });

  afterAll(async () => {
    await database.terminate();
    await deleteApp(app);
  });

  it('persists one measured word call and corrects both day counters', async () => {
    const uid = `ai-spend-${randomUUID()}`;
    const createdAt = new Date('2026-09-24T00:00:00.000Z');
    const result = await runMeteredGemini({
      database, uid, action: 'word', operationId: null,
      model: 'gemini-3.1-flash-lite', contents: 'bounded request envelope',
      config: { ...PILOT_CONFIG_DEFAULTS }, now: () => createdAt,
      generate: async () => ({ usageMetadata: {
        promptTokenCount: 400, candidatesTokenCount: 400, thoughtsTokenCount: 0,
        cachedContentTokenCount: 0, totalTokenCount: 800,
      } }),
      parse: () => 'ok',
    });
    expect(result).toBe('ok');
    const day = '2026-09-24';
    const global = await database.collection('_serviceBudgets').doc(`gemini-spend-${day}`).get();
    const account = await database.collection('users').doc(uid).collection('ai_daily').doc(day).get();
    const ledger = await database.collection('ai_cost_ledger').where('uid', '==', uid).get();
    expect(global.data()?.usdMicros).toBe(700);
    expect(account.data()?.usdMicros).toBe(700);
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0]?.data()).toMatchObject({ estimatedUsdMicros: 700, outcome: 'ok', day });
    const report = await readAiCostReport(database, day, day, 'x'.repeat(32));
    expect(report.days).toEqual([{
      day, calls: 1, spendUsdMicros: 700, wordMeanUsdMicros: 700,
      wordP50UsdMicros: 700, wordP95UsdMicros: 700, timeoutShare: 0,
    }]);
    expect(report.topAccounts[0]?.pid).toMatch(/^[a-f0-9]{32}$/);
  });
});

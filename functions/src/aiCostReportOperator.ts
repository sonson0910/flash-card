import { createHmac } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import runtimeTarget from './runtime-target.json';

const PROJECTS = new Set(['encoded-hangout-433912-h2', 'sonflash-staging-20260906']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateAiCostReportTarget(environment: NodeJS.ProcessEnv): {
  projectId: string; databaseId: string; from: string; to: string; pseudonymKey: string;
} {
  const projectId = environment.FIREBASE_PROJECT_ID?.trim() ?? '';
  const databaseId = environment.FIRESTORE_DATABASE_ID?.trim() ?? '';
  const from = environment.PILOT_REPORT_FROM?.trim() ?? '';
  const to = environment.PILOT_REPORT_TO?.trim() ?? '';
  const pseudonymKey = environment.ANALYTICS_PSEUDONYM_KEY ?? '';
  if (!PROJECTS.has(projectId) || databaseId !== runtimeTarget.firestoreDatabaseId) {
    throw new Error('Report target must be the explicit pilot staging or production project and named database.');
  }
  if (!DATE.test(from) || !DATE.test(to) || !Number.isFinite(Date.parse(from))
    || !Number.isFinite(Date.parse(to)) || from > to
    || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) {
    throw new Error('PILOT_REPORT_FROM and PILOT_REPORT_TO must be a valid date range of at most 366 days.');
  }
  if (pseudonymKey.length < 32) throw new Error('ANALYTICS_PSEUDONYM_KEY is required for private account references.');
  return { projectId, databaseId, from, to, pseudonymKey };
}

type LedgerRow = {
  uid?: unknown;
  day?: unknown;
  action?: unknown;
  outcome?: unknown;
  estimatedUsdMicros?: unknown;
};

const percentile = (sorted: number[], fraction: number): number | null => sorted.length
  ? sorted[Math.ceil(sorted.length * fraction) - 1] ?? null : null;

export function summarizeAiCosts(rows: LedgerRow[], key: string): {
  days: Array<{ day: string; calls: number; spendUsdMicros: number; wordMeanUsdMicros: number | null; wordP50UsdMicros: number | null; wordP95UsdMicros: number | null; timeoutShare: number }>;
  topAccounts: Array<{ pid: string; calls: number; spendUsdMicros: number }>;
} {
  const days = new Map<string, { calls: number; spendUsdMicros: number; wordCosts: number[]; timeouts: number }>();
  const accounts = new Map<string, { calls: number; spendUsdMicros: number }>();
  for (const row of rows) {
    if (typeof row.day !== 'string' || !DATE.test(row.day)
      || typeof row.uid !== 'string' || !row.uid
      || !Number.isSafeInteger(row.estimatedUsdMicros) || Number(row.estimatedUsdMicros) < 0) {
      throw new Error('Cost ledger contains an invalid row.');
    }
    const cost = Number(row.estimatedUsdMicros);
    const daily = days.get(row.day) ?? { calls: 0, spendUsdMicros: 0, wordCosts: [], timeouts: 0 };
    daily.calls += 1;
    daily.spendUsdMicros += cost;
    if (row.action === 'word') daily.wordCosts.push(cost);
    if (row.outcome === 'timeout') daily.timeouts += 1;
    days.set(row.day, daily);

    const pid = createHmac('sha256', key).update(row.uid).digest('hex').slice(0, 32);
    const account = accounts.get(pid) ?? { calls: 0, spendUsdMicros: 0 };
    account.calls += 1;
    account.spendUsdMicros += cost;
    accounts.set(pid, account);
  }
  return {
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, daily]) => {
      daily.wordCosts.sort((a, b) => a - b);
      return {
        day,
        calls: daily.calls,
        spendUsdMicros: daily.spendUsdMicros,
        wordMeanUsdMicros: daily.wordCosts.length
          ? Math.round(daily.wordCosts.reduce((sum, cost) => sum + cost, 0) / daily.wordCosts.length) : null,
        wordP50UsdMicros: percentile(daily.wordCosts, 0.5),
        wordP95UsdMicros: percentile(daily.wordCosts, 0.95),
        timeoutShare: daily.timeouts / daily.calls,
      };
    }),
    topAccounts: [...accounts].map(([pid, value]) => ({ pid, ...value }))
      .sort((a, b) => b.spendUsdMicros - a.spendUsdMicros).slice(0, 10),
  };
}

export async function readAiCostReport(database: Firestore, from: string, to: string, pseudonymKey: string) {
  const snapshot = await database.collection('ai_cost_ledger')
    .where('day', '>=', from).where('day', '<=', to).get();
  return summarizeAiCosts(snapshot.docs.map(document => document.data()), pseudonymKey);
}

if (require.main === module) {
  const target = validateAiCostReportTarget(process.env);
  const app = getApps()[0] ?? initializeApp({ projectId: target.projectId });
  const database = getFirestore(app, target.databaseId);
  readAiCostReport(database, target.from, target.to, target.pseudonymKey)
    .then(report => { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); })
    .catch(error => {
      process.stderr.write(`AI cost report failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`);
      process.exitCode = 1;
    });
}

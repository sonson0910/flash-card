import type { Firestore } from 'firebase-admin/firestore';

export interface PilotConfig {
  freeMonthlyAiCards: number;
  proMonthlyAiCards: number;
  quotaEnforced: boolean;
  freeDailyAiActions: number;
  proDailyAiActions: number;
  dailyGeminiSpendCapUsd: number;
  accountDailySpendShare: number;
  geminiInputUsdPerMillion: number;
  geminiOutputUsdPerMillion: number;
  proPriceVnd: number;
  displayPriceVnd: number | null;
  proDurationDays: number;
  pilotTimezone: 'Asia/Ho_Chi_Minh';
  reviewBaseXp: number;
  serverReviewXp: boolean;
  analyticsEnabled: boolean;
}

export const PILOT_CONFIG_DEFAULTS: Readonly<PilotConfig> = Object.freeze({
  freeMonthlyAiCards: 30,
  proMonthlyAiCards: 1_000,
  quotaEnforced: true,
  freeDailyAiActions: 20,
  proDailyAiActions: 200,
  dailyGeminiSpendCapUsd: 5,
  accountDailySpendShare: 0.2,
  geminiInputUsdPerMillion: 0.25,
  geminiOutputUsdPerMillion: 1.5,
  proPriceVnd: 79_000,
  displayPriceVnd: null,
  proDurationDays: 30,
  pilotTimezone: 'Asia/Ho_Chi_Minh',
  reviewBaseXp: 2,
  serverReviewXp: true,
  analyticsEnabled: true,
});

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const positiveNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const boundedInteger = (maximum: number) => (value: unknown): value is number => positiveInteger(value) && value <= maximum;
const boundedNumber = (maximum: number) => (value: unknown): value is number => positiveNumber(value) && value <= maximum;
const validators: { [K in keyof PilotConfig]: (value: unknown) => value is PilotConfig[K] } = {
  freeMonthlyAiCards: boundedInteger(100_000),
  proMonthlyAiCards: boundedInteger(100_000),
  quotaEnforced: (value): value is boolean => typeof value === 'boolean',
  freeDailyAiActions: boundedInteger(10_000),
  proDailyAiActions: boundedInteger(10_000),
  dailyGeminiSpendCapUsd: boundedNumber(1_000),
  accountDailySpendShare: (value): value is number => positiveNumber(value) && value <= 1,
  geminiInputUsdPerMillion: boundedNumber(1_000),
  geminiOutputUsdPerMillion: boundedNumber(1_000),
  proPriceVnd: positiveInteger,
  displayPriceVnd: (value): value is number | null => value === null || positiveInteger(value),
  proDurationDays: positiveInteger,
  pilotTimezone: (value): value is 'Asia/Ho_Chi_Minh' => value === 'Asia/Ho_Chi_Minh',
  reviewBaseXp: positiveInteger,
  serverReviewXp: (value): value is boolean => typeof value === 'boolean',
  analyticsEnabled: (value): value is boolean => typeof value === 'boolean',
};

export function parsePilotConfig(value: unknown): { config: PilotConfig; invalidFields: string[] } {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const config = { ...PILOT_CONFIG_DEFAULTS };
  const invalidFields: string[] = [];
  for (const key of Object.keys(PILOT_CONFIG_DEFAULTS) as Array<keyof PilotConfig>) {
    if (source[key] === undefined) {
      invalidFields.push(key);
      continue;
    }
    const valid = validators[key] as (candidate: unknown) => boolean;
    if (!valid(source[key])) {
      invalidFields.push(key);
      continue;
    }
    Object.assign(config, { [key]: source[key] });
  }
  return { config, invalidFields };
}

let cached: { config: PilotConfig; until: number } | null = null;

export async function loadPilotConfig(database: Firestore, now = Date.now()): Promise<PilotConfig> {
  if (cached && now < cached.until) return cached.config;
  const snapshot = await database.collection('_serviceConfig').doc('pilot').get();
  const parsed = parsePilotConfig(snapshot.data());
  if (parsed.invalidFields.length) {
    console.error('Pilot config has missing or invalid fields; safe defaults were applied.', {
      fields: parsed.invalidFields,
    });
  }
  cached = { config: parsed.config, until: now + 60_000 };
  return parsed.config;
}

export function clearPilotConfigCacheForTest(): void { cached = null; }

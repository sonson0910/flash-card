import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { clearPilotConfigCacheForTest, loadPilotConfig, parsePilotConfig, PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';

describe('pilot configuration', () => {
  it('keeps the measured pilot limits and uses defaults for invalid values', () => {
    expect(PILOT_CONFIG_DEFAULTS.proMonthlyAiCards).toBe(1_000);
    const parsed = parsePilotConfig({
      ...PILOT_CONFIG_DEFAULTS,
      dailyGeminiSpendCapUsd: 0,
      accountDailySpendShare: -1,
      freeDailyAiActions: Infinity,
      proDailyAiActions: Number.MAX_SAFE_INTEGER,
      proMonthlyAiCards: Number.MAX_SAFE_INTEGER,
      geminiOutputUsdPerMillion: 1e308,
      displayPriceVnd: '79000',
    });
    expect(parsed.invalidFields).toEqual([
      'proMonthlyAiCards', 'freeDailyAiActions', 'proDailyAiActions', 'dailyGeminiSpendCapUsd',
      'accountDailySpendShare', 'geminiOutputUsdPerMillion', 'displayPriceVnd',
    ]);
    expect(parsed.config).toMatchObject({
      freeDailyAiActions: 20,
      proDailyAiActions: 200,
      proMonthlyAiCards: 1_000,
      dailyGeminiSpendCapUsd: 5,
      accountDailySpendShare: 0.2,
      displayPriceVnd: null,
    });
  });

  it('accepts a valid final display price and refreshes after 60 seconds', async () => {
    clearPilotConfigCacheForTest();
    const get = vi.fn().mockResolvedValue({ data: () => ({ ...PILOT_CONFIG_DEFAULTS, displayPriceVnd: 86_900 }) });
    const database = { collection: () => ({ doc: () => ({ get }) }) } as unknown as Firestore;
    expect((await loadPilotConfig(database, 1_000)).displayPriceVnd).toBe(86_900);
    await loadPilotConfig(database, 60_999);
    expect(get).toHaveBeenCalledTimes(1);
    await loadPilotConfig(database, 61_000);
    expect(get).toHaveBeenCalledTimes(2);
    clearPilotConfigCacheForTest();
  });
});

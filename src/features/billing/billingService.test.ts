import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  app: { name: 'test-app' } as unknown,
  auth: { currentUser: null as null | { uid: string } },
  capability: { available: true } as { available: boolean; reason?: string },
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  callable: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: runtime.getFunctions,
  httpsCallable: runtime.httpsCallable,
}));

vi.mock('../../lib/firebase', () => ({
  app: runtime.app,
  auth: runtime.auth,
  protectedFunctionsCapability: runtime.capability,
  getSonFlashFunctions: (app: unknown, region: string = 'asia-southeast1') => runtime.getFunctions(app, region),
}));

import { getPilotOffer, recordPurchaseIntent } from './billingService';
const offerVersion = 'a'.repeat(64);

describe('billingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.capability.available = true;
    delete runtime.capability.reason;
    runtime.auth.currentUser = { uid: 'user-1' };
    runtime.getFunctions.mockReturnValue({ region: 'asia-southeast1' });
    runtime.httpsCallable.mockReturnValue(runtime.callable);
  });

  it('fetches the pilot offer through the protected callable', async () => {
    runtime.callable.mockResolvedValue({ data: { proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion } });

    const offer = await getPilotOffer();

    expect(runtime.httpsCallable).toHaveBeenCalledWith({ region: 'asia-southeast1' }, 'getPilotOffer');
    expect(runtime.callable).toHaveBeenCalledWith({});
    expect(offer).toEqual({ proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
  });

  it('rejects an old server response without an offer version', async () => {
    runtime.callable.mockResolvedValue({ data: { proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible' } });
    await expect(getPilotOffer()).rejects.toThrow('invalid response');
  });

  it('accepts values at the server contract limits', async () => {
    runtime.callable.mockResolvedValue({ data: {
      proMonthlyAiCards: 100_000, displayPriceVnd: Number.MAX_SAFE_INTEGER,
      proDurationDays: Number.MAX_SAFE_INTEGER, intentEligibility: 'eligible', offerVersion,
    } });

    await expect(getPilotOffer()).resolves.toMatchObject({
      proMonthlyAiCards: 100_000, displayPriceVnd: Number.MAX_SAFE_INTEGER,
      proDurationDays: Number.MAX_SAFE_INTEGER,
    });
  });

  it.each([
    { proMonthlyAiCards: 100_001 },
    { displayPriceVnd: Number.MAX_SAFE_INTEGER + 1 },
    { proDurationDays: Number.MAX_SAFE_INTEGER + 1 },
    { intentEligibility: 'legacy-eligible' },
    { legacy: true },
  ])('rejects an invalid offer field: %o', async invalid => {
    runtime.callable.mockResolvedValue({ data: {
      proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30,
      intentEligibility: 'eligible', offerVersion, ...invalid,
    } });

    await expect(getPilotOffer()).rejects.toThrow('invalid response');
  });

  it('records purchase intent with the requesting trigger', async () => {
    runtime.callable.mockResolvedValue({ data: { recorded: true } });

    const result = await recordPurchaseIntent('menu', 'user-1', offerVersion);

    expect(runtime.httpsCallable).toHaveBeenCalledWith({ region: 'asia-southeast1' }, 'recordPurchaseIntent');
    expect(runtime.callable).toHaveBeenCalledWith({ trigger: 'menu', expectedOwnerId: 'user-1', offerVersion });
    expect(result).toEqual({ recorded: true });
  });

  it.each([{ recorded: false }, { recorded: true, legacy: true }, {}])(
    'does not report an invalid purchase intent response as recorded', async data => {
      runtime.callable.mockResolvedValue({ data });

      await expect(recordPurchaseIntent('menu', 'user-1', offerVersion)).rejects.toThrow('invalid response');
    },
  );

  it('refuses to call the backend when no user is signed in', async () => {
    runtime.auth.currentUser = null;

    await expect(getPilotOffer()).rejects.toThrow(/sign-in/i);
    expect(runtime.httpsCallable).not.toHaveBeenCalled();
  });

  it('propagates a callable failure instead of swallowing it', async () => {
    runtime.callable.mockRejectedValue(Object.assign(new Error('internal'), { code: 'internal' }));

    await expect(recordPurchaseIntent('quota', 'user-1', offerVersion)).rejects.toThrow();
  });

  it('does not call the backend when the owner changes during the Firebase import', async () => {
    let settleFunctions!: (functions: { region: string }) => void;
    runtime.getFunctions.mockReturnValue(new Promise(resolve => { settleFunctions = resolve; }));
    const request = recordPurchaseIntent('quota', 'user-1', offerVersion);
    await new Promise(resolve => { setTimeout(resolve, 0); });
    runtime.auth.currentUser = { uid: 'user-2' };
    settleFunctions({ region: 'asia-southeast1' });

    await expect(request).rejects.toThrow(/sign-in/i);
    expect(runtime.httpsCallable).not.toHaveBeenCalled();
  });
});

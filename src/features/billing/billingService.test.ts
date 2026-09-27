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
    runtime.callable.mockResolvedValue({ data: { proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30 } });

    const offer = await getPilotOffer();

    expect(runtime.httpsCallable).toHaveBeenCalledWith({ region: 'asia-southeast1' }, 'getPilotOffer');
    expect(runtime.callable).toHaveBeenCalledWith({});
    expect(offer).toEqual({ proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30 });
  });

  it('records purchase intent with the requesting trigger', async () => {
    runtime.callable.mockResolvedValue({ data: { recorded: true } });

    const result = await recordPurchaseIntent('menu');

    expect(runtime.httpsCallable).toHaveBeenCalledWith({ region: 'asia-southeast1' }, 'recordPurchaseIntent');
    expect(runtime.callable).toHaveBeenCalledWith({ trigger: 'menu' });
    expect(result).toEqual({ recorded: true });
  });

  it('refuses to call the backend when no user is signed in', async () => {
    runtime.auth.currentUser = null;

    await expect(getPilotOffer()).rejects.toThrow(/sign-in/i);
    expect(runtime.httpsCallable).not.toHaveBeenCalled();
  });

  it('propagates a callable failure instead of swallowing it', async () => {
    runtime.callable.mockRejectedValue(Object.assign(new Error('internal'), { code: 'internal' }));

    await expect(recordPurchaseIntent('quota')).rejects.toThrow();
  });
});

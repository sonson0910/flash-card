import { app, auth, getSonFlashFunctions, protectedFunctionsCapability } from '../../lib/firebase';
import { runProtectedFunction } from '../../lib/protectedFunctionsCapability';

export interface PilotOffer {
  proMonthlyAiCards: number;
  displayPriceVnd: number | null;
  proDurationDays: number;
  intentEligibility: 'eligible' | 'already-pro' | 'unavailable';
  offerVersion: string;
}

const validOfferVersion = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const invalidResponse = (): never => { throw new Error('Pilot billing service returned an invalid response.'); };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const parsePilotOffer = (value: unknown): PilotOffer => {
  if (!isRecord(value) || Object.keys(value).length !== 5
    || !Number.isSafeInteger(value.proMonthlyAiCards) || Number(value.proMonthlyAiCards) < 1 || Number(value.proMonthlyAiCards) > 100_000
    || !(value.displayPriceVnd === null || Number.isSafeInteger(value.displayPriceVnd) && Number(value.displayPriceVnd) > 0)
    || !Number.isSafeInteger(value.proDurationDays) || Number(value.proDurationDays) < 1
    || !['eligible', 'already-pro', 'unavailable'].includes(String(value.intentEligibility))
    || !validOfferVersion(value.offerVersion)) invalidResponse();
  return value as PilotOffer;
};

const parsePurchaseIntent = (value: unknown): { recorded: true } => {
  if (!isRecord(value) || Object.keys(value).length !== 1 || value.recorded !== true) invalidResponse();
  return { recorded: true };
};

const callBilling = async <T,>(name: string, payload: object, expectedOwnerId?: string): Promise<T> =>
  runProtectedFunction(protectedFunctionsCapability, 'Pilot offer', async () => {
    if (!app || !auth?.currentUser || expectedOwnerId && auth.currentUser.uid !== expectedOwnerId) {
      throw Object.assign(new Error('Sign in required.'), { code: 'unauthenticated' });
    }
    const { httpsCallable } = await import('firebase/functions');
    if (!auth?.currentUser || expectedOwnerId && auth.currentUser.uid !== expectedOwnerId) {
      throw Object.assign(new Error('Sign in required.'), { code: 'unauthenticated' });
    }
    const functions = await getSonFlashFunctions(app);
    if (!auth?.currentUser || expectedOwnerId && auth.currentUser.uid !== expectedOwnerId) {
      throw Object.assign(new Error('Sign in required.'), { code: 'unauthenticated' });
    }
    const callable = httpsCallable<object, T>(functions, name);
    return (await callable(payload)).data;
  });

export const getPilotOffer = async (): Promise<PilotOffer> => {
  return parsePilotOffer(await callBilling<unknown>('getPilotOffer', {}));
};
export const recordPurchaseIntent = (trigger: 'quota' | 'menu', expectedOwnerId: string,
  offerVersion: string): Promise<{ recorded: true }> => {
  if (!validOfferVersion(offerVersion)) return Promise.reject(new Error('Pilot offer version is unavailable.'));
  return callBilling<unknown>('recordPurchaseIntent', { trigger, expectedOwnerId, offerVersion }, expectedOwnerId)
    .then(parsePurchaseIntent);
};

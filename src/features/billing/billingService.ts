import { app, auth, protectedFunctionsCapability } from '../../lib/firebase';
import { runProtectedFunction } from '../../lib/protectedFunctionsCapability';

export interface PilotOffer {
  proMonthlyAiCards: number;
  displayPriceVnd: number | null;
  proDurationDays: number;
}

const callBilling = async <T,>(name: string, payload: object): Promise<T> =>
  runProtectedFunction(protectedFunctionsCapability, 'Pilot offer', async () => {
    if (!app || !auth?.currentUser) throw Object.assign(new Error('Sign in required.'), { code: 'unauthenticated' });
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const callable = httpsCallable<object, T>(getFunctions(app, 'asia-southeast1'), name);
    return (await callable(payload)).data;
  });

export const getPilotOffer = (): Promise<PilotOffer> => callBilling('getPilotOffer', {});
export const recordPurchaseIntent = (trigger: 'quota' | 'menu'): Promise<{ recorded: true }> =>
  callBilling('recordPurchaseIntent', { trigger });

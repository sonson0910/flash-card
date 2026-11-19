import { httpsCallable } from 'firebase/functions';
import type { Firestore } from 'firebase/firestore';
import { app, db, getSonFlashFunctions } from '../../lib/firebase';
import type { CallableInvoker } from './latestExamScore';

export interface LatestExamScorePorts {
  readonly database: Firestore | null;
  readonly call: CallableInvoker;
}

const FUNCTIONS_REGION = 'asia-southeast1';

/** The app's own Firestore and Functions instances, used when a caller supplies no ports. */
export const defaultLatestExamScorePorts = (): LatestExamScorePorts => ({
  database: db ?? null,
  call: async (name, payload) => {
    if (!app) throw Object.assign(new Error('Cloud functions are not configured.'), { code: 'unavailable' });
    const callable = httpsCallable<unknown, unknown>(await getSonFlashFunctions(app, FUNCTIONS_REGION), name);
    return (await callable(payload)).data;
  },
});

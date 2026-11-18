import { auth, app, getSonFlashFunctions } from './firebase';
import { OperationTimeoutError } from './async';
import { ProtectedFunctionError } from './protectedFunctionsCapability';

export type PilotClientEvent =
  | { name: 'capture_started'; props: { requestId: string; surface: 'app' | 'extension'; appVersion: string } }
  | { name: 'capture_failed'; props: { requestId: string; surface: 'app' | 'extension'; latencyMs: number; errorCode: string; appVersion: string } }
  | { name: 'paywall_viewed'; props: { trigger: 'quota' | 'menu'; offerId: 'pro-vn-30d-v1' } };

export function captureAnalyticsErrorCode(error: unknown): string {
  if (error instanceof OperationTimeoutError) return 'timeout';
  if (error instanceof ProtectedFunctionError) {
    if (error.kind === 'authentication') return 'auth';
    if (error.kind === 'quota') {
      if (error.message.includes('chi phí')) return 'spend';
      if (error.message.includes('AI phụ')) return 'allowance';
      return 'quota';
    }
    if (error.kind === 'network') return 'network';
    return 'provider';
  }
  return 'save';
}

export function createPilotAnalyticsClient(options: {
  owner(): string | null;
  send(events: PilotClientEvent[]): Promise<void>;
  schedule(callback: () => void): ReturnType<typeof setTimeout>;
  clear(timer: ReturnType<typeof setTimeout>): void;
  onHidden(callback: () => void): () => void;
}) {
  let ownerId: string | null = null;
  let pending: PilotClientEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sending = false;
  let failures = 0;
  const flush = async () => {
    if (sending || pending.length === 0) return;
    if (!ownerId || options.owner() !== ownerId) { pending = []; return; }
    if (timer) { options.clear(timer); timer = null; }
    sending = true;
    const batch = pending.splice(0, 20);
    try { await options.send(batch); failures = 0; }
    catch {
      failures += 1;
      if (failures < 3 && options.owner() === ownerId) pending = [...batch, ...pending].slice(0, 100);
    }
    finally {
      sending = false;
      if (pending.length > 0 && !timer) timer = options.schedule(() => { timer = null; void flush(); });
    }
  };
  const stopHidden = options.onHidden(() => { void flush(); });
  return {
    record(event: PilotClientEvent) {
      const current = options.owner();
      if (!current) { pending = []; ownerId = null; failures = 0; return; }
      if (ownerId !== current) { pending = []; ownerId = current; failures = 0; }
      pending.push(event);
      if (pending.length >= 20) void flush();
      else if (!timer) timer = options.schedule(() => { timer = null; void flush(); });
    },
    flush,
    dispose() { stopHidden(); if (timer) options.clear(timer); pending = []; },
  };
}

const client = createPilotAnalyticsClient({
  owner: () => auth?.currentUser?.uid ?? null,
  send: async events => {
    if (!app || !auth?.currentUser) return;
    const { httpsCallable } = await import('firebase/functions');
    const callable = httpsCallable<{ events: PilotClientEvent[] }, { accepted: number }>(
      await getSonFlashFunctions(app), 'recordClientEvents');
    await callable({ events });
  },
  schedule: callback => setTimeout(callback, 1_000),
  clear: timer => clearTimeout(timer),
  onHidden: callback => {
    if (typeof document === 'undefined') return () => undefined;
    const listener = () => { if (document.visibilityState === 'hidden') callback(); };
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
});

export const recordPilotClientEvent = (event: PilotClientEvent): void => client.record(event);
export const PILOT_APP_VERSION = '1.0.0';

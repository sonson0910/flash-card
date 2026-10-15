import { useEffect, useRef, useState } from 'react';

const SERVICE_WORKER_SCRIPT = '/sw.js';
const SERVICE_WORKER_SCOPE = '/';
const READY_TIMEOUT_MS = 15_000;

type OfflineReadinessStatus = 'idle' | 'preparing' | 'ready' | 'update' | 'error' | 'unsupported';

export interface OfflineReadinessProps {
  readonly production?: boolean;
  readonly serviceWorker?: ServiceWorkerContainer;
  readonly registration?: ServiceWorkerRegistration | null;
}

const statusMessage = (status: OfflineReadinessStatus): string => {
  switch (status) {
    case 'preparing': return 'Preparing app files for offline use…';
    case 'ready': return 'Available offline.';
    case 'update': return 'Update available. Reopen SonFlash after your study session.';
    case 'error': return 'Offline preparation failed. Check your connection or storage, then try again.';
    case 'unsupported': return 'Offline preparation is available in a production build on a supported browser.';
    default: return 'Prepare app files for offline use when you are connected.';
  }
};

const statusForRegistration = (registration: ServiceWorkerRegistration): OfflineReadinessStatus => (
  registration.waiting
    ? 'update'
    : registration.active?.state === 'activated'
      ? 'ready'
      : 'idle'
);

const waitForReady = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timeout = globalThis.setTimeout(
        () => reject(new Error('Offline service worker activation timed out.')),
        timeoutMs,
      );
      promise.then(resolve, reject);
    });
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
};

const waitForWorkerState = async (
  worker: ServiceWorker,
  acceptedStates: readonly ServiceWorkerState[],
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> => {
  if (acceptedStates.includes(worker.state)) return;
  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      worker.removeEventListener('statechange', onStateChange);
      if (error) reject(error);
      else resolve();
    };
    const onStateChange = () => {
      if (acceptedStates.includes(worker.state)) finish();
      else if (worker.state === 'redundant') finish(new Error('Offline service worker became redundant.'));
    };
    timeout = globalThis.setTimeout(
      () => finish(new Error(timeoutMessage)),
      timeoutMs,
    );
    worker.addEventListener('statechange', onStateChange);
    onStateChange();
  });
};

const waitForActivated = (worker: ServiceWorker, timeoutMs: number): Promise<void> => (
  waitForWorkerState(
    worker,
    ['activated'],
    timeoutMs,
    'Offline service worker activation timed out.',
  )
);

const waitForInstalledOrActivated = (worker: ServiceWorker, timeoutMs: number): Promise<void> => (
  waitForWorkerState(
    worker,
    ['installed', 'activated'],
    timeoutMs,
    'Offline service worker installation timed out.',
  )
);

export async function installOfflineAppShell(
  serviceWorker: ServiceWorkerContainer,
  timeoutMs = READY_TIMEOUT_MS,
  onRegistration?: (registration: ServiceWorkerRegistration) => void,
): Promise<ServiceWorkerRegistration> {
  const registration = await serviceWorker.register(SERVICE_WORKER_SCRIPT, {
    scope: SERVICE_WORKER_SCOPE,
    updateViaCache: 'none',
  });
  onRegistration?.(registration);
  const candidate = registration.installing ?? registration.waiting;
  const ready = await waitForReady(serviceWorker.ready, timeoutMs);
  if (candidate) await waitForInstalledOrActivated(candidate, timeoutMs);
  const active = ready.active ?? registration.active;
  if (!active) throw new Error('Offline service worker did not become active.');
  if (!registration.waiting) await waitForActivated(active, timeoutMs);
  return registration.active || registration.waiting || registration.installing
    ? registration
    : ready;
}

export function OfflineReadiness({
  production = import.meta.env.PROD,
  serviceWorker: suppliedServiceWorker,
  registration: suppliedRegistration,
}: OfflineReadinessProps) {
  const [status, setStatus] = useState<OfflineReadinessStatus>(() => (
    !production
      ? 'unsupported'
      : suppliedRegistration
        ? statusForRegistration(suppliedRegistration)
        : 'idle'
  ));
  const [message, setMessage] = useState(() => statusMessage(status));
  const preparingRef = useRef(false);
  const mountedRef = useRef(true);
  const preparationRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const preparationTimedOutRef = useRef(false);
  const attachRegistrationRef = useRef<(registration: ServiceWorkerRegistration) => void>(() => undefined);
  const syncStatusRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attachRegistrationRef.current = () => undefined;
      syncStatusRef.current = () => undefined;
      preparationRegistrationRef.current = null;
      preparationTimedOutRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!production) return undefined;
    const serviceWorker = suppliedServiceWorker ?? globalThis.navigator?.serviceWorker;
    if (!serviceWorker) {
      setStatus('unsupported');
      setMessage(statusMessage('unsupported'));
      return undefined;
    }

    let mounted = true;
    let registration = suppliedRegistration ?? null;
    let installing: ServiceWorker | null = null;
    let watchInstalling: () => void = () => undefined;
    const syncStatus = () => {
      if (!mounted || !registration) return;
      const timedOutRegistration = preparationTimedOutRef.current
        && registration === preparationRegistrationRef.current;
      if (preparingRef.current && !timedOutRegistration) return;
      if (timedOutRegistration) {
        const candidateState = installing?.state ?? registration.installing?.state ?? null;
        if (candidateState === 'redundant') {
          preparationTimedOutRef.current = false;
          preparationRegistrationRef.current = null;
          setStatus('error');
          setMessage(statusMessage('error'));
          return;
        }
        if (registration.waiting) {
          preparationTimedOutRef.current = false;
          preparationRegistrationRef.current = null;
          setStatus('update');
          setMessage(statusMessage('update'));
          return;
        }
        if (candidateState === 'activated'
          || (candidateState === null && registration.active?.state === 'activated')) {
          preparationTimedOutRef.current = false;
          preparationRegistrationRef.current = null;
          setStatus('ready');
          setMessage(statusMessage('ready'));
          return;
        }
        if (candidateState !== null
          || registration.active?.state === 'installing'
          || registration.active?.state === 'activating') {
          setStatus('preparing');
          setMessage(statusMessage('preparing'));
          return;
        }
        preparationTimedOutRef.current = false;
        preparationRegistrationRef.current = null;
        setStatus('error');
        setMessage(statusMessage('error'));
        return;
      }
      const nextStatus = statusForRegistration(registration);
      setStatus(nextStatus);
      setMessage(statusMessage(nextStatus));
    };
    const handleInstallingStateChange = () => {
      syncStatus();
    };
    watchInstalling = () => {
      const nextInstalling = registration?.installing ?? null;
      if (nextInstalling === installing) return;
      installing?.removeEventListener('statechange', handleInstallingStateChange);
      installing = nextInstalling;
      installing?.addEventListener('statechange', handleInstallingStateChange);
    };
    const handleUpdateFound = () => {
      watchInstalling();
      syncStatus();
    };

    const attach = (nextRegistration: ServiceWorkerRegistration | null | undefined) => {
      if (
        preparationRegistrationRef.current !== null
        && nextRegistration !== preparationRegistrationRef.current
      ) return;
      registration?.removeEventListener('updatefound', handleUpdateFound);
      registration = nextRegistration ?? null;
      if (!registration) return;
      registration.addEventListener('updatefound', handleUpdateFound);
      watchInstalling();
      syncStatus();
    };
    attachRegistrationRef.current = attach;
    syncStatusRef.current = syncStatus;

    const ready = suppliedRegistration
      ? Promise.resolve(suppliedRegistration)
      : serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
    void ready.then(attach).catch(() => {
      if (!mounted) return;
      setStatus('error');
      setMessage(statusMessage('error'));
    });
    serviceWorker.addEventListener('controllerchange', syncStatus);

    return () => {
      mounted = false;
      serviceWorker.removeEventListener('controllerchange', syncStatus);
      installing?.removeEventListener('statechange', handleInstallingStateChange);
      registration?.removeEventListener('updatefound', handleUpdateFound);
      if (syncStatusRef.current === syncStatus) syncStatusRef.current = () => undefined;
      if (attachRegistrationRef.current === attach) attachRegistrationRef.current = () => undefined;
    };
  }, [production, suppliedRegistration, suppliedServiceWorker]);

  const handlePrepare = async () => {
    if (!mountedRef.current || preparingRef.current || status === 'ready' || status === 'update') return;
    const serviceWorker = suppliedServiceWorker ?? globalThis.navigator?.serviceWorker;
    if (!production || !serviceWorker) {
      setStatus('unsupported');
      setMessage(statusMessage('unsupported'));
      return;
    }
    preparingRef.current = true;
    preparationRegistrationRef.current = null;
    preparationTimedOutRef.current = false;
    setStatus('preparing');
    setMessage(statusMessage('preparing'));
    try {
      const registration = await installOfflineAppShell(serviceWorker, READY_TIMEOUT_MS, nextRegistration => {
        preparationRegistrationRef.current = nextRegistration;
        attachRegistrationRef.current(nextRegistration);
      });
      if (!mountedRef.current) return;
      preparationRegistrationRef.current = null;
      preparationTimedOutRef.current = false;
      const nextStatus = registration.waiting ? 'update' : 'ready';
      setStatus(nextStatus);
      setMessage(statusMessage(nextStatus));
    } catch {
      if (!mountedRef.current) return;
      if (preparationRegistrationRef.current !== null) {
        preparationTimedOutRef.current = true;
        syncStatusRef.current();
        return;
      }
      setStatus('error');
      setMessage(statusMessage('error'));
    } finally {
      preparingRef.current = false;
    }
  };

  const actionLabel = status === 'ready'
    ? 'Available offline'
    : status === 'update'
      ? 'Update available'
      : 'Prepare offline';
  const actionDisabled = status === 'preparing'
    || status === 'ready'
    || status === 'update'
    || status === 'unsupported';

  return (
    <section
      data-offline-readiness="true"
      aria-labelledby="offline-readiness-heading"
      className="mb-5 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)]/80 p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="offline-readiness-heading" className="text-sm font-black uppercase tracking-[0.08em]">Offline access</h2>
          {status === 'idle' || status === 'error' ? (
            <p className="mt-1 text-sm text-[var(--sf-muted)]">app files, up to 4 MiB</p>
          ) : null}
        </div>
        {status !== 'unsupported' ? (
          <button
            type="button"
            disabled={actionDisabled}
            onClick={() => { void handlePrepare(); }}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--sf-brand)] px-4 py-2 text-sm font-bold text-[var(--sf-on-brand)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] disabled:cursor-not-allowed disabled:opacity-65"
          >
            {status === 'preparing' ? 'Preparing offline…' : actionLabel}
          </button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" aria-busy={status === 'preparing'} className="mt-2 text-sm text-[var(--sf-muted)]">
        {message}
      </p>
    </section>
  );
}

export default OfflineReadiness;

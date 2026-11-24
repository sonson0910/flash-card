import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const SERVICE_WORKER_SCRIPT = '/sw.js';
const SERVICE_WORKER_SCOPE = '/';
const READY_TIMEOUT_MS = 15_000;

type OfflineReadinessStatus = 'idle' | 'preparing' | 'ready' | 'update' | 'error' | 'unsupported';

export interface OfflineReadinessProps {
  readonly production?: boolean;
  readonly serviceWorker?: ServiceWorkerContainer;
  readonly registration?: ServiceWorkerRegistration | null;
  /** Runs before the shell worker takes the root scope; a failure does not stop the preparation. */
  readonly beforePrepare?: () => Promise<void>;
  /** Outside My Files the card appears only for a waiting update; preparing offline lives in My Files. */
  readonly updatesOnly?: boolean;
}

const statusMessage = (status: OfflineReadinessStatus): MessageDescriptor => {
  switch (status) {
    case 'preparing': return msg({ id: 'shell.offline.status.preparing', message: 'Preparing app files for offline use…' });
    case 'ready': return msg({ id: 'shell.offline.status.ready', message: 'Available offline.' });
    case 'update': return msg({ id: 'shell.offline.status.update', message: 'Update available. Reopen SonFlash after your study session.' });
    case 'error': return msg({ id: 'shell.offline.status.error', message: 'Offline preparation failed. Check your connection or storage, then try again.' });
    case 'unsupported': return msg({ id: 'shell.offline.status.unsupported', message: 'Offline preparation is available in a production build on a supported browser.' });
    default: return msg({ id: 'shell.offline.status.idle', message: 'Prepare app files for offline use when you are connected.' });
  }
};

// The app files can only be fetched with a connection, so the banner follows the browser's network state.
const subscribeToConnection = (notify: () => void): (() => void) => {
  const target = typeof window === 'undefined' ? null : window;
  target?.addEventListener?.('online', notify);
  target?.addEventListener?.('offline', notify);
  return () => {
    target?.removeEventListener?.('online', notify);
    target?.removeEventListener?.('offline', notify);
  };
};
const readConnection = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

// Another worker (the reminder push worker registered at the root scope by an earlier version) does not serve the app offline.
const isShellWorker = (worker: ServiceWorker | null): worker is ServiceWorker => (
  worker !== null && new URL(worker.scriptURL, globalThis.location?.href ?? 'https://localhost/').pathname === SERVICE_WORKER_SCRIPT
);

const statusForRegistration = (registration: ServiceWorkerRegistration): OfflineReadinessStatus => (
  registration.waiting
    ? 'update'
    : isShellWorker(registration.active) && registration.active.state === 'activated'
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
  beforePrepare,
  updatesOnly = false,
}: OfflineReadinessProps) {
  const [status, setStatus] = useState<OfflineReadinessStatus>(() => (
    !production
      ? 'unsupported'
      : suppliedRegistration
        ? statusForRegistration(suppliedRegistration)
        : 'idle'
  ));
  const { _ } = useLingui();
  const online = useSyncExternalStore(subscribeToConnection, readConnection, readConnection);
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
          return;
        }
        if (registration.waiting) {
          preparationTimedOutRef.current = false;
          preparationRegistrationRef.current = null;
          setStatus('update');
          return;
        }
        if (candidateState === 'activated'
          || (candidateState === null && registration.active?.state === 'activated')) {
          preparationTimedOutRef.current = false;
          preparationRegistrationRef.current = null;
          setStatus('ready');
          return;
        }
        if (candidateState !== null
          || registration.active?.state === 'installing'
          || registration.active?.state === 'activating') {
          setStatus('preparing');
          return;
        }
        preparationTimedOutRef.current = false;
        preparationRegistrationRef.current = null;
        setStatus('error');
        return;
      }
      const nextStatus = statusForRegistration(registration);
      setStatus(nextStatus);
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

  // A preparation the learner started is owed its result. The card shows it in My Files; if they have left, the
  // hidden status line announces it instead. Seeing the settled card again pays the debt.
  const [resultOwed, setResultOwed] = useState(false);
  useEffect(() => {
    if (!updatesOnly && status !== 'preparing') setResultOwed(false);
  }, [updatesOnly, status]);

  const handlePrepare = async () => {
    if (!mountedRef.current || preparingRef.current || status === 'ready' || status === 'update' || !readConnection()) return;
    const serviceWorker = suppliedServiceWorker ?? globalThis.navigator?.serviceWorker;
    if (!production || !serviceWorker) {
      setStatus('unsupported');
      return;
    }
    setResultOwed(true);
    preparingRef.current = true;
    preparationRegistrationRef.current = null;
    preparationTimedOutRef.current = false;
    setStatus('preparing');
    try {
      await beforePrepare?.().catch(() => undefined);
      const registration = await installOfflineAppShell(serviceWorker, READY_TIMEOUT_MS, nextRegistration => {
        preparationRegistrationRef.current = nextRegistration;
        attachRegistrationRef.current(nextRegistration);
      });
      if (!mountedRef.current) return;
      preparationRegistrationRef.current = null;
      preparationTimedOutRef.current = false;
      const nextStatus = registration.waiting ? 'update' : 'ready';
      setStatus(nextStatus);
    } catch {
      if (!mountedRef.current) return;
      if (preparationRegistrationRef.current !== null) {
        preparationTimedOutRef.current = true;
        syncStatusRef.current();
        return;
      }
      setStatus('error');
    } finally {
      preparingRef.current = false;
    }
  };

  const needsConnection = !online && (status === 'idle' || status === 'error');
  const actionLabel = status === 'preparing'
    ? _(msg({ id: 'shell.offline.action.preparing', message: 'Preparing offline…' }))
    : status === 'ready'
      ? _(msg({ id: 'shell.offline.action.ready', message: 'Available offline' }))
      : status === 'update'
        ? _(msg({ id: 'shell.offline.action.update', message: 'Update available' }))
        : _(msg({ id: 'shell.offline.action.prepare', message: 'Prepare offline' }));
  const actionDisabled = needsConnection
    || status === 'preparing'
    || status === 'ready'
    || status === 'update'
    || status === 'unsupported';
  const message = needsConnection
    ? _(msg({ id: 'shell.offline.needs-connection', message: 'You are offline. Reconnect to prepare the app files.' }))
    : _(statusMessage(status));

  if (updatesOnly && status !== 'update') {
    // The card is hidden here, but a preparation started in My Files can finish after the learner has moved on;
    // its result is still announced.
    return (
      <p data-offline-readiness-status="true" role="status" aria-live="polite" aria-atomic="true" aria-busy={status === 'preparing'} className="sr-only">
        {resultOwed ? message : ''}
      </p>
    );
  }

  return (
    // One compact row: the banner stays available on every workspace view without
    // pushing a phone's primary learning action below the fold.
    <section
      data-offline-readiness="true"
      aria-labelledby="offline-readiness-heading"
      className="mb-4 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)]/80 px-4 py-2.5 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="offline-readiness-heading" className="text-xs font-black uppercase tracking-[0.08em]">{_(msg({ id: 'shell.offline.heading', message: 'Offline access' }))}</h2>
          {status === 'idle' || status === 'error' ? (
            <p className="text-xs text-[var(--sf-text-muted)]">{_(msg({ id: 'shell.offline.size', message: 'app files, up to 6 MiB' }))}</p>
          ) : null}
        </div>
        {status !== 'unsupported' ? (
          <button
            type="button"
            disabled={actionDisabled}
            onClick={() => { void handlePrepare(); }}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-[var(--sf-brand)] px-4 py-2 text-sm font-bold text-[var(--sf-on-brand)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] disabled:cursor-not-allowed disabled:opacity-65"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {/* The idle hint repeats the heading and button, so it is announced but not shown. */}
      <p role="status" aria-live="polite" aria-atomic="true" aria-busy={status === 'preparing'} className={status === 'idle' && !needsConnection ? 'sr-only' : 'mt-1 text-xs text-[var(--sf-text-muted)]'}>
        {message}
      </p>
    </section>
  );
}

export default OfflineReadiness;

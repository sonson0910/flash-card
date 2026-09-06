import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import bundledOfflinePackJson from '../../../public/media/listen-mvp/offline-pack.json?raw';
import type { ListenMvpLessonV1 } from './listenMvpContract';
import { ListenMvp, type ListenMvpProps } from './ListenMvp';
import {
  createOfflineMediaPackManager,
  OFFLINE_MEDIA_PACK_LIMITS,
  OfflineMediaPackQuotaError,
  parseOfflineMediaPackManifestV1,
  type OfflineMediaPackResolutionContext,
} from '../offlineMedia/offlineMediaPack';
import {
  LISTEN_MVP_PILOT_PUBLICATION,
  LISTEN_MVP_PILOT_REGISTRY,
} from './listenMvpPilot';

export const LISTEN_MVP_OFFLINE_PACK_PATH = '/media/listen-mvp/offline-pack.json';

/** The checked-in public pack supplies the trusted identity projection used before install. */
export const PUBLISHED_LISTEN_MVP_MANIFEST = parseOfflineMediaPackManifestV1(
  JSON.parse(bundledOfflinePackJson) as unknown,
);

export type PublishedListenMvpProps = Omit<
  ListenMvpProps,
  'offlineMediaPacks' | 'offlineMediaPackIdentity'
>;

type OfflineAudioStatus = 'idle' | 'installing' | 'ready' | 'error' | 'unsupported';

type OfflineAudioRequest = {
  readonly controller: AbortController;
  timedOut: boolean;
  failed: boolean;
};

const identityForLesson = (
  lesson: ListenMvpLessonV1 | null,
): OfflineMediaPackResolutionContext | undefined => {
  if (lesson === null) return undefined;
  const asset = PUBLISHED_LISTEN_MVP_MANIFEST.assets.find(candidate => (
    JSON.stringify(candidate.clip) === JSON.stringify(lesson.clip)
  ));
  return asset === undefined ? undefined : {
    catalogId: PUBLISHED_LISTEN_MVP_MANIFEST.catalogId,
    releaseId: PUBLISHED_LISTEN_MVP_MANIFEST.releaseId,
    sha256: asset.sha256,
  };
};

const statusMessage = (
  status: OfflineAudioStatus,
  hasTrustedIdentity: boolean,
): string => {
  if (!hasTrustedIdentity) return 'Offline audio is unavailable for this lesson.';
  if (status === 'installing') return 'Downloading the reviewed audio pack…';
  if (status === 'ready') return 'Reviewed audio is available offline.';
  if (status === 'unsupported') return 'Offline audio is unavailable in this browser.';
  if (status === 'error') return 'Offline audio could not be prepared. Check your connection or storage, then try again.';
  return 'Download the reviewed audio pack for offline listening.';
};

const isExactManifestResponse = (response: Response): boolean => {
  if (!response.url) return true;
  const requestUrl = new URL(LISTEN_MVP_OFFLINE_PACK_PATH, globalThis.location?.origin ?? 'http://localhost');
  const responseUrl = new URL(response.url, requestUrl);
  return responseUrl.origin === requestUrl.origin
    && responseUrl.pathname === requestUrl.pathname
    && responseUrl.search === ''
    && responseUrl.hash === '';
};

export function PublishedListenMvp(props: PublishedListenMvpProps) {
  const manager = useMemo(() => createOfflineMediaPackManager(), []);
  const trustedIdentity = useMemo(() => identityForLesson(props.lesson), [props.lesson]);
  const [offlineMediaPackIdentity, setOfflineMediaPackIdentity] = useState<OfflineMediaPackResolutionContext | undefined>(
    trustedIdentity,
  );
  const [status, setStatus] = useState<OfflineAudioStatus>(trustedIdentity ? 'idle' : 'error');
  const mountedRef = useRef(true);
  const requestRef = useRef<OfflineAudioRequest | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.controller.abort();
      requestRef.current = null;
    };
  }, []);

  useEffect(() => {
    setOfflineMediaPackIdentity(trustedIdentity);
    setStatus(trustedIdentity ? 'idle' : 'error');
  }, [trustedIdentity]);

  const downloadAudio = useCallback(async () => {
    if (
      status === 'installing'
      || status === 'ready'
      || trustedIdentity === undefined
      || requestRef.current !== null
    ) return;
    const request: OfflineAudioRequest = {
      controller: new AbortController(),
      timedOut: false,
      failed: false,
    };
    const controller = request.controller;
    requestRef.current = request;
    setStatus('installing');
    // Toggle the trusted context after installation so ListenMvp rechecks Cache Storage.
    setOfflineMediaPackIdentity(undefined);
    let manifestTimeout: ReturnType<typeof globalThis.setTimeout> | undefined = globalThis.setTimeout(() => {
      request.timedOut = true;
      controller.abort();
    }, OFFLINE_MEDIA_PACK_LIMITS.fetchTimeoutMs);
    let removeManifestAbortListener: (() => void) | undefined;
    try {
      const manifestAborted = new Promise<never>((_resolve, reject) => {
        const abort = () => reject(controller.signal.reason ?? new Error('offline pack manifest request aborted'));
        removeManifestAbortListener = () => controller.signal.removeEventListener('abort', abort);
        if (controller.signal.aborted) abort();
        else controller.signal.addEventListener('abort', abort, { once: true });
      });
      const response = await Promise.race([
        globalThis.fetch(LISTEN_MVP_OFFLINE_PACK_PATH, {
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        }),
        manifestAborted,
      ]);
      if (response.status !== 200 || !response.ok || response.redirected || !isExactManifestResponse(response)) {
        throw new Error('offline pack manifest response was not exact');
      }
      const contentType = response.headers.get('Content-Type');
      if (contentType?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        throw new Error('offline pack manifest MIME type was not JSON');
      }
      const contentLength = response.headers.get('Content-Length');
      if (contentLength !== null) {
        const declaredBytes = Number(contentLength);
        if (!/^\d+$/.test(contentLength)
          || !Number.isSafeInteger(declaredBytes)
          || declaredBytes > OFFLINE_MEDIA_PACK_LIMITS.maximumManifestBytes) {
          throw new Error('offline pack manifest exceeds its byte bound');
        }
      }
      if (response.body === null) throw new Error('offline pack manifest body unavailable');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let reads = 0;
      try {
        while (true) {
          const next = await Promise.race([reader.read(), manifestAborted]);
          if (next.done) break;
          reads += 1;
          if (reads > OFFLINE_MEDIA_PACK_LIMITS.maximumStreamReads
            || !(next.value instanceof Uint8Array)) {
            throw new Error('offline pack manifest stream was invalid or excessively fragmented');
          }
          totalBytes += next.value.byteLength;
          if (totalBytes > OFFLINE_MEDIA_PACK_LIMITS.maximumManifestBytes) {
            throw new Error('offline pack manifest exceeds its byte bound');
          }
          chunks.push(next.value.slice());
        }
      } catch (error) {
        request.failed = true;
        void reader.cancel().catch(() => undefined);
        controller.abort();
        throw error;
      } finally {
        reader.releaseLock();
      }
      const manifestBytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        manifestBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
      const manifest = parseOfflineMediaPackManifestV1(JSON.parse(manifestText) as unknown);
      if (JSON.stringify(manifest) !== JSON.stringify(PUBLISHED_LISTEN_MVP_MANIFEST)) {
        throw new Error('offline pack manifest did not match the published pack');
      }
      if (manifestTimeout !== undefined) {
        globalThis.clearTimeout(manifestTimeout);
        manifestTimeout = undefined;
      }
      removeManifestAbortListener?.();
      removeManifestAbortListener = undefined;
      if (!mountedRef.current || requestRef.current !== request) return;
      await manager.install(manifest, LISTEN_MVP_PILOT_REGISTRY, {
        publication: LISTEN_MVP_PILOT_PUBLICATION,
        signal: controller.signal,
      });
      if (!mountedRef.current || requestRef.current !== request) return;
      setOfflineMediaPackIdentity(trustedIdentity);
      setStatus('ready');
    } catch (error) {
      const unsupported = typeof globalThis.navigator?.storage?.estimate !== 'function'
        && error instanceof OfflineMediaPackQuotaError
        && error.code === 'offline-pack-quota-unavailable';
      const wasAbortedBeforeFailure = controller.signal.aborted && !request.timedOut && !request.failed;
      request.failed = true;
      if (!controller.signal.aborted) controller.abort();
      if (!mountedRef.current || requestRef.current !== request || wasAbortedBeforeFailure) return;
      setOfflineMediaPackIdentity(trustedIdentity);
      setStatus(unsupported ? 'unsupported' : 'error');
    } finally {
      if (manifestTimeout !== undefined) globalThis.clearTimeout(manifestTimeout);
      removeManifestAbortListener?.();
      if (requestRef.current === request) requestRef.current = null;
    }
  }, [manager, status, trustedIdentity]);

  const hasTrustedIdentity = trustedIdentity !== undefined;
  const buttonLabel = !hasTrustedIdentity
    ? 'Offline audio unavailable'
    : status === 'installing'
      ? 'Downloading audio…'
      : status === 'ready'
        ? 'Audio available offline'
        : status === 'unsupported'
          ? 'Offline audio unavailable'
          : status === 'error'
            ? 'Retry download'
            : 'Download audio';

  return (
    <>
      <section
        aria-labelledby="published-listen-offline-heading"
        className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)]/80 p-4 shadow-sm"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="published-listen-offline-heading" className="text-sm font-black uppercase tracking-[0.08em]">Offline audio</h2>
            <p
              id="published-listen-offline-status"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-busy={status === 'installing'}
              className="mt-1 text-sm text-[var(--sf-muted)]"
            >
              {statusMessage(status, hasTrustedIdentity)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void downloadAudio(); }}
            aria-describedby="published-listen-offline-status"
            disabled={status === 'installing'
              || status === 'ready'
              || status === 'unsupported'
              || !hasTrustedIdentity}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--sf-brand)] px-4 py-2 text-sm font-bold text-[var(--sf-on-brand)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] disabled:cursor-not-allowed disabled:opacity-65"
          >
            {buttonLabel}
          </button>
        </div>
      </section>
      <ListenMvp
        {...props}
        offlineMediaPacks={manager}
        offlineMediaPackIdentity={offlineMediaPackIdentity}
      />
    </>
  );
}

export default PublishedListenMvp;

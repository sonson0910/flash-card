/** The message the push worker sends to an open page it cannot navigate itself (see public/firebase-messaging-sw.js). */
const OPEN_PATH_MESSAGE = 'sonflash-open-path';

/** Opens the same-origin path a worker asks for, so a reminder click lands on its page without a second window. */
export const listenForReminderOpen = (
  container: ServiceWorkerContainer | undefined = globalThis.navigator?.serviceWorker,
  location: Location = globalThis.location,
): (() => void) => {
  if (typeof container?.addEventListener !== 'function') return () => undefined;
  const handle = (event: Event) => {
    const data = (event as MessageEvent).data as { type?: unknown; path?: unknown } | null;
    if (data?.type !== OPEN_PATH_MESSAGE || typeof data.path !== 'string') return;
    if (!/^\/(?![/\\])/.test(data.path)) return;
    if (data.path !== `${location.pathname}${location.search}`) location.assign(data.path);
  };
  container.addEventListener('message', handle);
  container.startMessages?.();
  return () => container.removeEventListener('message', handle);
};

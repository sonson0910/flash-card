import { chromium, type CDPSession, type Page, type Worker } from '@playwright/test';
import { expect, test } from './fixtures/firebase-emulator';

const APP_ORIGIN = 'http://127.0.0.1:4173';
const MESSAGING_WORKER_PATH = '/firebase-messaging-sw.js';
// Firebase Messaging registers its worker under this scope, away from the offline shell worker at the root.
const MESSAGING_WORKER_SCOPE = '/firebase-cloud-messaging-push-scope';
const REMINDER_PATH = '/?view=landing&reminder=open';

/** The slice of the service worker global scope the test touches (the project compiles against the DOM lib only). */
interface WorkerNotification { data?: { path?: string } }
interface WorkerScope {
  registration: { getNotifications(): Promise<WorkerNotification[]> };
  WindowClient: { prototype: { focus(): Promise<unknown> } };
  NotificationEvent: new (type: string, init: { notification: WorkerNotification }) => Event;
  dispatchEvent(event: Event): boolean;
}

const messagingWorker = (page: Page): Worker | undefined => page.context().serviceWorkers()
  .find(worker => new URL(worker.url()).pathname === MESSAGING_WORKER_PATH);

const registerMessagingWorker = async (page: Page, cdp: CDPSession): Promise<{ worker: Worker; registrationId: string }> => {
  const registrations = new Map<string, string>();
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: updated }) => {
    for (const registration of updated) registrations.set(registration.scopeURL, registration.registrationId);
  });
  await cdp.send('ServiceWorker.enable');
  await page.evaluate(async ({ script, scope }) => {
    const registration = await navigator.serviceWorker.register(script, { scope });
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    await new Promise<void>(resolve => {
      if (!worker || worker.state === 'activated') { resolve(); return; }
      worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); });
    });
  }, { script: MESSAGING_WORKER_PATH, scope: MESSAGING_WORKER_SCOPE });
  await expect.poll(() => Boolean(messagingWorker(page))).toBe(true);
  await expect.poll(() => registrations.get(`${APP_ORIGIN}${MESSAGING_WORKER_SCOPE}`)).toBeTruthy();
  return {
    worker: messagingWorker(page)!,
    registrationId: registrations.get(`${APP_ORIGIN}${MESSAGING_WORKER_SCOPE}`)!,
  };
};

test('a reminder click makes the messaging worker hand its path to the open page, which navigates there', async ({ browserName, blockExternalNetwork }) => {
  test.skip(browserName !== 'chromium', 'Service worker targets and DevTools push delivery are Chromium only.');
  // Notification permission is only honoured by the full browser in its new headless mode, not by the
  // headless shell the default project launches.
  const browser = await chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext({ baseURL: APP_ORIGIN });
  try {
    await context.grantPermissions(['notifications'], { origin: APP_ORIGIN });
    const page = await context.newPage();
    await blockExternalNetwork(page);
    await page.goto('/?view=landing&locale=en');
    // The app registers the click relay once it has started; the reminder click is only useful after that.
    await expect(page.locator('#root')).not.toBeEmpty();
    await page.waitForLoadState('networkidle');
    const cdp = await context.newCDPSession(page);
    const { worker, registrationId } = await registerMessagingWorker(page, cdp);

    // A real push event: the worker turns the message link into the path the click will open.
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: APP_ORIGIN,
      registrationId,
      data: JSON.stringify({
        notification: { title: 'SonFlash', body: '3 cards are ready' },
        fcmOptions: { link: `${APP_ORIGIN}${REMINDER_PATH}` },
      }),
    });
    await expect.poll(() => worker.evaluate(async () => (await (globalThis as unknown as WorkerScope).registration
      .getNotifications()).map(notification => notification.data?.path))).toEqual([REMINDER_PATH]);

    // Chromium lets a worker focus or open a window only while the browser itself delivers a click, and a
    // test cannot make it do that. The click event is therefore dispatched by the test, and the focus call
    // it gates is the single thing replaced; the handler, the client lookup, the failed navigate of a page
    // this worker does not control and the postMessage to the page all run for real.
    const click = await worker.evaluate(async () => {
      const scope = globalThis as unknown as WorkerScope;
      const [notification] = await scope.registration.getNotifications();
      const originalFocus = scope.WindowClient.prototype.focus;
      scope.WindowClient.prototype.focus = function focus(this: unknown) { return Promise.resolve(this); };
      try {
        const event = new scope.NotificationEvent('notificationclick', { notification });
        let settled: Promise<unknown> | undefined;
        (event as unknown as { waitUntil(promise: Promise<unknown>): void }).waitUntil = promise => { settled = promise; };
        scope.dispatchEvent(event);
        await settled;
        return { error: null, remaining: (await scope.registration.getNotifications()).length };
      } catch (error) {
        return { error: String(error), remaining: -1 };
      } finally {
        scope.WindowClient.prototype.focus = originalFocus;
      }
    });
    expect(click).toEqual({ error: null, remaining: 0 });
    await page.waitForURL(url => url.searchParams.get('reminder') === 'open');
    expect(new URL(page.url()).pathname).toBe('/');
    expect(context.pages()).toHaveLength(1);
  } finally {
    await browser.close();
  }
});

test('a genuine browser notification click reaches the messaging worker', async () => {
  test.skip(true, 'Headless Chromium has no way to click a notification: no DevTools or Playwright call raises '
    + 'notificationclick, and WindowClient.focus or Clients.openWindow reject with "Not allowed to open a window" '
    + 'when a test dispatches the event itself. Covered by the worker unit tests and the relay test above.');
});

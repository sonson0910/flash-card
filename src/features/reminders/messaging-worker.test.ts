import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('public/firebase-messaging-sw.js', 'utf8');

describe('browser reminder worker', () => {
  it('shows one push and opens Today without following an external message link', async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn(async () => undefined);
    const openWindow = vi.fn(async () => undefined);
    const worker = {
      location: { origin: 'https://sonflash.app' },
      registration: { showNotification },
      clients: { matchAll: vi.fn(async () => []), openWindow },
      addEventListener: (name: string, listener: (event: unknown) => void) => { handlers.set(name, listener); },
    };
    runInNewContext(source, { self: worker, URL });

    let pushDone = Promise.resolve();
    handlers.get('push')?.({
      data: { json: () => ({ notification: { title: 'SonFlash', body: '3 cards are ready' },
        fcmOptions: { link: 'https://outside.example/steal' } }) },
      waitUntil: (promise: Promise<void>) => { pushDone = promise; },
    });
    await pushDone;
    expect(showNotification).toHaveBeenCalledOnce();
    expect(showNotification).toHaveBeenCalledWith('SonFlash', expect.objectContaining({
      body: '3 cards are ready', data: { path: '/?view=today' },
    }));

    let clickDone = Promise.resolve();
    handlers.get('notificationclick')?.({
      notification: { close: vi.fn(), data: { path: '/?view=today' } },
      waitUntil: (promise: Promise<void>) => { clickDone = promise; },
    });
    await clickDone;
    expect(openWindow).toHaveBeenCalledWith('/?view=today');
  });

  it('focuses an open page the push worker cannot navigate and asks it to open Today instead of opening a second window', async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const openWindow = vi.fn(async () => undefined);
    const focus = vi.fn(async () => undefined);
    const postMessage = vi.fn();
    const navigate = vi.fn(async () => { throw new TypeError('The client is not controlled by this service worker.'); });
    const worker = {
      location: { origin: 'https://sonflash.app' },
      registration: { showNotification: vi.fn() },
      clients: { matchAll: vi.fn(async () => [{ url: 'https://sonflash.app/', navigate, focus, postMessage }]), openWindow },
      addEventListener: (name: string, listener: (event: unknown) => void) => { handlers.set(name, listener); },
    };
    runInNewContext(source, { self: worker, URL });

    let clickDone = Promise.resolve();
    handlers.get('notificationclick')?.({
      notification: { close: vi.fn(), data: { path: '/?view=today' } },
      waitUntil: (promise: Promise<void>) => { clickDone = promise; },
    });
    await clickDone;

    expect(navigate).toHaveBeenCalledWith('/?view=today');
    expect(focus).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith({ type: 'sonflash-open-path', path: '/?view=today' });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens Today in a new window when an open page cannot be focused', async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const openWindow = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => { throw new TypeError('The client is not controlled by this service worker.'); });
    const focus = vi.fn(async () => { throw new TypeError('The window cannot be focused.'); });
    const worker = {
      location: { origin: 'https://sonflash.app' },
      registration: { showNotification: vi.fn() },
      clients: { matchAll: vi.fn(async () => [{ url: 'https://sonflash.app/', navigate, focus, postMessage: vi.fn() }]), openWindow },
      addEventListener: (name: string, listener: (event: unknown) => void) => { handlers.set(name, listener); },
    };
    runInNewContext(source, { self: worker, URL });

    let clickDone = Promise.resolve();
    handlers.get('notificationclick')?.({
      notification: { close: vi.fn(), data: { path: '/?view=today' } },
      waitUntil: (promise: Promise<void>) => { clickDone = promise; },
    });
    await clickDone;

    expect(openWindow).toHaveBeenCalledWith('/?view=today');
  });

  it('focuses an open page it navigated to Today instead of opening another window', async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const openWindow = vi.fn(async () => undefined);
    const focus = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    const worker = {
      location: { origin: 'https://sonflash.app' },
      registration: { showNotification: vi.fn() },
      clients: { matchAll: vi.fn(async () => [{ url: 'https://sonflash.app/', navigate, focus }]), openWindow },
      addEventListener: (name: string, listener: (event: unknown) => void) => { handlers.set(name, listener); },
    };
    runInNewContext(source, { self: worker, URL });

    let clickDone = Promise.resolve();
    handlers.get('notificationclick')?.({
      notification: { close: vi.fn(), data: { path: '/?view=today' } },
      waitUntil: (promise: Promise<void>) => { clickDone = promise; },
    });
    await clickDone;

    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });
});

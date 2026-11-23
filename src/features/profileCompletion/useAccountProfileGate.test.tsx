import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../../functions/src/account-profile-contract';
import type { AccountProfileError, AccountProfilePort, AccountProfileState } from './accountProfilePort';

vi.mock('../../lib/firebase', () => ({ app: null, db: null, getSonFlashFunctions: vi.fn() }));

const { ACCOUNT_PROFILE_ANSWER_TIMEOUT_MS, useAccountProfileGate } = await import('./useAccountProfileGate');

const profile = {
  birthYear: 1990,
  uiLocale: 'en' as const,
  nativeLanguage: 'vi' as const,
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
  consentAcceptedAt: '2026-11-19T08:30:00.000Z',
  completedAt: '2026-11-19T08:30:00.000Z',
};
const submission = {
  birthYear: 1990,
  uiLocale: 'en' as const,
  nativeLanguage: 'vi' as const,
  consent: { accepted: true as const, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION },
};

type Listener = { onState: (state: AccountProfileState) => void; onError: (error: AccountProfileError) => void; stopped: boolean };

const fakePort = () => {
  const listeners = new Map<string, Listener>();
  const subscriptions: string[] = [];
  const port: AccountProfilePort & { complete: ReturnType<typeof vi.fn>; saveUiLocale: ReturnType<typeof vi.fn> } = {
    subscribe: (ownerId, onState, onError) => {
      const listener = { onState, onError, stopped: false };
      listeners.set(ownerId, listener);
      subscriptions.push(ownerId);
      return () => { listener.stopped = true; };
    },
    complete: vi.fn(async () => ({ status: 'complete' as const, profile })),
    saveUiLocale: vi.fn(async () => undefined),
  };
  return { port, listeners, subscriptions };
};

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis,
  };
  const container = {
    nodeType: 1, ownerDocument: documentLike, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('top', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mountGate = async (ownerId: string | null, port: AccountProfilePort | null) => {
  const seen: { current: ReturnType<typeof useAccountProfileGate> | null } = { current: null };
  function Probe({ owner, sessionLost }: { owner: string | null; sessionLost: boolean }) {
    seen.current = useAccountProfileGate(owner, { port, sessionLost });
    return null;
  }
  root = createRoot(installMinimalReactDom());
  await act(async () => root!.render(<Probe owner={ownerId} sessionLost={false} />));
  const rerender = async (owner: string | null, sessionLost = false) =>
    act(async () => root!.render(<Probe owner={owner} sessionLost={sessionLost} />));
  return { seen, rerender };
};

describe('useAccountProfileGate', () => {
  it('stays signed out without an owner and loads until the port reports', async () => {
    const { port, listeners } = fakePort();
    const { seen, rerender } = await mountGate(null, port);
    expect(seen.current?.status).toBe('signed-out');

    await rerender('owner-a');
    expect(seen.current?.status).toBe('loading');
    await act(async () => listeners.get('owner-a')!.onState({ status: 'required' }));
    expect(seen.current?.status).toBe('required');
  });

  it('opens the app with the server response after a successful submit', async () => {
    const { port, listeners } = fakePort();
    const { seen } = await mountGate('owner-a', port);
    await act(async () => listeners.get('owner-a')!.onState({ status: 'required' }));

    await act(async () => { await seen.current!.submit(submission); });
    expect(port.complete).toHaveBeenCalledWith({ ...submission, ownerId: 'owner-a' });
    expect(seen.current).toMatchObject({ status: 'complete', profile });

    // A late snapshot that has not seen the new record yet must not reopen the form.
    await act(async () => listeners.get('owner-a')!.onState({ status: 'required' }));
    expect(seen.current?.status).toBe('complete');
  });

  it('stores a chosen language for the signed-in owner and ignores a failed save', async () => {
    const { port, listeners } = fakePort();
    const { seen, rerender } = await mountGate('owner-a', port);
    await act(async () => listeners.get('owner-a')!.onState({ status: 'complete', profile }));

    await act(async () => seen.current!.saveUiLocale('vi'));
    expect(port.saveUiLocale).toHaveBeenCalledWith({ ownerId: 'owner-a', uiLocale: 'vi' });

    port.saveUiLocale.mockRejectedValueOnce(new Error('offline'));
    await act(async () => seen.current!.saveUiLocale('en'));
    expect(port.saveUiLocale).toHaveBeenCalledTimes(2);

    await rerender(null);
    await act(async () => seen.current!.saveUiLocale('vi'));
    expect(port.saveUiLocale).toHaveBeenCalledTimes(2);
  });

  it('sends language saves one at a time, in order, and only the latest one waiting', async () => {
    const { port, listeners } = fakePort();
    const releases: Array<() => void> = [];
    port.saveUiLocale.mockImplementation(() => new Promise<void>(resolve => { releases.push(resolve); }));
    const { seen } = await mountGate('owner-a', port);
    await act(async () => listeners.get('owner-a')!.onState({ status: 'complete', profile }));

    await act(async () => {
      seen.current!.saveUiLocale('en');
      seen.current!.saveUiLocale('vi');
      seen.current!.saveUiLocale('en');
    });
    expect(port.saveUiLocale).toHaveBeenCalledTimes(1);
    expect(port.saveUiLocale).toHaveBeenLastCalledWith({ ownerId: 'owner-a', uiLocale: 'en' });

    await act(async () => releases.shift()!());
    expect(port.saveUiLocale).toHaveBeenCalledTimes(2);
    expect(port.saveUiLocale).toHaveBeenLastCalledWith({ ownerId: 'owner-a', uiLocale: 'en' });

    await act(async () => releases.shift()!());
    expect(port.saveUiLocale).toHaveBeenCalledTimes(2);

    await act(async () => {
      seen.current!.saveUiLocale('vi');
    });
    expect(port.saveUiLocale).toHaveBeenCalledTimes(3);
  });

  it('drops a waiting language save when the owner changed meanwhile', async () => {
    const { port, listeners } = fakePort();
    const releases: Array<() => void> = [];
    port.saveUiLocale.mockImplementation(() => new Promise<void>(resolve => { releases.push(resolve); }));
    const { seen, rerender } = await mountGate('owner-a', port);
    await act(async () => listeners.get('owner-a')!.onState({ status: 'complete', profile }));
    await act(async () => {
      seen.current!.saveUiLocale('en');
      seen.current!.saveUiLocale('vi');
    });
    await rerender('owner-b');
    await act(async () => releases.shift()!());
    expect(port.saveUiLocale).toHaveBeenCalledTimes(1);
  });

  it('shows the restricted state the server decided', async () => {
    const { port, listeners } = fakePort();
    port.complete.mockResolvedValueOnce({ status: 'restricted', restrictedAt: '2026-11-19T08:30:00.000Z' });
    const { seen } = await mountGate('owner-a', port);
    await act(async () => listeners.get('owner-a')!.onState({ status: 'required' }));

    await act(async () => { await seen.current!.submit({ ...submission, birthYear: 2012 }); });
    expect(seen.current).toMatchObject({ status: 'restricted', restrictedAt: '2026-11-19T08:30:00.000Z', profile: null });
  });

  it('never shows one owner the profile state of another', async () => {
    const { port, listeners } = fakePort();
    const { seen, rerender } = await mountGate('owner-a', port);
    await act(async () => listeners.get('owner-a')!.onState({ status: 'complete', profile }));
    expect(seen.current?.status).toBe('complete');

    await rerender('owner-b');
    expect(seen.current?.status).toBe('loading');
    expect(listeners.get('owner-a')!.stopped).toBe(true);
    await act(async () => listeners.get('owner-b')!.onState({ status: 'restricted', restrictedAt: '2026-11-19T08:30:00.000Z' }));
    expect(seen.current?.status).toBe('restricted');
  });

  it('reports read failures and resubscribes on retry', async () => {
    const { port, listeners } = fakePort();
    const { seen } = await mountGate('owner-a', port);
    const first = listeners.get('owner-a')!;
    await act(async () => first.onError(new Error('denied') as AccountProfileError));
    expect(seen.current?.status).toBe('error');

    await act(async () => seen.current!.retry());
    expect(first.stopped).toBe(true);
    expect(seen.current?.status).toBe('loading');
    await act(async () => listeners.get('owner-a')!.onState({ status: 'complete', profile }));
    expect(seen.current?.status).toBe('complete');
  });

  it('fails closed when cloud access is not configured', async () => {
    const { seen } = await mountGate('owner-a', null);
    expect(seen.current?.status).toBe('error');
  });

  it('keeps a completed profile when the listener later fails, as when Auth drops the session', async () => {
    const { port, listeners } = fakePort();
    const { seen } = await mountGate('owner-a', port);
    await act(async () => listeners.get('owner-a')!.onState({ status: 'complete', profile }));

    await act(async () => listeners.get('owner-a')!.onError(new Error('permission-denied') as AccountProfileError));
    expect(seen.current).toMatchObject({ status: 'complete', profile });
  });

  it('keeps a restriction when the listener later fails', async () => {
    const { port, listeners } = fakePort();
    const { seen } = await mountGate('owner-a', port);
    await act(async () => listeners.get('owner-a')!.onState({ status: 'restricted', restrictedAt: '2026-11-19T08:30:00.000Z' }));

    await act(async () => listeners.get('owner-a')!.onError(new Error('permission-denied') as AccountProfileError));
    expect(seen.current).toMatchObject({ status: 'restricted', restrictedAt: '2026-11-19T08:30:00.000Z' });
  });

  it('stops listening while the session is lost and listens again after the learner signs in again', async () => {
    const { port, listeners, subscriptions } = fakePort();
    const { seen, rerender } = await mountGate('owner-a', port);
    const first = listeners.get('owner-a')!;
    await act(async () => first.onState({ status: 'complete', profile }));

    await rerender('owner-a', true);
    expect(first.stopped).toBe(true);
    expect(subscriptions).toEqual(['owner-a']);
    expect(seen.current?.status).toBe('complete');

    await rerender('owner-a', false);
    expect(subscriptions).toEqual(['owner-a', 'owner-a']);
    const second = listeners.get('owner-a')!;
    expect(second).not.toBe(first);
    expect(second.stopped).toBe(false);
    expect(seen.current?.status).toBe('complete');
  });

  it('reads the server again after sign-out, so a cleared restriction no longer shows', async () => {
    const { port, listeners } = fakePort();
    const { seen, rerender } = await mountGate('owner-a', port);
    await act(async () => listeners.get('owner-a')!.onState({ status: 'restricted', restrictedAt: '2026-11-19T08:30:00.000Z' }));

    await rerender(null);
    expect(seen.current?.status).toBe('signed-out');
    await rerender('owner-a');
    expect(seen.current?.status).toBe('loading');
    await act(async () => listeners.get('owner-a')!.onState({ status: 'required' }));
    expect(seen.current?.status).toBe('required');
  });

  it('does not publish a submit result into a later sign-in of the same account', async () => {
    const { port, listeners } = fakePort();
    let resolve!: (value: unknown) => void;
    port.complete.mockImplementationOnce(() => new Promise(next => { resolve = next; }));
    const { seen, rerender } = await mountGate('owner-a', port);
    await act(async () => listeners.get('owner-a')!.onState({ status: 'required' }));
    let pending!: Promise<unknown>;
    await act(async () => { pending = seen.current!.submit({ ...submission, birthYear: 2012 }); });

    await rerender(null);
    await rerender('owner-a');
    await act(async () => {
      resolve({ status: 'restricted', restrictedAt: '2026-11-19T08:30:00.000Z' });
      await pending;
    });
    expect(seen.current?.status).toBe('loading');
  });

  it('offers a retry when no confirmed answer arrives in time, and a later answer still wins', async () => {
    vi.useFakeTimers();
    const { port, listeners } = fakePort();
    const { seen } = await mountGate('owner-a', port);
    await act(async () => { vi.advanceTimersByTime(ACCOUNT_PROFILE_ANSWER_TIMEOUT_MS - 1); });
    expect(seen.current?.status).toBe('loading');
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(seen.current?.status).toBe('error');

    await act(async () => listeners.get('owner-a')!.onState({ status: 'complete', profile }));
    expect(seen.current?.status).toBe('complete');
  });

  it('never times out once an answer arrived', async () => {
    vi.useFakeTimers();
    const { port, listeners } = fakePort();
    const { seen } = await mountGate('owner-a', port);
    await act(async () => listeners.get('owner-a')!.onState({ status: 'required' }));
    await act(async () => { vi.advanceTimersByTime(ACCOUNT_PROFILE_ANSWER_TIMEOUT_MS * 2); });
    expect(seen.current?.status).toBe('required');
  });
});

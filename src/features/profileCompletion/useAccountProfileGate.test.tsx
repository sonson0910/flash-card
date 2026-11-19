import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../../functions/src/account-profile-contract';
import type { AccountProfileError, AccountProfilePort, AccountProfileState } from './accountProfilePort';

vi.mock('../../lib/firebase', () => ({ app: null, db: null, getSonFlashFunctions: vi.fn() }));

const { useAccountProfileGate } = await import('./useAccountProfileGate');

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
  const port: AccountProfilePort & { complete: ReturnType<typeof vi.fn> } = {
    subscribe: (ownerId, onState, onError) => {
      const listener = { onState, onError, stopped: false };
      listeners.set(ownerId, listener);
      return () => { listener.stopped = true; };
    },
    complete: vi.fn(async () => ({ status: 'complete' as const, profile })),
  };
  return { port, listeners };
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
  vi.unstubAllGlobals();
});

const mountGate = async (ownerId: string | null, port: AccountProfilePort | null) => {
  const seen: { current: ReturnType<typeof useAccountProfileGate> | null } = { current: null };
  function Probe({ owner }: { owner: string | null }) {
    seen.current = useAccountProfileGate(owner, port);
    return null;
  }
  root = createRoot(installMinimalReactDom());
  await act(async () => root!.render(<Probe owner={ownerId} />));
  const rerender = async (owner: string | null) => act(async () => root!.render(<Probe owner={owner} />));
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
});

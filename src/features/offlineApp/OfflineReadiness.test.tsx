import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  installOfflineAppShell,
  OfflineReadiness,
} from './OfflineReadiness';

const activatedWorker = { state: 'activated' } as ServiceWorker;

const registration = {
  active: activatedWorker,
  installing: null,
  waiting: null,
} as unknown as ServiceWorkerRegistration;

describe('OfflineReadiness', () => {
  it('shows the user-gesture preparation affordance and bounded shell size', () => {
    const html = renderToStaticMarkup(<OfflineReadiness production serviceWorker={undefined} />);

    expect(html).toContain('Prepare offline');
    expect(html).toContain('app files, up to 4 MiB');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="false"');
  });

  it('does not offer registration from a development build', () => {
    const register = vi.fn();
    const html = renderToStaticMarkup(<OfflineReadiness
      production={false}
      serviceWorker={{ register } as unknown as ServiceWorkerContainer}
    />);

    expect(html).not.toContain('Prepare offline');
    expect(html).toContain('production build');
    expect(register).not.toHaveBeenCalled();
  });

  it('registers the root worker without using the HTTP cache and waits for activation', async () => {
    const register = vi.fn(async () => registration);
    const serviceWorker = {
      register,
      ready: Promise.resolve(registration),
    } as unknown as ServiceWorkerContainer;

    await expect(installOfflineAppShell(serviceWorker, 50)).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
  });

  it('does not resolve before an active worker is available', async () => {
    let resolveReady!: (value: ServiceWorkerRegistration) => void;
    const ready = new Promise<ServiceWorkerRegistration>(resolve => { resolveReady = resolve; });
    const serviceWorker = {
      register: vi.fn(async () => ({ active: null } as unknown as ServiceWorkerRegistration)),
      ready,
    } as unknown as ServiceWorkerContainer;

    const pending = installOfflineAppShell(serviceWorker, 50);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveReady(registration);
    await expect(pending).resolves.toBe(registration);
  });

  it('surfaces registration failures as retryable errors', async () => {
    const serviceWorker = {
      register: vi.fn(async () => { throw new Error('storage denied'); }),
      ready: Promise.resolve(registration),
    } as unknown as ServiceWorkerContainer;

    await expect(installOfflineAppShell(serviceWorker, 50)).rejects.toThrow('storage denied');
  });

  it('renders an already available shell state without another registration request', () => {
    const html = renderToStaticMarkup(<OfflineReadiness
      production
      registration={registration}
      serviceWorker={undefined}
    />);

    expect(html).toContain('Available offline');
    expect(html).not.toContain('app files, up to 4 MiB');
  });

  it('advises reopening after a waiting update instead of forcing activation', () => {
    const waitingRegistration = {
      active: activatedWorker,
      installing: null,
      waiting: { state: 'installed' },
    } as unknown as ServiceWorkerRegistration;
    const html = renderToStaticMarkup(<OfflineReadiness
      production
      registration={waitingRegistration}
      serviceWorker={undefined}
    />);

    expect(html).toContain('Update available');
    expect(html).toContain('Reopen SonFlash after your study session');
    expect(html).not.toContain('skipWaiting');
    expect(html).not.toContain('clients.claim');
  });
});

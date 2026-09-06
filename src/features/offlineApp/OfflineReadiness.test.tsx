import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
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

class FakeElement {
  readonly nodeType: number = 1;
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
  readonly childNodes: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style = { setProperty: vi.fn(), removeProperty: vi.fn() };
  parentNode: FakeElement | null = null;
  ownerDocument!: Record<string, unknown>;
  textContent = '';

  constructor(readonly tagName: string) {}

  get nodeName() { return this.tagName.toUpperCase(); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get nextSibling() {
    const index = this.parentNode?.childNodes.indexOf(this) ?? -1;
    return index >= 0 ? this.parentNode?.childNodes[index + 1] ?? null : null;
  }
  appendChild<T extends FakeElement>(child: T): T {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore<T extends FakeElement>(child: T, before: FakeElement | null): T {
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }
  removeChild<T extends FakeElement>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  addEventListener() {}
  removeEventListener() {}
}

class FakeTextNode extends FakeElement {
  readonly nodeType: number = 3;

  constructor(readonly text: string) { super('#text'); }
}

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    createElement: (tagName: string) => {
      const element = new FakeElement(tagName);
      element.ownerDocument = documentLike;
      return element;
    },
    createElementNS: (_namespace: string, tagName: string) => {
      const element = new FakeElement(tagName);
      element.ownerDocument = documentLike;
      return element;
    },
    createTextNode: (text: string) => {
      const node = new FakeTextNode(text);
      node.ownerDocument = documentLike;
      return node;
    },
    createComment: (text: string) => {
      const node = new FakeTextNode(text);
      node.ownerDocument = documentLike;
      return node;
    },
  };
  const container = new FakeElement('div');
  container.ownerDocument = documentLike;
  documentLike.documentElement = container;
  documentLike.body = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('Node', FakeElement);
  return container;
};

const findElement = (node: FakeElement, predicate: (candidate: FakeElement) => boolean): FakeElement | null => {
  if (predicate(node)) return node;
  for (const child of node.childNodes) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
};

const textContent = (node: FakeElement): string => (
  node.childNodes.length === 0
    ? node.textContent
    : node.childNodes.map(child => child.tagName === '#text' ? (child as FakeTextNode).text : textContent(child)).join('')
);

const invokeClick = (element: FakeElement) => {
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
  const props = propsKey
    ? (element as unknown as Record<string, unknown>)[propsKey] as { onClick?: (event: unknown) => void }
    : undefined;
  if (!props?.onClick) throw new Error('React click handler was not attached.');
  props.onClick({ currentTarget: element, preventDefault: () => undefined, stopPropagation: () => undefined });
};

const flushReact = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

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

  it('does not report ready until the active worker reaches activated', async () => {
    let statechange!: () => void;
    const activatingWorker = {
      state: 'activating',
      addEventListener: vi.fn((_type: string, listener: () => void) => { statechange = listener; }),
      removeEventListener: vi.fn(),
    } as unknown as ServiceWorker;
    const activatingRegistration = {
      active: activatingWorker,
    } as unknown as ServiceWorkerRegistration;
    const serviceWorker = {
      register: vi.fn(async () => activatingRegistration),
      ready: Promise.resolve(activatingRegistration),
    } as unknown as ServiceWorkerContainer;

    const pending = installOfflineAppShell(serviceWorker, 50);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await expect.poll(() => typeof statechange === 'function').toBe(true);
    expect(settled).toBe(false);

    (activatingWorker as ServiceWorker & { state: string }).state = 'activated';
    statechange();
    await expect(pending).resolves.toBe(activatingRegistration);
  });

  it('waits for a newly installing candidate instead of accepting an older active worker', async () => {
    let statechange!: () => void;
    const installingWorker = {
      state: 'installing',
      addEventListener: vi.fn((_type: string, listener: () => void) => { statechange = listener; }),
      removeEventListener: vi.fn(),
    } as unknown as ServiceWorker;
    const updatingRegistration = {
      active: activatedWorker,
      installing: installingWorker,
      waiting: null,
    } as unknown as ServiceWorkerRegistration;
    const serviceWorker = {
      register: vi.fn(async () => updatingRegistration),
      ready: Promise.resolve({ active: activatedWorker } as ServiceWorkerRegistration),
    } as unknown as ServiceWorkerContainer;

    const pending = installOfflineAppShell(serviceWorker, 50);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await expect.poll(() => typeof statechange === 'function').toBe(true);
    expect(settled).toBe(false);

    (installingWorker as ServiceWorker & { state: string }).state = 'installed';
    (updatingRegistration as ServiceWorkerRegistration & { installing: ServiceWorker | null; waiting: ServiceWorker | null }).installing = null;
    (updatingRegistration as ServiceWorkerRegistration & { waiting: ServiceWorker | null }).waiting = installingWorker;
    statechange();
    await expect(pending).resolves.toBe(updatingRegistration);
  });

  it('fails when a newly installing candidate becomes redundant', async () => {
    let statechange!: () => void;
    const redundantWorker = {
      state: 'installing',
      addEventListener: vi.fn((_type: string, listener: () => void) => { statechange = listener; }),
      removeEventListener: vi.fn(),
    } as unknown as ServiceWorker;
    const updatingRegistration = {
      active: activatedWorker,
      installing: redundantWorker,
      waiting: null,
    } as unknown as ServiceWorkerRegistration;
    const serviceWorker = {
      register: vi.fn(async () => updatingRegistration),
      ready: Promise.resolve({ active: activatedWorker } as ServiceWorkerRegistration),
    } as unknown as ServiceWorkerContainer;

    const pending = installOfflineAppShell(serviceWorker, 50);
    await expect.poll(() => typeof statechange === 'function').toBe(true);
    (redundantWorker as ServiceWorker & { state: string }).state = 'redundant';
    statechange();
    await expect(pending).rejects.toThrow('redundant');
  });

  it('bounds a candidate that never reaches an installed state', async () => {
    const installingWorker = {
      state: 'installing',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as ServiceWorker;
    const updatingRegistration = {
      active: activatedWorker,
      installing: installingWorker,
      waiting: null,
    } as unknown as ServiceWorkerRegistration;
    const serviceWorker = {
      register: vi.fn(async () => updatingRegistration),
      ready: Promise.resolve({ active: activatedWorker } as ServiceWorkerRegistration),
    } as unknown as ServiceWorkerContainer;

    await expect(installOfflineAppShell(serviceWorker, 10)).rejects.toThrow('timed out');
  });

  it('reports a newly registered candidate before delayed activation times out', async () => {
    vi.useFakeTimers();
    const installingWorker = {
      state: 'installing',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as ServiceWorker;
    const delayedRegistration = {
      active: null,
      installing: installingWorker,
      waiting: null,
    } as unknown as ServiceWorkerRegistration;
    const serviceWorker = {
      register: vi.fn(async () => delayedRegistration),
      ready: new Promise<ServiceWorkerRegistration>(() => undefined),
    } as unknown as ServiceWorkerContainer;
    const onRegistration = vi.fn();

    try {
      const pending = installOfflineAppShell(serviceWorker, 50, onRegistration);
      await Promise.resolve();
      await Promise.resolve();
      expect(onRegistration).toHaveBeenCalledWith(delayedRegistration);

      const rejected = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a delayed candidate preparing after the UI timeout until activation', async () => {
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    let workerState: ServiceWorkerState = 'installing';
    let currentActive: ServiceWorker | null = null;
    let currentInstalling: ServiceWorker | null = null;
    const stateListeners = new Set<() => void>();
    const installingWorker = {
      get state() { return workerState; },
      addEventListener: vi.fn((_type: string, listener: () => void) => { stateListeners.add(listener); }),
      removeEventListener: vi.fn((_type: string, listener: () => void) => { stateListeners.delete(listener); }),
    } as unknown as ServiceWorker;
    currentInstalling = installingWorker;
    const delayedRegistration = {
      get active() { return currentActive; },
      get installing() { return currentInstalling; },
      waiting: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as ServiceWorkerRegistration;
    let resolveLookup!: (value: ServiceWorkerRegistration | null) => void;
    let resolveReady!: (value: ServiceWorkerRegistration) => void;
    const serviceWorker = {
      register: vi.fn(async () => delayedRegistration),
      getRegistration: vi.fn(() => new Promise<ServiceWorkerRegistration | null>(resolve => { resolveLookup = resolve; })),
      ready: new Promise<ServiceWorkerRegistration>(resolve => { resolveReady = resolve; }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as ServiceWorkerContainer;
    vi.useFakeTimers();

    try {
      await act(async () => {
        root.render(createElement(OfflineReadiness, { production: true, serviceWorker }));
        await flushReact();
      });
      const button = findElement(container, candidate => (
        candidate.tagName === 'button' && textContent(candidate) === 'Prepare offline'
      ));
      if (!button) throw new Error('Prepare offline button was not rendered.');
      await act(async () => {
        invokeClick(button);
        await flushReact();
      });
      expect(serviceWorker.register).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
        await flushReact();
      });
      expect(textContent(container)).toContain('Preparing app files for offline use');
      expect(textContent(container)).not.toContain('Offline preparation failed');

      resolveLookup(null);
      await act(async () => {
        await flushReact();
      });
      workerState = 'activated';
      currentActive = installingWorker;
      currentInstalling = null;
      await act(async () => {
        for (const listener of stateListeners) listener();
        await flushReact();
      });
      expect(textContent(container)).toContain('Available offline.');
    } finally {
      resolveReady?.(delayedRegistration);
      await act(async () => root.unmount());
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
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

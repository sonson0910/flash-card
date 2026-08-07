import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserCapabilitiesController,
  type BrowserCapabilitiesPort,
  type BrowserHeading,
} from './useBrowserCapabilities';

const createFakeBrowser = () => {
  let online = true;
  let saveData = false;
  let activeElement: unknown = null;
  const networkListeners = new Set<(value: boolean) => void>();
  const saveDataListeners = new Set<(value: boolean) => void>();
  const frames = new Map<number, () => void>();
  const visibilityObservers = new Map<unknown, () => void>();
  let nextFrame = 1;
  const port: BrowserCapabilitiesPort = {
    readOnline: () => online,
    listenOnline: listener => {
      networkListeners.add(listener);
      return () => networkListeners.delete(listener);
    },
    readSaveData: () => saveData,
    listenSaveData: listener => {
      saveDataListeners.add(listener);
      return () => saveDataListeners.delete(listener);
    },
    applySaveDataDataset: vi.fn(),
    requestFrame: callback => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: handle => { frames.delete(handle as number); },
    isVisible: heading => heading.isConnected && heading.visible !== false,
    getActiveElement: () => activeElement,
    observeVisibility: (target, listener) => {
      visibilityObservers.set(target, listener);
      return () => { visibilityObservers.delete(target); };
    },
  };
  return {
    port,
    setOnline(value: boolean) {
      online = value;
      networkListeners.forEach(listener => listener(value));
    },
    setSaveData(value: boolean) {
      saveData = value;
      saveDataListeners.forEach(listener => listener(value));
    },
    setActiveElement(value: unknown) { activeElement = value; },
    flushFrames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback());
    },
    reveal(target: unknown) { visibilityObservers.get(target)?.(); },
    get frameCount() { return frames.size; },
    get observerCount() { return visibilityObservers.size; },
  };
};

const createHeading = () => {
  const target = {};
  const heading: BrowserHeading = {
    isConnected: true,
    visible: true,
    focus: vi.fn(),
    scrollIntoView: vi.fn(),
    closest: vi.fn(() => target),
  };
  return { heading, target };
};

describe('browser capabilities controller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the hook boundary vendor-free and compact', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useBrowserCapabilities.ts', import.meta.url)),
      'utf8',
    );
    const fake = createFakeBrowser();
    const controller = createBrowserCapabilitiesController(fake.port);

    expect(source).toMatch(/useSyncExternalStore/);
    expect(source).not.toMatch(/firebase|Firestore|Dispatch|SetStateAction/i);
    expect(Object.keys(controller.actions).some(key => key.startsWith('set'))).toBe(false);
  });

  it('owns online and save-data subscriptions and cleans the root dataset on stop', () => {
    const fake = createFakeBrowser();
    const controller = createBrowserCapabilitiesController(fake.port);
    controller.start();

    expect(controller.getSnapshot()).toMatchObject({ isOnline: true, saveData: false });
    expect(fake.port.applySaveDataDataset).toHaveBeenCalledWith(false);
    fake.setOnline(false);
    fake.setSaveData(true);
    expect(controller.getSnapshot()).toMatchObject({ isOnline: false, saveData: true });
    expect(fake.port.applySaveDataDataset).toHaveBeenLastCalledWith(true);

    controller.stop();
    expect(fake.port.applySaveDataDataset).toHaveBeenLastCalledWith(false);
    fake.setOnline(true);
    expect(controller.getSnapshot().isOnline).toBe(false);
  });

  it('bumps hydration generation once per owner transition and on explicit invalidation', () => {
    const fake = createFakeBrowser();
    const controller = createBrowserCapabilitiesController(fake.port);

    controller.actions.changeOwner(null);
    expect(controller.getSnapshot().hydrationGeneration).toBe(1);
    controller.actions.changeOwner(null);
    expect(controller.getSnapshot().hydrationGeneration).toBe(1);
    controller.actions.changeOwner('owner-1');
    expect(controller.refs.hydrationGeneration.current).toBe(2);
    expect(controller.actions.bumpHydrationSession()).toBe(3);
    expect(controller.actions.isHydrationSessionCurrent(2)).toBe(false);
    expect(controller.actions.isHydrationSessionCurrent(3)).toBe(true);
  });

  it('focuses a changed page only after loading completes', () => {
    const fake = createFakeBrowser();
    const controller = createBrowserCapabilitiesController(fake.port);
    const { heading } = createHeading();
    vi.mocked(heading.focus).mockImplementation(() => fake.setActiveElement(heading));

    controller.sequencePageFocus({ page: 2, isLoading: true, heading });
    expect(fake.frameCount).toBe(0);
    controller.sequencePageFocus({ page: 2, isLoading: false, heading });
    expect(fake.frameCount).toBe(1);
    fake.flushFrames();
    expect(heading.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true });

    controller.sequencePageFocus({ page: 2, isLoading: false, heading });
    expect(fake.frameCount).toBe(0);
  });

  it('retries a requested library focus when animation visibility becomes usable', () => {
    const fake = createFakeBrowser();
    const controller = createBrowserCapabilitiesController(fake.port);
    const { heading, target } = createHeading();
    heading.visible = false;
    vi.mocked(heading.focus).mockImplementation(() => fake.setActiveElement(heading));

    controller.actions.requestLibraryFocus();
    controller.sequenceRequestedFocus({ view: 'study', isBusy: false, heading });
    expect(fake.observerCount).toBe(0);
    controller.sequenceRequestedFocus({ view: 'library', isBusy: false, heading });
    expect(fake.observerCount).toBe(1);
    expect(heading.focus).not.toHaveBeenCalled();

    heading.visible = true;
    fake.reveal(target);
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(fake.observerCount).toBe(0);
  });

  it('cancels pending focus work when disposed', () => {
    const fake = createFakeBrowser();
    const controller = createBrowserCapabilitiesController(fake.port);
    const { heading } = createHeading();
    heading.visible = false;
    controller.actions.requestLibraryFocus();
    controller.sequencePageFocus({ page: 2, isLoading: false, heading });
    controller.sequenceRequestedFocus({ view: 'library', isBusy: false, heading });
    expect(fake.frameCount).toBe(1);
    expect(fake.observerCount).toBe(1);

    controller.stop();
    expect(fake.frameCount).toBe(0);
    expect(fake.observerCount).toBe(0);
  });
});

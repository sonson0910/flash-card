import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({ id: 'owner-a' as string | null, onChange: undefined as ((ownerId: string | null) => void) | undefined }));
const reminders = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), canOfferPush: vi.fn() }));

vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message: string }) => message,
  useLingui: () => ({ _: (value: { message?: string } | string) => typeof value === 'string' ? value : value.message ?? '' }),
}));
vi.mock('../../i18n/I18nProvider', () => ({ useUiLocale: () => 'en' }));
vi.mock('../session/ownerSessionPort', () => ({
  currentOwnerId: () => owner.id,
  observeOwner: (onChange: (ownerId: string | null) => void) => { owner.onChange = onChange; return vi.fn(); },
  protectedFunctionsAvailable: () => true,
}));
vi.mock('./reminderService', () => ({
  canOfferBrowserPush: reminders.canOfferPush,
  defaultReminderSettings: () => ({ days: [1], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null, onlyIfNotStudiedToday: true, channels: { push: false, emailDigest: false } }),
  loadReminderSettings: reminders.load,
  saveReminderSettings: reminders.save,
}));

import { ReminderSettingsSection, emailDigestDeliveryAvailable, reminderSettingsForSave, type ReminderSettingsSectionProps } from './ReminderSettingsSection';

const installMinimalReactDom = () => {
  type NodeLike = ElementNode | TextNode;
  type DocumentLike = {
    nodeType: number; activeElement: ElementNode | null; defaultView: typeof globalThis; documentElement: ElementNode;
    createElement(tagName: string): ElementNode; createElementNS(namespace: string, tagName: string): ElementNode;
    createTextNode(text: string): TextNode; addEventListener(): void; removeEventListener(): void;
  };
  class TextNode {
    readonly nodeType = 3; readonly nodeName = '#text'; parentNode: ElementNode | null = null; ownerDocument!: DocumentLike;
    constructor(public nodeValue: string) {}
    get textContent() { return this.nodeValue; }
    set textContent(value: string) { this.nodeValue = value; }
  }
  class ElementNode {
    readonly nodeType = 1; readonly nodeName: string; readonly tagName: string; readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
    readonly childNodes: NodeLike[] = []; readonly attributes = new Map<string, string>(); parentNode: ElementNode | null = null;
    ownerDocument!: DocumentLike; style = {}; value = ''; private disabledValue = false;
    constructor(tagName: string) { this.nodeName = tagName.toUpperCase(); this.tagName = this.nodeName; }
    appendChild(child: NodeLike) { child.parentNode = this; this.childNodes.push(child); return child; }
    insertBefore(child: NodeLike, before: NodeLike | null) { child.parentNode = this; const index = before ? this.childNodes.indexOf(before) : -1; if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child); return child; }
    removeChild(child: NodeLike) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    get disabled() { return this.disabledValue; }
    set disabled(value: boolean) { this.disabledValue = value; }
    addEventListener() {}
    removeEventListener() {}
    click() { const key = Object.keys(this).find(name => name.startsWith('__reactProps$')); (key ? (this as unknown as Record<string, { onClick?: () => void }>)[key]?.onClick : undefined)?.(); }
    get textContent(): string { return this.childNodes.map(child => child.textContent).join(''); }
    set textContent(value: string) { this.childNodes.length = 0; if (value) this.appendChild(this.ownerDocument.createTextNode(value)); }
  }
  const documentLike: DocumentLike = {
    nodeType: 9, activeElement: null, defaultView: globalThis, documentElement: null!,
    createElement: tagName => { const element = new ElementNode(tagName); element.ownerDocument = documentLike; return element; },
    createElementNS: (_namespace, tagName) => documentLike.createElement(tagName),
    createTextNode: text => { const node = new TextNode(text); node.ownerDocument = documentLike; return node; },
    addEventListener() {}, removeEventListener() {},
  };
  const container = documentLike.createElement('div');
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis); vi.stubGlobal('self', globalThis); vi.stubGlobal('top', globalThis); vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLElement', ElementNode); vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement extends ElementNode {}); vi.stubGlobal('Node', ElementNode);
  return container;
};

type Mounted = { container: ReturnType<typeof installMinimalReactDom>; root: Root };
const mount = (props: ReminderSettingsSectionProps = {}): Mounted => {
  const container = installMinimalReactDom();
  const root = createRoot(container as unknown as Element);
  act(() => root.render(<ReminderSettingsSection {...props} />));
  return { container, root };
};
const find = (container: ReturnType<typeof installMinimalReactDom>, tagName: string, label: string) => {
  const visit = (node: typeof container): typeof container | undefined => {
    if (node.tagName === tagName && node.textContent.includes(label)) return node;
    return node.childNodes.filter((child): child is typeof container => child.nodeType === 1).map(visit).find(Boolean);
  };
  return visit(container);
};
const inputWithValue = (container: ReturnType<typeof installMinimalReactDom>, value: string) => {
  const visit = (node: typeof container): typeof container | undefined => {
    if (node.tagName === 'INPUT' && node.value === value) return node;
    return node.childNodes.filter((child): child is typeof container => child.nodeType === 1).map(visit).find(Boolean);
  };
  return visit(container);
};
const reactProps = (element: ReturnType<typeof installMinimalReactDom>) => {
  const key = Object.keys(element).find(name => name.startsWith('__reactProps$'));
  return key ? (element as unknown as Record<string, { disabled?: boolean }>)[key] : undefined;
};
const unmount = ({ root }: Mounted) => act(() => root.unmount());

beforeEach(() => {
  owner.id = 'owner-a'; owner.onChange = undefined;
  reminders.load.mockReset(); reminders.save.mockReset(); reminders.canOfferPush.mockReset().mockResolvedValue(false);
  vi.unstubAllEnvs();
});
afterEach(() => vi.unstubAllGlobals());

describe('weekly email digest availability', () => {
  it('fails closed unless explicitly enabled and strips an existing enabled setting before save', () => {
    vi.stubEnv('VITE_REMINDER_EMAIL_ENABLED', '');
    const settings = { days: [1], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en' as const, quietHours: null, onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: true } };
    expect(emailDigestDeliveryAvailable()).toBe(false);
    expect(reminderSettingsForSave(settings).channels).toEqual({ push: true, emailDigest: false });
  });

  it('allows email digest settings only when explicitly configured', () => {
    vi.stubEnv('VITE_REMINDER_EMAIL_ENABLED', 'true');
    const settings = { days: [1], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en' as const, quietHours: null, onlyIfNotStudiedToday: true, channels: { push: false, emailDigest: true } };
    expect(emailDigestDeliveryAvailable()).toBe(true);
    expect(reminderSettingsForSave(settings)).toBe(settings);
  });
});

describe('reminder settings mounted lifecycle', () => {
  const loadedSettings = { days: [1], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en' as const, quietHours: null, onlyIfNotStudiedToday: true, channels: { push: false, emailDigest: false } };

  it('loads the onboarding owner on mount and replaces stale owner results after an owner switch', async () => {
    let resolveFirst!: (settings: typeof loadedSettings) => void;
    let resolveSecond!: (settings: typeof loadedSettings) => void;
    reminders.load.mockImplementationOnce(() => new Promise<typeof loadedSettings>(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<typeof loadedSettings>(resolve => { resolveSecond = resolve; }));
    const mounted = mount({ initialOwnerId: 'owner-a' });
    try {
      expect(mounted.container.textContent).toContain('Loading reminders…');
      await act(async () => { owner.id = 'owner-b'; owner.onChange?.('owner-b'); });
      resolveFirst({ ...loadedSettings, sendAtLocal: '09:00' });
      await act(async () => {});
      expect(mounted.container.textContent).toContain('Loading reminders…');
      resolveSecond({ ...loadedSettings, sendAtLocal: '18:00' });
      await act(async () => {});
      expect(reminders.load).toHaveBeenNthCalledWith(1, 'owner-a');
      expect(reminders.load).toHaveBeenNthCalledWith(2, 'owner-b');
      expect(inputWithValue(mounted.container, '18:00')).toBeDefined();
      expect(inputWithValue(mounted.container, '09:00')).toBeUndefined();
    } finally { unmount(mounted); }
  });

  it('recovers from an initial load failure when Retry reloads the current owner', async () => {
    const recoveredSettings = { ...loadedSettings, sendAtLocal: '17:00' };
    reminders.load.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(recoveredSettings);
    const mounted = mount();
    try {
      await act(async () => {});
      expect(mounted.container.textContent).toContain('Reminders are unavailable right now. Try again later.');
      const retry = find(mounted.container, 'BUTTON', 'Retry');
      expect(retry).toBeDefined();
      await act(async () => retry?.click());
      expect(reminders.load).toHaveBeenNthCalledWith(1, 'owner-a');
      expect(reminders.load).toHaveBeenNthCalledWith(2, 'owner-a');
      expect(inputWithValue(mounted.container, '17:00')).toBeDefined();
      expect(mounted.container.textContent).not.toContain('Reminders are unavailable right now. Try again later.');
    } finally { unmount(mounted); }
  });

  it('disables Save while pending, then publishes saved settings when the promise resolves', async () => {
    let finishSave!: (settings: typeof loadedSettings) => void;
    const onSaveStateChange = vi.fn();
    reminders.load.mockResolvedValue(loadedSettings);
    reminders.save.mockImplementationOnce(() => new Promise<typeof loadedSettings>(resolve => { finishSave = resolve; }));
    const mounted = mount({ onSaveStateChange });
    try {
      await act(async () => {});
      const save = find(mounted.container, 'BUTTON', 'Save reminders');
      expect(save).toBeDefined();
      await act(async () => save?.click());
      const pendingSave = find(mounted.container, 'BUTTON', 'Save reminders');
      expect(reactProps(pendingSave!)?.disabled).toBe(true);
      expect(onSaveStateChange).toHaveBeenCalledWith({ saving: true, failed: false });
      finishSave({ ...loadedSettings, sendAtLocal: '10:30' });
      await act(async () => {});
      expect(mounted.container.textContent).toContain('Reminder settings saved.');
      expect(inputWithValue(mounted.container, '10:30')).toBeDefined();
      expect(onSaveStateChange).toHaveBeenCalledWith({ saving: false, failed: false });
    } finally { unmount(mounted); }
  });

  it('shows a failed save, retries successfully, and clears the failure lifecycle', async () => {
    const onSaveStateChange = vi.fn();
    reminders.load.mockResolvedValue(loadedSettings);
    reminders.save.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(loadedSettings);
    const mounted = mount({ onSaveStateChange, onSkip: vi.fn() });
    try {
      await act(async () => {});
      await act(async () => find(mounted.container, 'BUTTON', 'Save reminders')?.click());
      expect(mounted.container.textContent).toContain('offline');
      expect(find(mounted.container, 'BUTTON', 'Skip for now')).toBeDefined();
      expect(onSaveStateChange).toHaveBeenCalledWith({ saving: false, failed: true });
      await act(async () => find(mounted.container, 'BUTTON', 'Save reminders')?.click());
      expect(mounted.container.textContent).toContain('Reminder settings saved.');
      expect(mounted.container.textContent).not.toContain('offline');
      expect(find(mounted.container, 'BUTTON', 'Skip for now')).toBeUndefined();
      expect(onSaveStateChange).toHaveBeenCalledWith({ saving: false, failed: false });
    } finally { unmount(mounted); }
  });

  it('clears a failed save when Skip for now is clicked and notifies its owner', async () => {
    const onSkip = vi.fn();
    reminders.load.mockResolvedValue(loadedSettings);
    reminders.save.mockRejectedValueOnce(new Error('offline'));
    const mounted = mount({ onSkip });
    try {
      await act(async () => {});
      await act(async () => find(mounted.container, 'BUTTON', 'Save reminders')?.click());
      await act(async () => find(mounted.container, 'BUTTON', 'Skip for now')?.click());
      expect(onSkip).toHaveBeenCalledOnce();
      expect(mounted.container.textContent).not.toContain('offline');
      expect(find(mounted.container, 'BUTTON', 'Skip for now')).toBeUndefined();
    } finally { unmount(mounted); }
  });
});

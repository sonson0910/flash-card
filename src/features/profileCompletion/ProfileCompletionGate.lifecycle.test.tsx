import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../../functions/src/account-profile-contract';
import type { AccountProfileState } from './accountProfilePort';

const ui = vi.hoisted(() => ({ setUiLocale: vi.fn(async (_locale: string) => undefined) }));

vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message?: string }) => message ?? '',
  useLingui: () => ({ _: (value: { message?: string } | string) => typeof value === 'string' ? value : value.message ?? '' }),
}));
vi.mock('../../i18n/I18nProvider', () => ({ useUiLocale: () => 'en', useSetUiLocale: () => ui.setUiLocale }));
vi.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({ family: 'classic' }) }));
vi.mock('../../lib/firebase', () => ({ app: null, db: null, getSonFlashFunctions: vi.fn() }));

const { ProfileCompletionGate } = await import('./ProfileCompletionGate');

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
    ownerDocument!: DocumentLike; style = {}; value = ''; checked = false; selected = false; defaultSelected = false; disabled = false;
    constructor(tagName: string) { this.nodeName = tagName.toUpperCase(); this.tagName = this.nodeName; }
    get options() { return this.childNodes.filter((child): child is ElementNode => child.nodeType === 1 && child.nodeName === 'OPTION'); }
    appendChild(child: NodeLike) { child.parentNode = this; this.childNodes.push(child); return child; }
    insertBefore(child: NodeLike, before: NodeLike | null) { child.parentNode = this; const index = before ? this.childNodes.indexOf(before) : -1; if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child); return child; }
    removeChild(child: NodeLike) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    addEventListener() {}
    removeEventListener() {}
    focus() {}
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

type Container = ReturnType<typeof installMinimalReactDom>;
const findElement = (node: Container, match: (element: Container) => boolean): Container => {
  const visit = (current: Container): Container | undefined => {
    if (match(current)) return current;
    return current.childNodes.filter((child): child is Container => child.nodeType === 1).map(visit).find(Boolean);
  };
  const found = visit(node);
  if (!found) throw new Error('Element not found.');
  return found;
};
const named = (name: string) => (element: Container) =>
  (element as unknown as { name?: string }).name === name || element.attributes.get('name') === name;
const reactProps = (element: Container) => {
  const key = Object.keys(element).find(name => name.startsWith('__reactProps$'));
  return (key ? (element as unknown as Record<string, Record<string, (event: unknown) => unknown>>)[key] : {}) ?? {};
};

const savedInVietnamese: AccountProfileState = {
  status: 'complete',
  profile: {
    birthYear: 1990, uiLocale: 'vi', nativeLanguage: 'vi', termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION,
    consentAcceptedAt: '2026-11-19T08:30:00.000Z', completedAt: '2026-11-19T08:30:00.000Z',
  },
};

let root: Root | null = null;
beforeEach(() => ui.setUiLocale.mockClear());
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

const fillAndSubmit = async (submit: (request: unknown) => Promise<AccountProfileState>) => {
  const container = installMinimalReactDom();
  root = createRoot(container as unknown as Element);
  await act(async () => root!.render(
    <ProfileCompletionGate screen="required" submit={submit} retry={vi.fn()} returnLabel="Vocabulary library" onSignOut={vi.fn()} />,
  ));
  const birthYear = findElement(container, named('birthYear'));
  const consent = findElement(container, named('consent'));
  await act(async () => { reactProps(birthYear).onChange!({ target: { value: '1990' } }); });
  await act(async () => { reactProps(consent).onChange!({ target: { checked: true } }); });
  const form = findElement(container, element => element.nodeName === 'FORM');
  await act(async () => { reactProps(form).onSubmit!({ preventDefault() {} }); });
};

describe('ProfileCompletionGate save lifecycle', () => {
  it('applies the saved app language while the same owner is still on the step', async () => {
    const submit = vi.fn(async () => savedInVietnamese);
    await fillAndSubmit(submit);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ birthYear: 1990, uiLocale: 'en' }));
    expect(ui.setUiLocale).toHaveBeenCalledWith('vi');
  });

  it('ignores a save that returns after the account signed out or switched', async () => {
    let resolve!: (state: AccountProfileState) => void;
    const submit = vi.fn(() => new Promise<AccountProfileState>(next => { resolve = next; }));
    await fillAndSubmit(submit);
    expect(submit).toHaveBeenCalledTimes(1);

    // The app mounts the gate once per owner, so a change of account unmounts this form.
    act(() => root!.unmount());
    root = null;
    await act(async () => { resolve(savedInVietnamese); });
    expect(ui.setUiLocale).not.toHaveBeenCalled();
  });

  it.each(['error', 'restricted'] as const)('says so on the %s screen when signing out fails, and allows another try', async screen => {
    const onSignOut = vi.fn(async () => ({ status: 'failed' as const }));
    const container = installMinimalReactDom();
    root = createRoot(container as unknown as Element);
    await act(async () => root!.render(
      <ProfileCompletionGate screen={screen} submit={vi.fn()} retry={vi.fn()} returnLabel="Vocabulary library" onSignOut={onSignOut} />,
    ));
    const signOutButton = () => findElement(container, element => element.nodeName === 'BUTTON'
      && /Sign out|Return to sign in/.test(element.textContent));
    expect(() => findElement(container, element => element.attributes.get('role') === 'alert')).toThrow();

    await act(async () => { reactProps(signOutButton()).onClick!({}); });

    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(findElement(container, element => element.attributes.get('role') === 'alert').textContent)
      .toBe('Could not stop browser reminders. Try signing out again.');
    expect((signOutButton() as unknown as { disabled: boolean }).disabled).toBe(false);
    await act(async () => { reactProps(signOutButton()).onClick!({}); });
    expect(onSignOut).toHaveBeenCalledTimes(2);
  });
});

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfileRecord } from '../../../functions/src/account-profile-contract';
import { I18nProvider, useSetUiLocale } from '../../i18n/I18nProvider';
import { UI_LOCALE_STORAGE_KEY, type UiLocale } from '../../i18n/locales';
import { AccountProfileProvider } from './AccountProfileContext';

const installMinimalReactDom = (
  storage: Record<string, string>,
  languages: string[],
  storageHandlers: Array<(event: { key: string; newValue: string | null }) => void>,
) => {
  const documentElement: Record<string, unknown> = { lang: '', dir: '' };
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis, documentElement,
  };
  const container = {
    nodeType: 1, ownerDocument: documentLike, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.body = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  vi.stubGlobal('addEventListener', (type: string, handler: (event: { key: string; newValue: string | null }) => void) => {
    if (type === 'storage') storageHandlers.push(handler);
  });
  vi.stubGlobal('removeEventListener', (type: string, handler: (event: { key: string; newValue: string | null }) => void) => {
    const index = storageHandlers.indexOf(handler);
    if (type === 'storage' && index >= 0) storageHandlers.splice(index, 1);
  });
  vi.stubGlobal('location', { search: '', pathname: '/', hostname: 'example.test' });
  vi.stubGlobal('navigator', { languages });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value; },
  });
  return { container: container as unknown as Element, documentElement };
};

const profile = (uiLocale: 'en' | 'vi') => ({ uiLocale, nativeLanguage: uiLocale }) as unknown as AccountProfileRecord;

const waitForLanguage = async (documentElement: Record<string, unknown>, lang: string) => {
  for (let attempt = 0; attempt < 100 && documentElement.lang !== lang; attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  }
  expect(documentElement.lang).toBe(lang);
};

const mount = async (accountProfile: AccountProfileRecord | null, languages = ['vi-VN']) => {
  const saved: string[] = [];
  const storage: Record<string, string> = {};
  const storageHandlers: Array<(event: { key: string; newValue: string | null }) => void> = [];
  const { container, documentElement } = installMinimalReactDom(storage, languages, storageHandlers);
  let choose: (locale: UiLocale) => Promise<void> = async () => undefined;
  const Chooser = () => {
    choose = useSetUiLocale();
    return null;
  };
  const root = createRoot(container);
  await act(async () => root.render(createElement(I18nProvider, null,
    createElement(AccountProfileProvider, {
      profile: accountProfile,
      saveUiLocale: (locale: string) => { saved.push(locale); },
      children: createElement(Chooser),
    }))));
  return {
    saved,
    documentElement,
    choose: async (locale: UiLocale) => {
      await act(async () => { await choose(locale); });
      await waitForLanguage(documentElement, locale);
    },
    // Another tab stores a language: the browser tells this tab, and the language changes here too.
    otherTabChooses: async (locale: UiLocale) => {
      await act(async () => {
        for (const handler of [...storageHandlers]) handler({ key: UI_LOCALE_STORAGE_KEY, newValue: locale });
      });
      await waitForLanguage(documentElement, locale);
    },
    unmount: () => act(async () => root.unmount()),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account language after the profile is complete', () => {
  it('stores a language the learner chooses, once, and not the account language this device applied', async () => {
    const app = await mount(profile('vi'), ['en-US']);
    await waitForLanguage(app.documentElement, 'vi');
    expect(app.saved).toEqual([]);

    await app.choose('en');
    expect(app.saved).toEqual(['en']);

    await app.choose('en');
    expect(app.saved).toEqual(['en']);
    await app.unmount();
  });

  it('does not store the language the account already holds, and stores a switch back after a change', async () => {
    const app = await mount(profile('vi'));
    await waitForLanguage(app.documentElement, 'vi');
    await app.choose('vi');
    expect(app.saved).toEqual([]);
    await app.choose('en');
    await app.choose('vi');
    expect(app.saved).toEqual(['en', 'vi']);
    await app.unmount();
  });

  it('does not store a language another open tab chose, and still stores a later choice here', async () => {
    const app = await mount(profile('vi'));
    await waitForLanguage(app.documentElement, 'vi');
    await app.otherTabChooses('en');
    expect(app.saved).toEqual([]);

    await app.choose('vi');
    expect(app.saved).toEqual(['vi']);
    await app.unmount();
  });

  it('stores nothing without a completed profile', async () => {
    const app = await mount(null);
    await app.choose('en');
    expect(app.saved).toEqual([]);
    await app.unmount();
  });
});

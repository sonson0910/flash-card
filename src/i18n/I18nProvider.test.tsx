import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountProfileProvider } from '../features/profileCompletion/AccountProfileContext';
import type { AccountProfileRecord } from '../../functions/src/account-profile-contract';
import { I18nProvider } from './I18nProvider';

const installMinimalReactDom = (storage: Record<string, string>) => {
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
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('removeEventListener', vi.fn());
  vi.stubGlobal('location', { search: '', pathname: '/', hostname: 'example.test' });
  vi.stubGlobal('navigator', { languages: ['vi-VN'] });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value; },
  });
  return { container: container as unknown as Element, documentElement };
};

const profile = (uiLocale: 'en' | 'vi') => ({ uiLocale, nativeLanguage: uiLocale }) as unknown as AccountProfileRecord;

const mountApp = async (storage: Record<string, string>, accountLocale: 'en' | 'vi', settleOn: string | null) => {
  const { container, documentElement } = installMinimalReactDom(storage);
  const root = createRoot(container);
  await act(async () => root.render(createElement(I18nProvider, null,
    createElement(AccountProfileProvider, { profile: profile(accountLocale), children: null }))));
  // The language switches once its catalog has loaded; wait for it, or for a quiet period when no switch is expected.
  for (let attempt = 0; attempt < (settleOn ? 100 : 6) && documentElement.lang !== settleOn; attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  }
  const lang = documentElement.lang;
  await act(async () => root.unmount());
  return lang;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account UI language on a device without a saved choice', () => {
  it('applies the signed-in account locale at the app root path', async () => {
    expect(await mountApp({}, 'vi', 'vi')).toBe('vi');
  });

  it('keeps the language this device already saved over the account value', async () => {
    expect(await mountApp({ sonflash_ui_locale: 'en' }, 'vi', null)).toBe('en');
  });
});

import { i18n } from '@lingui/core';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './I18nProvider';

const gate = vi.hoisted(() => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>(resolve => { open = resolve; });
  return { open, opened };
});

vi.mock('./locales/en/landing.po', () => ({ messages: { 'landing.only': 'Landing' } }));
vi.mock('./locales/en/shell.po', async () => {
  await gate.opened;
  return { messages: { 'shell.only': 'Shell' } };
});

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis,
    documentElement: { lang: '', dir: '' },
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
  vi.stubGlobal('navigator', { languages: ['en-US'] });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  return container as unknown as Element;
};

afterEach(() => vi.unstubAllGlobals());

describe('first locale activation', () => {
  it('waits for the shell and landing catalogs before the app renders', async () => {
    const rendered: Array<boolean> = [];
    const Probe = () => { rendered.push(Object.hasOwn(i18n.messages, 'shell.only')); return null; };
    const root = createRoot(installMinimalReactDom());

    await act(async () => root.render(createElement(I18nProvider, null, createElement(Probe))));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(rendered).toEqual([]);
    expect(i18n.locale).toBeFalsy();

    gate.open();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(i18n.locale).toBe('en');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.every(Boolean)).toBe(true);
    await act(async () => root.unmount());
  });
});

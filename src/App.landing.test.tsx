import { i18n } from '@lingui/core';
import { I18nProvider as LinguiProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { loadCatalog, setActiveUiLocale } from './i18n/loadCatalog';

const loaded = vi.hoisted(() => ({ viewMode: 'landing', landing: false, runtimeBoundary: false, firebase: false }));

vi.mock('./features/navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({ viewMode: loaded.viewMode, setViewMode: vi.fn() }),
}));
vi.mock('./features/landing/LandingPage', () => {
  loaded.landing = true;
  return { default: () => <main>Landing</main> };
});
// The runtime, and with it Firebase and App Check, loads only inside this boundary.
vi.mock('./app/AppRuntimeBoundary', () => ({
  AppRuntimeBoundary: () => {
    loaded.runtimeBoundary = true;
    return null;
  },
}));
vi.mock('./lib/firebase', () => {
  loaded.firebase = true;
  return {};
});

describe('App landing visit', () => {
  it('renders the landing without starting the app runtime, Firebase or App Check', async () => {
    setActiveUiLocale('en');
    await Promise.all([loadCatalog('en', 'shell'), loadCatalog('en', 'landing')]);
    const { default: App } = await import('./App');

    renderToStaticMarkup(<LinguiProvider i18n={i18n}><App /></LinguiProvider>);
    await vi.waitFor(() => expect(loaded.landing).toBe(true));

    expect(loaded.runtimeBoundary).toBe(false);
    expect(loaded.firebase).toBe(false);

    loaded.viewMode = 'today';
    renderToStaticMarkup(<LinguiProvider i18n={i18n}><App /></LinguiProvider>);
    expect(loaded.runtimeBoundary).toBe(true);
  });
});

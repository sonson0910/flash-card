import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { resolveStaticJapanesePitchAccent } from '../../features/languagePacks/japanesePitch';
import { jaLanguagePack } from '../../features/languagePacks/packs/ja';
import { JapanesePitchContour, ReadingValue } from './ReadingToggle';

type TestElement = { readonly props: Record<string, unknown> };

const childElements = (element: TestElement): TestElement[] => {
  const children = element.props.children;
  return (Array.isArray(children) ? children : [children]).filter((child): child is TestElement =>
    typeof child === 'object' && child !== null && 'props' in child,
  );
};

describe('JapanesePitchContour', () => {
  it('renders only the contour encoded by a verified accent record', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const accent = resolveStaticJapanesePitchAccent({ word: '日本', phonetic: 'にっぽん' });
    expect(accent).toBeDefined();

    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><JapanesePitchContour accent={accent!} /></I18nProvider>);

    expect(html).toContain('aria-label="Verified Japanese pitch contour"');
    expect(html.match(/<circle/g)).toHaveLength(4);
    expect(html).toContain('points="12,24 32,8 52,8 72,24"');
  });

  it('keeps the kana visible alongside the verified contour', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const card = { word: '日本', phonetic: 'にっぽん', japanesePitchAccent: resolveStaticJapanesePitchAccent({ word: '日本', phonetic: 'にっぽん' }) };
    const plan = jaLanguagePack.rendering.buildReadingPlan(card);

    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><ReadingValue plan={plan} /></I18nProvider>);

    expect(html).toContain('にっぽん');
    expect(html).toContain('class="japanese-pitch-contour');
  });

  it('shows each CJK pack reading by default, and the accessible toggle hides then reveals it', async () => {
    const state: unknown[] = [];
    const effects: Array<() => void | (() => void)> = [];
    let cursor = 0;
    const loadLanguagePack = async (id: 'ko' | 'zh') => ({
      rendering: { buildReadingPlan: () => ({
        readingText: id === 'ko' ? 'annyeong' : 'nǐ hǎo', readingLang: id === 'ko' ? 'ko-Latn' : 'zh-Latn', kind: id === 'ko' ? 'romanization' as const : 'pinyin' as const,
      }) },
    });

    vi.resetModules();
    vi.doMock('react', async importOriginal => ({
      ...(await importOriginal<typeof import('react')>()),
      useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
      useState: <T,>(initial: T) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index] as T, (next: T | ((current: T) => T)) => { state[index] = typeof next === 'function' ? (next as (current: T) => T)(state[index] as T) : next; }];
      },
    }));
    vi.doMock('@lingui/react', () => ({
      useLingui: () => ({
        _: (descriptor: { message: string }) => descriptor.message,
        i18n: { _: (_id: string, values?: Record<string, unknown>) => `Toggle ${values?.label ?? ''} for ${values?.word ?? ''}` },
      }),
    }));
    vi.doMock('../../features/languagePacks/registry', () => ({
      resolveLanguagePackId: (language: string) => language,
      loadLanguagePack,
    }));

    try {
      const { ReadingToggle: ClientReadingToggle } = await import('./ReadingToggle');
      const render = (language: 'ko' | 'zh') => {
        cursor = 0;
        return ClientReadingToggle({ card: { word: language === 'ko' ? '안녕' : '你好', language } } as never) as unknown as TestElement;
      };
      const visibleReading = (view: TestElement) => childElements(view).find(child => child.props.lang)?.props.children as TestElement | undefined;
      const button = (view: TestElement) => childElements(view).find(child => child.props.type === 'button')!;

      render('ko');
      effects.pop()?.();
      await Promise.resolve();
      let view = render('ko');
      expect(visibleReading(view)?.props.plan).toMatchObject({ readingText: 'annyeong' });
      expect(button(view).props['aria-pressed']).toBe(true);
      expect(button(view).props['aria-label']).toContain('Toggle');

      (button(view).props.onClick as (event: { stopPropagation(): void }) => void)({ stopPropagation() {} });
      view = render('ko');
      expect(visibleReading(view)).toBeUndefined();

      (button(view).props.onClick as (event: { stopPropagation(): void }) => void)({ stopPropagation() {} });
      view = render('ko');
      expect(visibleReading(view)?.props.plan).toMatchObject({ readingText: 'annyeong' });

      view = render('zh');
      effects.pop()?.();
      await Promise.resolve();
      view = render('zh');
      expect(visibleReading(view)?.props.plan).toMatchObject({ readingText: 'nǐ hǎo' });
    } finally {
      vi.doUnmock('react');
      vi.doUnmock('@lingui/react');
      vi.doUnmock('../../features/languagePacks/registry');
      vi.resetModules();
    }
  });
});

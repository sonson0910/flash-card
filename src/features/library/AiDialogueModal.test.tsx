import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as Dialog from '@radix-ui/react-dialog';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { messages as enLibrary } from '../../i18n/locales/en/library.po';
i18n.load('en', enLibrary); i18n.activate('en');
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { AiDialogueContent, AiDialogueModal, dialogueFailureMessage } from './AiDialogueModal';

import type { CardData } from '../../types/card';

const sampleCards: CardData[] = [
  { id: '1', language: 'ko', translationLanguage: 'vi', word: '안녕', translation: 'xin chào', phonetic: '', explanation: '', category: 'All', customDeck: null } as CardData,
  { id: '2', word: 'ephemeral', translation: 'chóng tàn', phonetic: '', explanation: '', category: 'All', customDeck: null } as CardData,
];

describe('AiDialogueModal', () => {
  it('renders dialogue generator content', () => {
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}><Dialog.Root open>
        <Dialog.Content>
          <AiDialogueContent
            cards={sampleCards}
            onClose={vi.fn()}
          />
        </Dialog.Content>
      </Dialog.Root></I18nProvider>
    );

    expect(html).toContain('Practice in context');
    expect(html).toContain('lang="ko"');
    expect(html).toContain('안녕');
    expect(html).toContain('Create dialogue');
    const descriptionId = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(descriptionId).toBeTruthy();
    expect(html).toContain(`id="${descriptionId}"`);
  });

  it('renders nothing when closed modal', () => {
    const html = renderToStaticMarkup(
      <AiDialogueModal
        cards={sampleCards}
        open={false}
        onOpenChange={vi.fn()}
      />
    );

    expect(html).toBe('');
  });

  it('keeps the daily service-cap reset time', () => {
    expect(dialogueFailureMessage(new ProtectedFunctionError({
      message: 'internal', kind: 'quota', code: 'resource-exhausted', retryable: false, reason: 'service-daily-cap',
    }))).toContain('00:00 Vietnam time');
  });

  it('translates quota guidance when the active locale changes', () => {
    const failure = new ProtectedFunctionError({
      message: 'internal', kind: 'quota', code: 'resource-exhausted', retryable: false, reason: 'service-daily-cap',
    });
    i18n.load({
      en: { 'library.dialogue.error.service-daily-cap': 'Shared limit is exhausted.' },
      vi: { 'library.dialogue.error.service-daily-cap': 'Đã hết hạn mức dùng chung.' },
    });
    i18n.activate('en');
    expect(dialogueFailureMessage(failure)).toBe('Shared limit is exhausted.');
    i18n.activate('vi');
    expect(dialogueFailureMessage(failure)).toBe('Đã hết hạn mức dùng chung.');
  });

  it('keeps a structured quota failure until the next render', async () => {
    const state: unknown[] = [];
    let cursor = 0;
    let failure: unknown;
    vi.resetModules();
    vi.doMock('react', async importOriginal => {
      const actual = await importOriginal<typeof import('react')>();
      return {
        ...actual,
        useEffect: vi.fn(),
        useRef: <T,>(current: T) => ({ current }),
        useState: <T,>(initial: T | (() => T)) => {
          const index = cursor++;
          if (!(index in state)) state[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
          return [state[index] as T, (value: T) => { state[index] = value; }] as const;
        },
      };
    });
    vi.doMock('../../lib/gemini', () => ({ generateDialogue: vi.fn(() => Promise.reject(failure)) }));
    const { AiDialogueContent: IsolatedContent } = await import('./AiDialogueModal');
    const { ProtectedFunctionError: IsolatedError } = await import('../../lib/protectedFunctionsCapability');
    failure = new IsolatedError({
      message: 'internal', kind: 'quota', code: 'resource-exhausted', retryable: false, reason: 'service-daily-cap',
    });
    const walk = (node: unknown, predicate: (value: { props?: Record<string, unknown> }) => boolean): { props?: Record<string, unknown> } | null => {
      if (!node || typeof node !== 'object') return null;
      const element = node as { props?: Record<string, unknown> };
      if (predicate(element)) return element;
      for (const child of Array.isArray(element.props?.children) ? element.props?.children : [element.props?.children]) {
        const found = walk(child, predicate);
        if (found) return found;
      }
      return null;
    };
    const render = () => {
      cursor = 0;
      return IsolatedContent({ cards: sampleCards, onClose: vi.fn() });
    };
    const first = render();
    const generate = walk(first, element => element.props?.onClick !== undefined && element.props?.disabled === false)?.props?.onClick as () => Promise<void>;
    await generate();
    i18n.load({ vi: { 'library.dialogue.error.service-daily-cap': 'Đã hết hạn mức dùng chung.' } });
    i18n.activate('vi');
    const alert = walk(render(), element => element.props?.role === 'alert');
    expect(alert?.props?.children).toBe('Đã hết hạn mức dùng chung.');
    expect(state).toContain(failure);
    vi.doUnmock('react');
    vi.doUnmock('../../lib/gemini');
  });
  it('uses the typed dialogue operation and never parses model JSON in the component', () => {
    const source = readFileSync(fileURLToPath(new URL('./AiDialogueModal.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('generateDialogue');
    expect(source).not.toContain('translateText');
    expect(source).not.toContain('JSON.parse');
  });
});

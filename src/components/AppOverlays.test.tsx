import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider as LinguiProvider } from '@lingui/react';
import { BookOpen } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import { capListenPracticeCards, listenPracticeUnavailableMessage } from '../app/AppViewStage';
import {
  canStartTextPractice,
  IncomingSharePreview,
  isWordMatchAvailable,
  OutgoingShareDetails,
  PracticeModeChoices,
  ShareImportActions,
  ShareManagementButton,
} from './AppOverlays';
import { getPracticeModes, registerPracticeMode, resolvePracticeModeAction, wordMatchEligibleCardCount } from '../features/practice/practiceModeRegistry';
import { setFormatLocale } from '../lib/format';

i18n.load('en', {});
i18n.activate('en');

describe('share overlays', () => {
  it('cancels pending focus restoration when text practice opens', () => {
    const source = readFileSync(new URL('./AppOverlays.tsx', import.meta.url), 'utf8');

    expect(source).toContain('|| isTextPracticeOpen ||');
    expect(source).toContain('[shareDialogOpen, isPracticeMenuOpen, isTextPracticeOpen, isStatsOpen, showClearConfirm]');
  });

  it('renders an explicit, write-free incoming preview decision', () => {
    const html = renderToStaticMarkup(
      <LinguiProvider i18n={i18n}><IncomingSharePreview
          preview={{
            shareId: 'deck-1',
            category: 'IELTS',
            cardCount: 100,
            createdAt: '2026-09-23T10:00:00.000Z',
            expiresAt: '2026-10-23T10:00:00.000Z',
            containsAiGeneratedCards: true,
            sampleWords: [{ value: 'airport', language: 'en', translation: 'sân bay', translationLanguage: 'vi', origin: 'manual' }, { value: 'boarding pass', language: 'en', translation: 'thẻ lên máy bay', translationLanguage: 'vi', origin: 'ai' }],
            languagePairs: [{ targetLanguage: 'en', translationLanguage: 'vi' }],
          }}
          isSharing={false}
        /></LinguiProvider>,
    );

    expect(html).toContain('Cards');
    expect(html).toContain('IELTS');
    expect(html).toContain('>100</p>');
    expect(html).toContain('airport');
    expect(html).toContain('sân bay');
    expect(html).toContain('Link expires on');
    expect(html).toContain('AI-generated content may be incorrect');
    expect(html).toContain('Your existing cards and progress stay untouched');
  });

  it('keeps truncation, privacy and expiry guidance with the outgoing share details', () => {
    const html = renderToStaticMarkup(
      <LinguiProvider i18n={i18n}><OutgoingShareDetails
        shareLink="https://example.test/?share=deck-1"
        shareWarning={{ sharedCardCount: 100, totalCardCount: 120 }}
        preview={{ category: 'IELTS', cardCount: 100, languagePairs: [{ targetLanguage: 'en', translationLanguage: 'vi' }], expiresAt: '2026-10-23T10:00:00.000Z', containsAiGeneratedCards: true }}
        expiresAt="2026-10-23T10:00:00.000Z"
        copied={false}
        copyFailed={false}
        isSharing={false}
        onCopy={vi.fn()}
        onDismissCopyError={vi.fn()}
      /></LinguiProvider>,
    );

    expect(html).toContain('This link includes 100 of 120 cards');
    expect(html).toContain('Link expires on');
    expect(html).toContain('AI-generated content may be incorrect');
    expect(html).toContain('Shared cards may include memory hooks');
    expect(html.indexOf('share-dialog-deck-summary')).toBeLessThan(html.indexOf('Share link'));
    expect(html.indexOf('Share link')).toBeLessThan(html.indexOf('share-dialog-facts'));
    expect(html.indexOf('share-dialog-facts')).toBeLessThan(html.indexOf('Review them for private information before sharing'));
  });

  it('shows real card previews with an explicit empty state when no preview words are available', () => {
    const html = renderToStaticMarkup(
      <LinguiProvider i18n={i18n}><IncomingSharePreview
        preview={{ shareId: 'empty', category: 'Travel', cardCount: 0, sampleWords: [], createdAt: null, expiresAt: null, containsAiGeneratedCards: false }}
        isSharing={false}
      /></LinguiProvider>,
    );
    expect(html).toContain('This shared deck has no cards to add');
    expect(html).not.toContain('Accept deck');
  });

  it('disables import for empty decks and exposes the real count while importing', () => {
    const empty = renderToStaticMarkup(
      <LinguiProvider i18n={i18n}><ShareImportActions preview={{ shareId: 'empty', category: 'Travel', cardCount: 0, sampleWords: [], createdAt: null, expiresAt: null, containsAiGeneratedCards: false }} isSharing={false} onAccept={vi.fn()} onCancel={vi.fn()} /></LinguiProvider>,
    );
    const loading = renderToStaticMarkup(
      <LinguiProvider i18n={i18n}><ShareImportActions preview={{ shareId: 'loading', category: 'IELTS', cardCount: 12, sampleWords: [], createdAt: null, expiresAt: null, containsAiGeneratedCards: false }} isSharing onAccept={vi.fn()} onCancel={vi.fn()} /></LinguiProvider>,
    );
    expect(empty).toContain('disabled=""');
    expect(empty).toContain('No cards to add');
    expect(loading).toContain('Adding…');
    expect(loading).toContain('aria-busy="true"');
  });

  it('renders recoverable share errors and leaves the link visible for manual copying', () => {
    const html = renderToStaticMarkup(
      <LinguiProvider i18n={i18n}><OutgoingShareDetails
        shareLink="https://example.test/?share=deck-1"
        shareWarning={null}
        preview={{ category: 'IELTS', cardCount: 2, languagePairs: [], expiresAt: null, containsAiGeneratedCards: false }}
        copied={false}
        copyFailed
        isSharing={false}
        onCopy={vi.fn()}
        onDismissCopyError={vi.fn()}
      /></LinguiProvider>,
    );
    expect(html).toContain('https://example.test/?share=deck-1');
    expect(html).toContain('The link could not be copied');
    expect(html).toContain('Copy share link');
  });

  it('renders every shared language pair with the active locale', () => {
    i18n.load('vi', {});
    i18n.activate('vi');
    setFormatLocale('vi');
    const html = renderToStaticMarkup(
      <LinguiProvider i18n={i18n}><IncomingSharePreview
        preview={{
          shareId: 'deck-1', category: 'Mixed', cardCount: 1_200, sampleWords: [], createdAt: null, expiresAt: null, containsAiGeneratedCards: false,
          languagePairs: [
            { targetLanguage: 'ko', translationLanguage: 'vi' },
            { targetLanguage: 'en', translationLanguage: 'vi' },
          ],
        }}
        isSharing={false}
      /></LinguiProvider>,
    );

    const languageNames = new Intl.DisplayNames(['vi'], { type: 'language' });
    expect(html).toContain(languageNames.of('ko'));
    expect(html).toContain(languageNames.of('en'));
    expect(html).toContain('1.200');
    i18n.activate('en');
    setFormatLocale('en');
  });

  it('localizes only the internal All-library category sentinel', () => {
    i18n.load('vi', { 'shell.share.all-library': 'Tất cả thẻ thư viện' });
    i18n.activate('vi');
    const html = renderToStaticMarkup(
      <LinguiProvider i18n={i18n}><OutgoingShareDetails
        shareLink="https://example.test/?share=deck-1"
        shareWarning={null}
        preview={{ category: 'All', cardCount: 1, languagePairs: [], expiresAt: null, containsAiGeneratedCards: false }}
        copied={false}
        copyFailed={false}
        isSharing={false}
        onCopy={vi.fn()}
        onDismissCopyError={vi.fn()}
      /></LinguiProvider>,
    );

    expect(html).toContain('Tất cả thẻ thư viện');
    i18n.activate('en');
  });

  it('offers a visible way to reopen management after the dialog closes', () => {
    const html = renderToStaticMarkup(<LinguiProvider i18n={i18n}><ShareManagementButton onClick={vi.fn()} /></LinguiProvider>);

    expect(html).toContain('Manage shared link');
  });

  it('keeps Match disabled when four visible cards do not make four eligible pairs', () => {
    const duplicate = { id: 'duplicate', word: ' WORD ', translation: ' meaning ' } as CardData;
    expect(isWordMatchAvailable([
      { id: 'one', word: 'word', translation: 'meaning' } as CardData,
      duplicate,
      { id: 'blank-word', word: ' ', translation: 'two' } as CardData,
      { id: 'blank-translation', word: 'three', translation: ' ' } as CardData,
    ])).toBe(false);
  });

  it('shows a Word Match lock only when eligible pairs are unavailable', () => {
    i18n.load('en', {
      'practice.mode.match.label': 'Word Match',
      'practice.mode.match.description': 'Pair words and meanings in a one-minute study round.',
      'practice.mode.match.duration': '60 s',
      'practice.mode.match.unavailable': 'Needs 4 cards · you have {count}',
    });
    i18n.activate('en');
    const actions = { match: async () => undefined };
    const eligibleCards = [
      { id: 'one', word: 'one', translation: 'một' },
      { id: 'two', word: 'two', translation: 'hai' },
      { id: 'three', word: 'three', translation: 'ba' },
      { id: 'four', word: 'four', translation: 'bốn' },
    ] as CardData[];
    const ineligibleCards: CardData[] = [...eligibleCards.slice(0, 3),
      { id: 'duplicate', word: ' one ', translation: ' một ' } as CardData,
      { id: 'blank-word', word: ' ', translation: 'năm' } as CardData,
      { id: 'blank-translation', word: 'six', translation: ' ' } as CardData,
    ];
    const renderMatch = (practiceCards: readonly CardData[]) => renderToStaticMarkup(
      <LinguiProvider i18n={i18n}><PracticeModeChoices practiceCards={practiceCards} visibleLibraryCount={0} practiceAction={null} actions={actions} onRun={async () => undefined} /></LinguiProvider>,
    );

    expect(wordMatchEligibleCardCount(ineligibleCards)).toBe(2);
    expect(renderMatch(ineligibleCards)).toContain('Needs 4 cards · you have 2');
    expect(renderMatch(eligibleCards)).not.toContain('Needs 4 cards');
  });

  it('keeps the available modes in a stable, availability-aware registry', () => {
    const modes = getPracticeModes();

    expect(modes.map(mode => mode.id)).toEqual(['quiz', 'spelling', 'language-drill', 'match', 'shadowing', 'story']);
    expect(modes.find(mode => mode.id === 'match')?.isAvailable([
      { id: 'one', word: 'one', translation: 'một' } as CardData,
      { id: 'two', word: 'two', translation: 'hai' } as CardData,
      { id: 'three', word: 'three', translation: 'ba' } as CardData,
      { id: 'four', word: 'four', translation: 'bốn' } as CardData,
    ], { visibleLibraryCount: 4 })).toBe(true);
    expect(modes.find(mode => mode.id === 'story')?.isAvailable([], { visibleLibraryCount: 4 })).toBe(false);
  });

  it('renders and starts a registered pack-specific mode', async () => {
    const start = vi.fn(async () => undefined);
    registerPracticeMode({
      id: 'pack-drill-test',
      label: { id: 'practice.mode.pack-drill.label', message: 'Pack drill' },
      description: { id: 'practice.mode.pack-drill.description', message: 'A focused drill from this pack.' },
      duration: { id: 'practice.mode.pack-drill.duration', message: '~2 min' },
      icon: BookOpen,
      isAvailable: () => true,
      start,
    });
    const mode = getPracticeModes().find(candidate => candidate.id === 'pack-drill-test');

    expect(mode).toBeDefined();
    expect(resolvePracticeModeAction(mode!, {})).toBe(start);
    await resolvePracticeModeAction(mode!, {})?.();
    expect(start).toHaveBeenCalledOnce();

    i18n.load('en', { 'practice.mode.pack-drill.label': 'Pack drill' });
    i18n.activate('en');
    const html = renderToStaticMarkup(
      <LinguiProvider i18n={i18n}><PracticeModeChoices practiceCards={[]} visibleLibraryCount={0} practiceAction={null} actions={{}} onRun={async () => undefined} /></LinguiProvider>,
    );

    expect(html).toContain('Pack drill');
  });
});

describe('practice menu copy', () => {
  const cards = [{
    id: 'card-1', word: 'hello', translation: 'xin chào',
  } as CardData];

  it('only enables text practice for an authenticated online owner with usable cards', () => {
    expect(canStartTextPractice(cards, 'owner-a', false)).toBe(true);
    expect(canStartTextPractice(cards, null, false)).toBe(false);
    expect(canStartTextPractice(cards, 'owner-a', true)).toBe(false);
    expect(canStartTextPractice([{ ...cards[0], translation: ' ' }], 'owner-a', false)).toBe(false);
  });

  it('bounds a listening handoff to the existing conversation card limit', () => {
    const selected = Array.from({ length: 8 }, (_, index) => ({
      ...cards[0], id: `card-${index}`,
    }));

    expect(capListenPracticeCards(selected)).toHaveLength(5);
    expect(capListenPracticeCards(selected).map(card => card.id)).toEqual([
      'card-0', 'card-1', 'card-2', 'card-3', 'card-4',
    ]);
  });

  it('explains why a guest or offline learner cannot open AI practice', () => {
    expect(listenPracticeUnavailableMessage(null, false)).toBe('Sign in to practise this phrase.');
    expect(listenPracticeUnavailableMessage('owner-a', true)).toBe('Reconnect to practise this phrase.');
    expect(listenPracticeUnavailableMessage('owner-a', false)).toBeNull();
  });
});

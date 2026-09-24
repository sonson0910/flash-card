import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider as LinguiProvider } from '@lingui/react';
import { BookOpen } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import {
  IncomingSharePreview,
  isWordMatchAvailable,
  OutgoingShareDetails,
  PracticeModeChoices,
  ShareManagementButton,
} from './AppOverlays';
import { getPracticeModes, registerPracticeMode, resolvePracticeModeAction, wordMatchEligibleCardCount } from '../features/practice/practiceModeRegistry';
import type { CardData } from '../types/card';

describe('share overlays', () => {
  it('renders an explicit, write-free incoming preview decision', () => {
    const html = renderToStaticMarkup(
      <IncomingSharePreview
        preview={{
          shareId: 'deck-1',
          category: 'IELTS',
          cardCount: 100,
          sampleWords: ['airport', 'boarding pass'],
        }}
        isSharing={false}
        onAccept={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain('Review shared deck');
    expect(html).toContain('IELTS');
    expect(html).toContain('100 cards');
    expect(html).toContain('airport');
    expect(html).toContain('Nothing will be added until you accept');
    expect(html).toContain('Accept deck');
    expect(html).toContain('Cancel');
  });

  it('keeps truncation guidance inside the outgoing share dialog', () => {
    const warning = 'This link includes the first 100 of 120 cards. Split this category into smaller decks to share the rest.';
    const html = renderToStaticMarkup(
      <OutgoingShareDetails
        shareLink="https://example.test/?share=deck-1"
        shareWarning={warning}
        copied={false}
        copyFailed={false}
        canRevokeShare
        isSharing={false}
        onCopy={vi.fn()}
        onDismissCopyError={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(html).toContain(warning);
    expect(html).toContain('Revoke link');
  });

  it('offers a visible way to reopen management after the dialog closes', () => {
    const html = renderToStaticMarkup(<ShareManagementButton onClick={vi.fn()} />);

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

    expect(wordMatchEligibleCardCount(ineligibleCards)).toBe(3);
    expect(renderMatch(ineligibleCards)).toContain('Needs 4 cards · you have 3');
    expect(renderMatch(eligibleCards)).not.toContain('Needs 4 cards');
  });

  it('keeps the five established modes in a stable, availability-aware registry', () => {
    const modes = getPracticeModes();

    expect(modes.map(mode => mode.id)).toEqual(['quiz', 'spelling', 'match', 'shadowing', 'story']);
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

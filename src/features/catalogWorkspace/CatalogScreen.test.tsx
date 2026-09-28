import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup as renderReactToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { messages as enCatalog } from '../../i18n/locales/en/catalog.po';
import { messages as viCatalog } from '../../i18n/locales/vi/catalog.po';
import { CatalogCacheOpenError } from '../catalogCache/catalogCache';
import { CatalogScreen } from './CatalogScreen';
import { catalogErrorStatus } from './CatalogWorkspace';
import {
  catalogTierMessages,
  catalogTrackMessages,
  type CatalogScreenActions,
  type CatalogScreenModel,
} from './catalogPresentation';

i18n.load('en', enCatalog);
i18n.activate('en');

const renderToStaticMarkup = (node: ReactNode) => renderReactToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const readyModel: CatalogScreenModel = {
  status: { kind: 'ready', isOnline: false, message: 'English catalog is ready offline.' },
  selectedLanguage: 'en',
  languages: [
    { code: 'en', label: 'English', nativeLabel: 'English', isAvailable: true },
    { code: 'ja', label: 'Japanese', nativeLabel: '日本語', isAvailable: false },
  ],
  selectedTrack: 'ielts',
  tracks: [
    { id: 'ielts', label: 'IELTS', description: 'Academic and general test vocabulary', total: 300, started: 24, mastered: 8 },
    { id: 'toeic', label: 'TOEIC', description: 'Workplace and business vocabulary', total: 300, started: 12, mastered: 4 },
    { id: 'general', label: 'General', description: 'Everyday communication vocabulary', total: 300, started: 30, mastered: 10 },
  ],
  selectedTier: 'foundation',
  tiers: [
    { id: 'foundation', label: 'Foundation', description: 'Build essential language', cefrRange: 'A1–A2', total: 100, started: 24, mastered: 8, state: 'in-progress' },
    { id: 'core', label: 'Core', description: 'Grow confident range', cefrRange: 'B1–B2', total: 100, started: 0, mastered: 0, state: 'available' },
    { id: 'advanced', label: 'Advanced', description: 'Handle precise language', cefrRange: 'C1–C2', total: 100, started: 0, mastered: 0, state: 'locked' },
  ],
  filters: {
    term: '',
    cefr: '',
    topic: '',
    partOfSpeech: '',
    skill: '',
    cefrOptions: [{ value: 'B2', label: 'B2' }],
    topicOptions: [{ value: 'education', label: 'Education' }],
    partOfSpeechOptions: [{ value: 'noun', label: 'Noun' }],
    skillOptions: [{ value: 'reading', label: 'Reading' }],
    hasActiveFilters: false,
  },
  cards: [{
    id: 'lexeme-analysis',
    lemma: 'analysis',
    language: 'en',
    phonetic: '/əˈnæləsɪs/',
    partOfSpeech: 'noun',
    cefr: 'B2',
    tier: 'foundation',
    topics: ['Education'],
    skills: ['Reading'],
    meaning: 'a careful study of something',
    meaningLanguage: 'en',
    translation: 'sự phân tích',
    translationLanguage: 'vi',
    example: 'The report provides a detailed analysis of the results.',
    exampleTranslation: 'Báo cáo cung cấp phân tích chi tiết về kết quả.',
    collocations: ['detailed analysis', 'data analysis'],
    provenance: {
      sourceLabel: 'Reviewed editorial catalog',
      licenseLabel: 'CC BY 4.0',
      reviewerLabel: 'Reviewed by Linh Nguyen',
    },
    libraryState: 'available',
  }],
  resultSummary: 'Showing 1 IELTS Foundation word.',
  hasMore: true,
  isLoadingPage: false,
  isLoadingMore: false,
};

const actions: CatalogScreenActions = {
  selectLanguage: vi.fn(),
  selectTrack: vi.fn(),
  selectTier: vi.fn(),
  changeTerm: vi.fn(),
  changeCefr: vi.fn(),
  changeTopic: vi.fn(),
  changePartOfSpeech: vi.fn(),
  changeSkill: vi.fn(),
  resetFilters: vi.fn(),
  download: vi.fn(),
  retry: vi.fn(),
  loadMore: vi.fn(),
  addToLibrary: vi.fn(),
  openVocabulary: vi.fn(),
  continueReview: vi.fn(),
  selectPathUnit: vi.fn(),
};

describe('CatalogScreen', () => {
  it('renders a semantic ready workspace with track progress, roadmap and honest vocabulary evidence', () => {
    const html = renderToStaticMarkup(<CatalogScreen model={readyModel} actions={actions} />);

    expect(html).toContain('<section');
    expect(html).not.toContain('<main');
    expect(html).toContain('<h1');
    expect(html).toContain('Language paths');
    expect(html).toContain('Japanese (日本語) — coming soon');
    expect(html).toContain('disabled=""');
    expect(html).toContain('IELTS');
    expect(html).toContain('Your current path');
    expect(html).toContain('24 started');
    expect(html).toContain('8 mastered');
    expect(html).toContain('In progress');
    expect(html).toContain('Locked');
    expect(html).toContain('Foundation · A1–A2 · Selected');
    expect(html).toContain('a careful study of something');
    expect(html).toContain('Báo cáo cung cấp phân tích');
    expect(html).toContain('detailed analysis');
    expect(html).toContain('CC BY 4.0');
    expect(html).toContain('Reviewed by Linh Nguyen');
    expect(html).toContain('Add to library');
    expect(html).toContain('Load more words');
    expect(html).toContain('aria-labelledby="catalog-heading"');
  });

  it('renders descriptor-backed unit shelves and the selected preview', () => {
    const html = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel,
      selectedPathUnitId: 'ielts\u0000unit-2',
      pathUnits: [
        { unit: { unitId: 'unit-1', trackId: 'ielts', tier: 'foundation', ordinal: 1, titles: [{ language: 'en', text: 'Start here' }], total: 2, started: 0, mastered: 0, preview: [{ lexemeId: 'one', lemma: 'one' }] }, introduced: 0, mastered: 0, status: 'not-started' },
        { unit: { unitId: 'unit-2', trackId: 'ielts', tier: 'foundation', ordinal: 2, titles: [{ language: 'en', text: 'Next words' }], total: 2, started: 1, mastered: 1, preview: [{ lexemeId: 'two', lemma: 'two' }, { lexemeId: 'three', lemma: 'three' }] }, introduced: 1, mastered: 1, status: 'active' },
      ],
    }} actions={actions} />);

    expect(html).toContain('Unit 1 · Start here');
    expect(html).toContain('Unit 2 · Next words');
    expect(html).toContain('Preview: Next words');
    expect(html).toContain('two');
    expect(html).toContain('three');
  });

  it('does not render an empty progress map as zero progress', () => {
    const html = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel,
      pathUnits: [{ unit: { unitId: 'unit-1', trackId: 'ielts', tier: 'foundation', ordinal: 1, titles: [{ language: 'en', text: 'Start here' }], total: 2, started: 0, mastered: 0, preview: [{ lexemeId: 'one', lemma: 'one' }] }, introduced: null, mastered: null, status: 'unavailable' }],
    }} actions={actions} />);

    expect(html).toContain('Progress unavailable');
    expect(html).toContain('Progress is unavailable until your library can be verified.');
    expect(html).not.toContain('0 introduced · 0 mastered');
  });

  it('marks track and tier progress unavailable instead of presenting V1 zeroes as progress', () => {
    const html = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel,
      progressAvailable: false,
      tracks: readyModel.tracks.map(track => ({ ...track, started: 0, mastered: 0 })),
      tiers: readyModel.tiers.map(tier => ({ ...tier, started: 0, mastered: 0, state: 'available' as const })),
    }} actions={actions} />);

    expect(html).toContain('Progress unavailable');
    expect(html).not.toContain('0 started');
    expect(html).not.toContain('0 mastered');
  });

  it('uses the UI locale for unit titles and only renders the selected track shelf', () => {
    const units = ['ielts', 'toeic', 'general'].flatMap(track => Array.from({ length: 15 }, (_, index) => ({
      unit: { unitId: `${track}-${index + 1}`, trackId: track, tier: 'foundation', ordinal: index + 1, titles: [{ language: 'en', text: `English ${track} ${index + 1}` }, { language: 'vi', text: `Tiếng Việt ${track} ${index + 1}` }], total: 1, started: 0, mastered: 0, preview: [{ lexemeId: `${track}-${index + 1}`, lemma: `${track} word` }] },
      introduced: 0, mastered: 0, status: 'not-started' as const,
    })));
    const html = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel, selectedLanguage: 'en', uiLocale: 'vi', selectedTrack: 'toeic', pathUnits: units,
    }} actions={actions} />);
    const englishHtml = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel, selectedLanguage: 'en', uiLocale: 'en', selectedTrack: 'toeic', pathUnits: units,
    }} actions={actions} />);

    expect(html).toContain('Tiếng Việt toeic 1');
    expect(html).toContain('Tiếng Việt toeic 15');
    expect(html).not.toContain('Tiếng Việt ielts 1');
    expect(html).not.toContain('Tiếng Việt general 1');
    expect((html.match(/Unit /g) ?? []).length).toBe(15);
    expect(englishHtml).toContain('English toeic 1');
    expect(englishHtml).not.toContain('Tiếng Việt toeic 1');
  });

  it('selects the first unit when the selected track has no explicit unit selection', () => {
    const html = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel,
      pathUnits: [{ unit: { unitId: 'unit-1', trackId: 'ielts', tier: 'foundation', ordinal: 1, titles: [{ language: 'en', text: 'Start here' }], total: 1, started: 0, mastered: 0, preview: [] }, introduced: 0, mastered: 0, status: 'not-started' }],
    }} actions={actions} />);

    expect(html).toContain('aria-pressed="true"');
  });

  it('presents idempotent add states without hiding reviewed evidence', () => {
    const available = renderToStaticMarkup(<CatalogScreen model={readyModel} actions={actions} />);
    const added = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel,
      cards: readyModel.cards.map(card => ({ ...card, libraryState: 'added' as const })),
    }} actions={actions} />);

    expect(available).toContain('Add to library');
    expect(added).toContain('In your library');
    expect(added).toContain('disabled=""');
    expect(added).toContain('CC BY 4.0');
  });

  it('uses stable catalog track IDs for display names instead of release-provided labels', () => {
    const html = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel,
      tracks: readyModel.tracks.map(track => ({ ...track, label: 'Untrusted track label', description: 'Untrusted description' })),
    }} actions={actions} />);

    expect(html).toContain('IELTS');
    expect(html).toContain('TOEIC');
    expect(html).toContain('General English');
    expect(html).not.toContain('Untrusted track label');
  });

  it('localizes ready tier and selected-summary labels from stable IDs in Vietnamese', () => {
    i18n.load('vi', viCatalog);
    i18n.activate('vi');

    try {
      const html = renderToStaticMarkup(<CatalogScreen model={readyModel} actions={actions} />);
      const summary = i18n._('catalog.workspace.result-summary', {
        count: 1,
        more: '',
        track: i18n._(catalogTrackMessages.ielts.label),
        tier: i18n._(catalogTierMessages.foundation.label),
      });

      expect(html).toContain('Nền tảng');
      expect(html).toContain('Xây dựng nền tảng ngôn ngữ thiết yếu từ A1 đến A2.');
      expect(summary).toContain('IELTS Nền tảng');
    } finally {
      i18n.activate('en');
    }
  });

  it('keeps an add failure on the affected card and offers an explicit retry', () => {
    const failed = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel,
      cards: readyModel.cards.map(card => ({ ...card, libraryState: 'failed' as const })),
    }} actions={actions} />);

    expect(failed).toContain('Could not add “analysis” to your library.');
    expect(failed).toContain('Try adding again');
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('In your library');
  });

  it.each([
    [{ kind: 'checking', message: 'Checking this device…' } as const, 'Checking this device…', 'polite'],
    [{ kind: 'downloading', progressPercent: 42, message: 'Downloading verified catalog…' } as const, '42%', 'polite'],
    [{ kind: 'unavailable', isOnline: true, canDownload: false, message: 'No reviewed release is available yet.' } as const, 'Draft vocabulary is never shown here.', 'polite'],
    [{ kind: 'error', isOnline: true, message: 'Catalog could not be opened.', detail: 'Checksum mismatch' } as const, 'Try again', 'assertive'],
  ])('renders the %s availability outcome in a live region', (status, expected, liveMode) => {
    const html = renderToStaticMarkup(<CatalogScreen model={{ ...readyModel, status, cards: [] }} actions={actions} />);

    expect(html).toContain(`aria-live="${liveMode}"`);
    expect(html).toContain(expected);
  });

  it('does not offer a no-op install action when no reviewed release is published', () => {
    const html = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel,
      status: {
        kind: 'unavailable',
        isOnline: true,
        canDownload: false,
        message: 'This language does not have a reviewed release yet.',
      },
      cards: [],
    }} actions={actions} />);

    expect(html).toContain('A download will appear after a reviewed release is published.');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Install English starter catalog');
  });

  it('shows useful personal paths instead of an unavailable catalog for the learner library', () => {
    const personalActions = { ...actions };
    const html = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel,
      status: {
        kind: 'personal',
        message: 'Your path is built from 1,167 cards already in your library.',
      },
      personalLibrary: { total: 1_167, dueToday: 82, learning: 410, learned: 757 },
      cards: [],
    }} actions={personalActions} />);

    expect(html).toContain('Your personal paths');
    expect(html).toContain('Review due');
    expect(html).toContain('82');
    expect(html).toContain('aria-label="Personal learning path: Review due → Keep learning → Mastered"');
    expect(html).toContain('Continue review');
    expect(html).toContain('Open vocabulary');
    expect(html).toContain('No draft catalog vocabulary is mixed into these paths.');
    expect(html).not.toContain('Catalog unavailable');
  });

  it('keeps personal library review reachable when no cards are currently due', () => {
    const html = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel,
      status: {
        kind: 'personal',
        message: 'Your path is built from cards already in your library.',
      },
      personalLibrary: { total: 12, dueToday: 0, learning: 5, learned: 7 },
      cards: [],
    }} actions={actions} />);

    expect(html).toContain('Continue review');
  });

  it('offers a reviewed-catalog check only when the unavailable release is downloadable', () => {
    const html = renderToStaticMarkup(<CatalogScreen model={{
      ...readyModel,
      status: {
        kind: 'unavailable',
        isOnline: true,
        canDownload: true,
        message: 'No reviewed catalog release is installed.',
      },
      cards: [],
    }} actions={actions} />);

    expect(html).toContain('Check for reviewed catalog');
  });

  it('keeps filters visible and offers a reset action for an empty combined-filter result', () => {
    const html = renderToStaticMarkup(
      <CatalogScreen
        model={{
          ...readyModel,
          filters: { ...readyModel.filters, term: 'unmatched', cefr: 'B2', hasActiveFilters: true },
          cards: [],
          resultSummary: 'No words match all selected filters.',
          hasMore: false,
        }}
        actions={actions}
      />,
    );

    expect(html).toContain('Search vocabulary');
    expect(html).toContain('CEFR level');
    expect(html).toContain('No words match all selected filters.');
    expect(html).toContain('Clear all filters');
  });

  it('presents a page refresh as busy without announcing a false empty result', () => {
    const html = renderToStaticMarkup(
      <CatalogScreen
        model={{
          ...readyModel,
          cards: [],
          resultSummary: 'Updating vocabulary…',
          hasMore: false,
          isLoadingPage: true,
        }}
        actions={actions}
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Updating vocabulary…');
    expect(html).toContain('Loading matching vocabulary');
    expect(html).not.toContain('No vocabulary found');
  });

  it('bounds untrusted download progress before presenting it', () => {
    const html = renderToStaticMarkup(
      <CatalogScreen
        model={{ ...readyModel, status: { kind: 'downloading', progressPercent: 142, message: 'Downloading…' }, cards: [] }}
        actions={actions}
      />,
    );

    expect(html).toContain('value="100"');
    expect(html).toContain('100%');
    expect(html).not.toContain('142%');
  });

  it('uses explicit evidence fallbacks instead of presenting blank provenance as reviewed', () => {
    const card = readyModel.cards[0];
    const html = renderToStaticMarkup(
      <CatalogScreen
        model={{
          ...readyModel,
          cards: [{ ...card, provenance: { sourceLabel: '', licenseLabel: '  ', reviewerLabel: '' } }],
        }}
        actions={actions}
      />,
    );

    expect(html).toContain('Source not provided');
    expect(html).toContain('License not provided');
    expect(html).toContain('Human review not recorded');
  });

  it('presents catalog storage failures in the active interface language', () => {
    i18n.load('vi', viCatalog);
    i18n.activate('vi');
    try {
      expect(catalogErrorStatus(new CatalogCacheOpenError('blocked'), true, 'catalogOpenError').message)
        .toContain('một tab SonFlash khác chặn');
      expect(catalogErrorStatus(new CatalogCacheOpenError('timeout'), true, 'catalogOpenError').message)
        .toContain('không phản hồi kịp thời');
    } finally {
      i18n.activate('en');
    }
  });

  it('encodes WCAG-oriented target, reflow, focus and motion safeguards without production data coupling', () => {
    const screenSource = readFileSync(fileURLToPath(new URL('./CatalogScreen.tsx', import.meta.url)), 'utf8');
    const presentationSource = readFileSync(fileURLToPath(new URL('./catalogPresentation.ts', import.meta.url)), 'utf8');

    expect(screenSource).toContain('min-h-11');
    expect(screenSource).toMatch(/grid-cols-1/);
    expect(screenSource).toContain('motion-reduce:transition-none');
    expect(screenSource).toContain('focus-visible:');
    expect(screenSource).not.toContain('outline-none');
    expect(screenSource).not.toMatch(/pilotCatalog|firebase|firestore|IndexedDB/);
    expect(presentationSource).not.toMatch(/pilotCatalog|firebase|firestore|IndexedDB/);
  });
});

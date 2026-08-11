import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CatalogScreen } from './CatalogScreen';
import type { CatalogScreenActions, CatalogScreenModel } from './catalogPresentation';

const readyModel: CatalogScreenModel = {
  status: { kind: 'ready', isOnline: false, isAvailableOffline: true, message: 'English catalog is ready offline.' },
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
    { id: 'foundation', label: 'Foundation', description: 'Build essential language', total: 100, started: 24, mastered: 8, state: 'in-progress' },
    { id: 'core', label: 'Core', description: 'Grow confident range', total: 100, started: 0, mastered: 0, state: 'available' },
    { id: 'advanced', label: 'Advanced', description: 'Handle precise language', total: 100, started: 0, mastered: 0, state: 'locked' },
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
    expect(html).toContain('24 started');
    expect(html).toContain('>8</strong> mastered');
    expect(html).toContain('In progress');
    expect(html).toContain('Locked');
    expect(html).toContain('Foundation · Selected');
    expect(html).toContain('a careful study of something');
    expect(html).toContain('Báo cáo cung cấp phân tích');
    expect(html).toContain('detailed analysis');
    expect(html).toContain('CC BY 4.0');
    expect(html).toContain('Reviewed by Linh Nguyen');
    expect(html).toContain('Add to library');
    expect(html).toContain('Available offline');
    expect(html).toContain('Load more words');
    expect(html).toContain('aria-labelledby="catalog-heading"');
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

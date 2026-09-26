import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import {
  createRadixAlertDialogPassthroughMock,
  createRadixDialogPassthroughMock,
} from '../../testing/radix-dialog-passthrough';
import {
  DeckCreationDialog,
  LibraryClearDialog,
  LibraryInsightsDialog,
  type LibraryInsightsStats,
} from './LibraryDialogOverlays';

i18n.load('en', {});
i18n.activate('en');

vi.mock('@radix-ui/react-dialog', () => createRadixDialogPassthroughMock());
vi.mock('@radix-ui/react-alert-dialog', () => createRadixAlertDialogPassthroughMock());

const renderMarkup = (node: React.ReactNode) => renderToStaticMarkup(
  <I18nProvider i18n={i18n}>{node}</I18nProvider>,
);

const stats: LibraryInsightsStats = {
  total: 12,
  learned: 5,
  learning: 4,
  dueToday: 3,
  categoryChart: [{ name: 'Travel', value: 7 }, { name: 'Work', value: 5 }],
  categoryChartIsPartial: true,
  difficultyChart: [{ name: 'Easy', value: 8 }, { name: 'Hard', value: 4 }],
  xpChartData: [{ date: 'Sep 25', XP: 20 }],
};

describe('library dialog overlays', () => {
  it('exposes the deck create workflow phases and controlled input', () => {
    const idle = renderMarkup(
      <DeckCreationDialog
        open
        onOpenChange={vi.fn()}
        value="Travel"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(idle).toContain('New deck');
    expect(idle).toContain('value="Travel"');
    expect(idle).toContain('Create deck');

    const working = renderMarkup(
      <DeckCreationDialog
        open
        onOpenChange={vi.fn()}
        value="Travel"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        status="working"
      />,
    );
    expect(working).toContain('Creating…');
    expect(working).toContain('aria-busy="true"');

    const failed = renderMarkup(
      <DeckCreationDialog
        open
        onOpenChange={vi.fn()}
        value="Travel"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        status="failure"
        errorMessage="Network unavailable"
      />,
    );
    expect(failed).toContain('Network unavailable');
    expect(failed).toContain('Try again');

    const success = renderMarkup(
      <DeckCreationDialog
        open
        onOpenChange={vi.fn()}
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        status="success"
      />,
    );
    expect(success).toContain('Deck created.');
    expect(success).toContain('Done');
  });

  it('requires an explicit destructive confirmation and reports clear phases', () => {
    const idle = renderMarkup(
      <LibraryClearDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        status="idle"
        cardCount={12}
        deckCount={2}
        masteredCount={5}
        onExport={vi.fn()}
      />,
    );
    expect(idle).toContain('12');
    expect(idle).toContain('Type DELETE to confirm');
    expect(idle).toContain('Export');
    expect(idle).toContain('disabled=""');

    const working = renderMarkup(
      <LibraryClearDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} status="working" />,
    );
    expect(working).toContain('Clearing your library…');
    expect(working).toContain('aria-busy="true"');

    const success = renderMarkup(
      <LibraryClearDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} status="success" />,
    );
    expect(success).toContain('Your library was cleared.');
    expect(success).toContain('Done');
  });

  it('renders supplied insight data and truthful loading and failure states', () => {
    const ready = renderMarkup(
      <LibraryInsightsDialog open onOpenChange={vi.fn()} stats={stats} />,
    );
    expect(ready).toContain('12');
    expect(ready).toContain('Travel');
    expect(ready).toContain('20 XP');
    expect(ready).toContain('Some cloud categories are still loading.');

    const loading = renderMarkup(
      <LibraryInsightsDialog open onOpenChange={vi.fn()} stats={null} phase="loading" />,
    );
    expect(loading).toContain('Loading your learning data…');

    const failure = renderMarkup(
      <LibraryInsightsDialog open onOpenChange={vi.fn()} stats={null} phase="failure" onRetry={vi.fn()} errorMessage="Offline" />,
    );
    expect(failure).toContain('Offline');
    expect(failure).toContain('Retry');
  });
});

import { Plus, Search } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { formatNumber } from '../../lib/format';
import { Lumi } from '../../components/lumi/Lumi';

interface LibraryOverviewProps {
  total: number; due: number; mastered: number; streak: number; level: number; xp: number; canStudy: boolean;
  onStartStudy: () => Promise<void>; onCreateCard: () => void; searchQuery?: string; onSearchChange?: (value: string) => void; deckCount?: number;
}

/** Canvas Vocabulary heading. Review data stays concise and uses live counts. */
export function LibraryOverview({ total, due, onCreateCard, searchQuery = '', onSearchChange, deckCount = 1 }: LibraryOverviewProps) {
  const { i18n } = useLingui();
  return <header className="library-canvas-heading" data-library-region="overview">
    <div className="library-canvas-title"><p className="library-canvas-kicker"><Trans {...msg({ context: 'library.overview.kicker', message: 'Vocabulary' })} /> <span className="library-canvas-kicker-decks"><Trans {...msg({ context: 'library.overview.deck-count', message: '// {count} decks' })} values={{ count: formatNumber(deckCount) }} /></span></p><h2 id="learning-home-heading"><Trans {...msg({ context: 'library.overview.kicker', message: 'Vocabulary' })} /></h2><p className="library-canvas-summary" data-library-evidence="true"><span>{formatNumber(total)}</span> <Trans {...msg({ context: 'library.overview.words', message: 'words' })} /> <span className="library-canvas-summary-decks"><Trans {...msg({ context: 'library.overview.across-decks', message: 'across {count} decks' })} values={{ count: formatNumber(deckCount) }} /></span> · <strong>{due} <Trans {...msg({ context: 'library.overview.due', message: 'due today' })} /></strong></p></div>
    <aside className="library-lumi-hint"><Lumi pose="hint" size={86}/><p><b><Trans {...msg({ context: 'library.overview.lumi-signature', message: 'LUMI · LINK' })} /></b><span><Trans {...msg({ context: 'library.overview.lumi', message: 'Review the cards waiting for you today.' })} /></span></p></aside>
    <label className="library-canvas-search"><Search size={17} aria-hidden="true" /><span className="sr-only"><Trans {...msg({ context: 'library.grid.search-label', message: 'Search words' })} /></span><input type="search" autoComplete="off" value={searchQuery} onChange={event => onSearchChange?.(event.target.value)} placeholder={i18n._(msg({ id: 'library.canvas.search-placeholder', message: 'Search words or meanings…' }))} /><kbd>/</kbd></label>
    <button type="button" data-library-create-action="true" onClick={onCreateCard} className="library-canvas-create"><Plus size={17} aria-hidden="true" /><Trans {...msg({ context: 'library.overview.create-card', message: 'Create card' })} /></button>
  </header>;
}

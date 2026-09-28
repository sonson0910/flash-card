import { Trans } from '@lingui/react';
import { Globe2 } from 'lucide-react';
import { openWebWordsRoute } from './webWordsRoute';
import { STRIP_PREVIEW_COUNT, useWebWordsPreviewCount } from './useWebWordsPreviewCount';

export { STRIP_PREVIEW_COUNT };

/** Pure rendering half, split out from the data-fetching wrapper below purely so it is testable with `renderToStaticMarkup` (no live effect needed to exercise it). */
export function WebWordsTodayStripView({ previewCount }: { readonly previewCount: number }) {
  if (previewCount === 0) return null;
  // The strip requests at most STRIP_PREVIEW_COUNT documents (no lookahead read), so hitting that
  // exact number never proves there are no more; say "N+" instead of implying an exact total.
  const isAtCap = previewCount >= STRIP_PREVIEW_COUNT;

  return (
    <aside className="liquid-control crystal-chamfer-sm flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--sf-border)] px-4 py-3">
      <span className="flex items-center gap-2 text-sm font-bold text-[var(--sf-text)]">
        <Globe2 size={16} className="shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
        {isAtCap ? (
          <Trans id="webWords.todayStrip.summary-at-least" message="{count}+ words saved from the web" values={{ count: previewCount }} />
        ) : (
          <Trans
            id="webWords.todayStrip.summary"
            message="{count, plural, one {# word} other {# words}} saved from the web"
            values={{ count: previewCount }}
          />
        )}
      </span>
      <button
        type="button"
        onClick={openWebWordsRoute}
        className="min-h-9 rounded-full border border-[var(--sf-border)] px-4 text-sm font-bold text-[var(--sf-brand-text)] transition-colors hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Trans id="webWords.todayStrip.action" message="Review web words" />
      </button>
    </aside>
  );
}

/**
 * The workspace supplies the active owner and target language. It is lazy-loaded
 * and asks for a bounded 5-card page with `detectHasNext: false` (no lookahead
 * document), so it never pages beyond that first read.
 */
export function WebWordsTodayStrip({ ownerId, targetLanguage }: { readonly ownerId: string | null; readonly targetLanguage: string | null }) {
  const previewCount = useWebWordsPreviewCount(ownerId, targetLanguage);

  return <WebWordsTodayStripView previewCount={previewCount} />;
}

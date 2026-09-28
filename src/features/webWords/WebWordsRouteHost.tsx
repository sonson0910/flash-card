import { lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import { useWebWordsRoute } from './webWordsRoute';

// The page can open from any view, so it brings its own catalog instead of relying on Today's.
const WebWordsPage = lazy(() => Promise.all([
  import('./WebWordsPage'), loadCatalog(getActiveUiLocale(), 'today'),
]).then(([module]) => ({ default: module.WebWordsPage })));

/**
 * Watches the `?webWords=1` route and mounts the page only while it is open.
 * The app shell lazy-loads this host so neither the route listener nor the
 * page adds to the initial bundle.
 */
export interface WebWordsRouteHostProps {
  readonly ownerId: string | null;
  readonly targetLanguage: string | null;
}

export function WebWordsRouteHost({ ownerId, targetLanguage }: WebWordsRouteHostProps) {
  const route = useWebWordsRoute();
  if (!route.isOpen) return null;
  return createPortal(
    <Suspense fallback={null}>
      <WebWordsPage ownerId={ownerId} targetLanguage={targetLanguage} onClose={route.close} />
    </Suspense>,
    document.body,
  );
}

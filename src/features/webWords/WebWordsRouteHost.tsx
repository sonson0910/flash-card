import { lazy, Suspense, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import { LEARNING_WORKSPACE_ID } from '../../components/shell/SkipToContentLink';
import { readAppViewMode } from '../navigation/useAppNavigation';
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
  readonly translationLanguage: string | null;
}

export function WebWordsRouteHost({ ownerId, targetLanguage, translationLanguage }: WebWordsRouteHostProps) {
  const route = useWebWordsRoute();
  const { isOpen, dismiss } = route;
  const view = readAppViewMode(window.location.href);
  const openedOnViewRef = useRef<string | null>(null);

  // The shell header stays usable while the page is open; moving to another view closes the page in place.
  useEffect(() => {
    if (!isOpen) {
      openedOnViewRef.current = null;
      return;
    }
    if (openedOnViewRef.current === null) openedOnViewRef.current = view;
    else if (openedOnViewRef.current !== view) dismiss();
  });

  if (!isOpen) return null;
  const workspace = document.getElementById(LEARNING_WORKSPACE_ID);
  return createPortal(
    <Suspense fallback={null}>
      <WebWordsPage
        ownerId={ownerId}
        targetLanguage={targetLanguage}
        translationLanguage={translationLanguage}
        onClose={route.close}
        placement={workspace ? 'workspace' : 'screen'}
      />
    </Suspense>,
    workspace ?? document.body,
  );
}

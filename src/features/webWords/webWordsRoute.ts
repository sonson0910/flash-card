import { createAppViewLocation, readAppViewMode } from '../navigation/useAppNavigation';

/**
 * Opens the web words view from places that do not hold the app navigation
 * (the Today strip's "See all" link). The view is a routed app view
 * (`?view=web-words`) hosted by the app runtime; this pushes the same location
 * `setViewMode('web-words')` would, remembering the opener for the back link,
 * and lets the navigation hook pick it up through `popstate`.
 */
export function openWebWordsRoute(): void {
  if (typeof window === 'undefined') return;
  const current = window.location.href;
  const location = createAppViewLocation(current, 'web-words', { returnView: readAppViewMode(current) });
  window.history.pushState(window.history.state, '', location);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import type { ReactNode } from 'react';
import type { AppViewMode } from '../../features/navigation/useAppNavigation';
import { triggerHaptic } from '../../lib/haptics';
import { useTheme } from '../../features/theme/ThemeProvider';
import { shellNavigationView } from './shellTypes';

interface FloatingMobileNavProps { activeView: AppViewMode; onSelectView: (view: AppViewMode) => void; }

type MobileTabView = 'today' | 'catalog' | 'library' | 'progress';

/** Tab icons drawn from the MobileToday (classic) and AnimeMobile (Crystal) boards. */
const TAB_ICON_PATHS: Record<'classic' | 'crystal', Record<MobileTabView, string>> = {
  classic: {
    today: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    catalog: 'M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z',
    library: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
    progress: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  },
  crystal: {
    today: 'M12 1.5l3 7.1 7.7.6-5.9 5 1.8 7.5L12 17.7l-6.6 4 1.8-7.5-5.9-5 7.7-.6z',
    catalog: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
    library: 'M7 3h12v16H7zM4 6v15h12',
    progress: 'M8 21h8M12 17v4M6 3h12v5a6 6 0 0 1-12 0zM6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3',
  },
};

function TabIcon({ path, crystal }: { readonly path: string; readonly crystal: boolean }) {
  const size = crystal ? 20 : 18;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={crystal ? 2 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

export function FloatingMobileNav({ activeView, onSelectView }: FloatingMobileNavProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  if (['study', 'quiz', 'spelling', 'story', 'match', 'shadowing', 'landing'].includes(activeView)) return null;
  const crystal = family === 'crystal';
  const highlighted = shellNavigationView(activeView === 'language-drill' ? 'spelling' : activeView);
  const items: ReadonlyArray<{ readonly view: MobileTabView; readonly label: ReactNode }> = [
    { view: 'today', label: <Trans {...msg({ id: 'shell.nav.today', message: 'Today' })} /> },
    { view: 'catalog', label: <Trans {...msg({ id: 'shell.nav.paths', message: 'Paths' })} /> },
    // The boards label this tab Words / Cards; the app keeps its established destination name.
    { view: 'library', label: crystal
      ? <Trans {...msg({ context: 'shell.nav.collection', message: 'Collection' })} />
      : <Trans {...msg({ id: 'shell.nav.vocabulary', message: 'Vocabulary' })} /> },
    { view: 'progress', label: <Trans {...msg({ id: 'shell.nav.progress', message: 'Progress' })} /> },
  ];
  return <nav data-shell-layer="mobile" className="claude-mobile-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 items-stretch lg:hidden" aria-label={_(msg({ id: 'shell.navigation.mobile', message: 'Mobile navigation' }))}>
    {items.map(({ view, label }) => {
      const active = highlighted === view;
      return <button key={view} type="button" onClick={() => { triggerHaptic('light'); onSelectView(view); }} data-shell-active={active ? 'true' : undefined} aria-current={active ? 'page' : undefined} className="claude-mobile-nav-item flex min-h-11 flex-col items-center justify-center gap-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none">
        <span className="claude-mobile-nav-icon" aria-hidden="true"><TabIcon path={TAB_ICON_PATHS[crystal ? 'crystal' : 'classic'][view]} crystal={crystal} /></span>
        <span className="claude-mobile-nav-label">{label}</span>
      </button>;
    })}
  </nav>;
}

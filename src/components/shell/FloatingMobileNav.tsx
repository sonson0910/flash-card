import { BookOpen, Flame, Map, Trophy } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import type { AppViewMode } from '../../features/navigation/useAppNavigation';
import { triggerHaptic } from '../../lib/haptics';
import { useTheme } from '../../features/theme/ThemeProvider';

interface FloatingMobileNavProps { activeView: AppViewMode; onSelectView: (view: AppViewMode) => void; }

export function FloatingMobileNav({ activeView, onSelectView }: FloatingMobileNavProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  if (['study', 'quiz', 'spelling', 'story', 'match', 'shadowing', 'landing'].includes(activeView)) return null;
  const items = family === 'crystal'
    ? [
        { view: 'today', icon: Flame, label: <Trans id="shell.nav.today" message="Today" /> },
        { view: 'catalog', icon: Map, label: <Trans id="shell.nav.paths" message="Paths" /> },
        { view: 'library', icon: BookOpen, label: <Trans id="shell.nav.collection" message="Collection" /> },
        { view: 'progress', icon: Trophy, label: <Trans id="shell.nav.progress" message="Progress" /> },
      ] as const
    : [
        { view: 'today', icon: Flame, label: <Trans id="shell.nav.today" message="Today" /> },
        { view: 'catalog', icon: Map, label: <Trans id="shell.nav.paths" message="Paths" /> },
        { view: 'library', icon: BookOpen, label: <Trans id="shell.nav.vocabulary" message="Vocabulary" /> },
        { view: 'progress', icon: Trophy, label: <Trans id="shell.nav.progress" message="Progress" /> },
      ] as const;
  return <nav data-shell-layer="mobile" className="claude-mobile-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 items-stretch lg:hidden" aria-label={_(msg({ id: 'shell.navigation.mobile', message: 'Mobile navigation' }))}>
    {items.map(({ view, icon: Icon, label }) => {
      const active = activeView === view;
      return <button key={view} type="button" onClick={() => { triggerHaptic('light'); onSelectView(view); }} data-shell-active={active ? 'true' : undefined} aria-current={active ? 'page' : undefined} className="claude-mobile-nav-item flex min-h-11 flex-col items-center justify-center gap-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none">
        <Icon size={20} aria-hidden="true" />
        <span>{label}</span>
      </button>;
    })}
  </nav>;
}

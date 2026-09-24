import { BookOpen, Flame, Map, Trophy } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import type { AppViewMode } from '../../features/navigation/useAppNavigation';
import { triggerHaptic } from '../../lib/haptics';

interface FloatingMobileNavProps { activeView: AppViewMode; onSelectView: (view: AppViewMode) => void; }
const items = [{ view: 'today', icon: Flame, label: <Trans id="shell.nav.today" message="Today" /> }, { view: 'catalog', icon: Map, label: <Trans id="shell.nav.paths" message="Paths" /> }, { view: 'library', icon: BookOpen, label: <Trans id="shell.nav.vocabulary" message="Vocabulary" /> }, { view: 'progress', icon: Trophy, label: <Trans id="shell.nav.progress" message="Progress" /> }] as const;

export function FloatingMobileNav({ activeView, onSelectView }: FloatingMobileNavProps) {
  const { _ } = useLingui();
  if (['study', 'quiz', 'spelling', 'story', 'match', 'shadowing', 'landing'].includes(activeView)) return null;
  return <nav data-shell-layer="mobile" className="premium-surface fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center justify-around rounded-2xl border border-[var(--sf-border)] p-1.5 lg:hidden crystal-chamfer" aria-label={_(msg({ id: 'shell.navigation.mobile', message: 'Mobile navigation' }))}>{items.map(({ view, icon: Icon, label }) => { const active = activeView === view; return <button key={view} type="button" onClick={() => { triggerHaptic('light'); onSelectView(view); }} data-shell-active={active ? 'true' : undefined} aria-current={active ? 'page' : undefined} className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none ${active ? 'bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)]' : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]'}`}><Icon size={18} aria-hidden="true" className={active ? 'text-[var(--sf-brand-text)]' : ''} /><span>{label}</span></button>; })}</nav>;
}

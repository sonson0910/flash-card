import { BookOpen, Flame, House, Map, Trophy } from 'lucide-react';
import type { AppViewMode } from '../../features/navigation/useAppNavigation';
import { triggerHaptic } from '../../lib/haptics';

interface FloatingMobileNavProps {
  activeView: AppViewMode;
  onSelectView: (view: AppViewMode) => void;
}

export function FloatingMobileNav({
  activeView,
  onSelectView,
}: FloatingMobileNavProps) {
  const isPracticeActive = ['study', 'quiz', 'spelling', 'story', 'match', 'shadowing', 'landing'].includes(activeView);

  if (isPracticeActive) return null;

  const handleSelect = (view: AppViewMode) => {
    triggerHaptic('light');
    onSelectView(view);
  };

  return (
    <nav
      data-shell-layer="mobile"
      className="premium-surface fixed bottom-4 inset-x-4 z-40 mx-auto flex max-w-md items-center justify-around rounded-full p-1.5 md:hidden"
      aria-label="Mobile navigation bar"
    >
      {/* Home / Landing Tab */}
      <button
        type="button"
        onClick={() => handleSelect('landing')}
        data-shell-active={activeView === 'landing' ? 'true' : undefined}
        className={`flex min-h-11 flex-1 flex-col items-center gap-1 rounded-full py-1.5 transition-all active:scale-95 ${
          activeView === 'landing'
            ? 'bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)] font-extrabold'
            : 'text-slate-600 hover:text-slate-900 dark:text-white/70 dark:hover:text-white'
        }`}
        aria-label="Home"
        aria-current={activeView === 'landing' ? 'page' : undefined}
      >
        <House size={18} className={activeView === 'landing' ? 'fill-[var(--sf-brand)]/20 text-[var(--sf-brand-text)] dark:fill-cyan-400/20 dark:text-cyan-300' : ''} />
        <span className="text-[10px] font-bold">Home</span>
      </button>

      {/* Today Tab */}
      <button
        type="button"
        onClick={() => handleSelect('today')}
        data-shell-active={activeView === 'today' ? 'true' : undefined}
        className={`flex min-h-11 flex-1 flex-col items-center gap-1 rounded-full py-1.5 transition-all active:scale-95 ${
          activeView === 'today'
            ? 'bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)] font-extrabold'
            : 'text-slate-600 hover:text-slate-900 dark:text-white/70 dark:hover:text-white'
        }`}
        aria-label="Today's plan"
        aria-current={activeView === 'today' ? 'page' : undefined}
      >
        <Flame size={18} className={activeView === 'today' ? 'fill-[var(--sf-brand)]/20 text-[var(--sf-brand-text)] dark:fill-cyan-400/20 dark:text-cyan-300' : ''} />
        <span className="text-[10px] font-bold">Today</span>
      </button>

      {/* Paths Tab */}
      <button
        type="button"
        onClick={() => handleSelect('catalog')}
        data-shell-active={activeView === 'catalog' ? 'true' : undefined}
        className={`flex min-h-11 flex-1 flex-col items-center gap-1 rounded-full py-1.5 transition-all active:scale-95 ${
          activeView === 'catalog'
            ? 'bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)] font-extrabold'
            : 'text-slate-600 hover:text-slate-900 dark:text-white/70 dark:hover:text-white'
        }`}
        aria-label="Paths"
        aria-current={activeView === 'catalog' ? 'page' : undefined}
      >
        <Map size={18} aria-hidden="true" />
        <span className="text-[10px] font-bold">Paths</span>
      </button>

      {/* Library Tab */}
      <button
        type="button"
        onClick={() => handleSelect('library')}
        data-shell-active={activeView === 'library' ? 'true' : undefined}
        className={`flex min-h-11 flex-1 flex-col items-center gap-1 rounded-full py-1.5 transition-all active:scale-95 ${
          activeView === 'library'
            ? 'bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)] font-extrabold'
            : 'text-slate-600 hover:text-slate-900 dark:text-white/70 dark:hover:text-white'
        }`}
        aria-label="Vocabulary Library"
        aria-current={activeView === 'library' ? 'page' : undefined}
      >
        <BookOpen size={18} className={activeView === 'library' ? 'fill-[var(--sf-brand)]/20 text-[var(--sf-brand-text)] dark:fill-cyan-400/20 dark:text-cyan-300' : ''} />
        <span className="text-[10px] font-bold">Vocabulary</span>
      </button>

      {/* Progress / Stats Tab */}
      <button
        type="button"
        onClick={() => handleSelect('progress')}
        data-shell-active={activeView === 'progress' ? 'true' : undefined}
        className={`flex min-h-11 flex-1 flex-col items-center gap-1 rounded-full py-1.5 transition-all active:scale-95 ${
          activeView === 'progress'
            ? 'bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)] font-extrabold'
            : 'text-slate-600 hover:text-slate-900 dark:text-white/70 dark:hover:text-white'
        }`}
        aria-label="Progress & Achievements"
        aria-current={activeView === 'progress' ? 'page' : undefined}
      >
        <Trophy size={18} className={activeView === 'progress' ? 'fill-[var(--sf-brand)]/20 text-[var(--sf-brand-text)] dark:fill-cyan-400/20 dark:text-cyan-300' : ''} />
        <span className="text-[10px] font-bold">Progress</span>
      </button>
    </nav>
  );
}

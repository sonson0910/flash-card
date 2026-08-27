import { BookOpen, Flame, Map, Trophy } from 'lucide-react';
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
      data-shell-grammar="cold-mineral"
      data-shell-identity="memory-atelier"
      className="app-mobile-nav fixed bottom-[max(1rem,env(safe-area-inset-bottom))] inset-x-4 z-40 mx-auto flex max-w-md items-center justify-around p-1.5 lg:hidden"
      aria-label="Mobile navigation bar"
    >
      {/* Today Tab */}
      <button
        type="button"
        onClick={() => handleSelect('today')}
        data-shell-active={activeView === 'today' ? 'true' : undefined}
        className={`app-mobile-nav__item flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition-colors active:scale-95 ${
          activeView === 'today'
            ? 'text-[var(--sf-brand-text)] font-extrabold'
            : ''
        }`}
        aria-label="Today's plan"
        aria-current={activeView === 'today' ? 'page' : undefined}
      >
        <Flame size={18} className={activeView === 'today' ? 'fill-[var(--sf-brand)]/20 text-[var(--sf-brand-text)] dark:fill-cyan-400/20 dark:text-cyan-300' : ''} aria-hidden="true" />
        <span className="text-[10px] font-bold">Today</span>
        <span className="app-mobile-nav__active-marker" aria-hidden="true" />
      </button>

      {/* Paths Tab */}
      <button
        type="button"
        onClick={() => handleSelect('catalog')}
        data-shell-active={activeView === 'catalog' ? 'true' : undefined}
        className={`app-mobile-nav__item flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition-colors active:scale-95 ${
          activeView === 'catalog'
            ? 'text-[var(--sf-brand-text)] font-extrabold'
            : ''
        }`}
        aria-label="Learning paths"
        aria-current={activeView === 'catalog' ? 'page' : undefined}
      >
        <Map size={18} className={activeView === 'catalog' ? 'fill-[var(--sf-brand)]/20 text-[var(--sf-brand-text)] dark:fill-cyan-400/20 dark:text-cyan-300' : ''} aria-hidden="true" />
        <span className="text-[10px] font-bold">Paths</span>
        <span className="app-mobile-nav__active-marker" aria-hidden="true" />
      </button>

      {/* Library Tab */}
      <button
        type="button"
        onClick={() => handleSelect('library')}
        data-shell-active={activeView === 'library' ? 'true' : undefined}
        className={`app-mobile-nav__item flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition-colors active:scale-95 ${
          activeView === 'library'
            ? 'text-[var(--sf-brand-text)] font-extrabold'
            : ''
        }`}
        aria-label="Vocabulary Library"
        aria-current={activeView === 'library' ? 'page' : undefined}
      >
        <BookOpen size={18} className={activeView === 'library' ? 'fill-[var(--sf-brand)]/20 text-[var(--sf-brand-text)] dark:fill-cyan-400/20 dark:text-cyan-300' : ''} aria-hidden="true" />
        <span className="text-[10px] font-bold">Library</span>
        <span className="app-mobile-nav__active-marker" aria-hidden="true" />
      </button>

      {/* Progress / Stats Tab */}
      <button
        type="button"
        onClick={() => handleSelect('progress')}
        data-shell-active={activeView === 'progress' ? 'true' : undefined}
        className={`app-mobile-nav__item flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition-colors active:scale-95 ${
          activeView === 'progress'
            ? 'text-[var(--sf-brand-text)] font-extrabold'
            : ''
        }`}
        aria-label="Progress & Achievements"
        aria-current={activeView === 'progress' ? 'page' : undefined}
      >
        <Trophy size={18} className={activeView === 'progress' ? 'fill-[var(--sf-brand)]/20 text-[var(--sf-brand-text)] dark:fill-cyan-400/20 dark:text-cyan-300' : ''} aria-hidden="true" />
        <span className="text-[10px] font-bold">Progress</span>
        <span className="app-mobile-nav__active-marker" aria-hidden="true" />
      </button>
    </nav>
  );
}

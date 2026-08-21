import { BookOpen, Flame, Map, Trophy } from 'lucide-react';
import type { AppViewMode } from '../../features/navigation/useAppNavigation';
import { triggerHaptic } from '../../lib/haptics';

interface FloatingMobileNavProps {
  activeView: AppViewMode;
  onSelectView: (view: AppViewMode) => void;
}

const navigationItems = [
  { view: 'today', label: "Today's plan", text: 'Today', Icon: Flame },
  { view: 'catalog', label: 'Learning paths', text: 'Paths', Icon: Map },
  { view: 'library', label: 'Vocabulary Library', text: 'Vocabulary', Icon: BookOpen },
  { view: 'progress', label: 'Progress & Achievements', text: 'Progress', Icon: Trophy },
] as const;

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
      className="fixed bottom-4 inset-x-4 z-40 mx-auto flex max-w-md items-center justify-around rounded-full border border-white/20 bg-[#071014]/90 p-2 shadow-2xl backdrop-blur-2xl md:hidden"
      aria-label="Mobile navigation bar"
    >
      {navigationItems.map(({ view, label, text, Icon }) => {
        const isActive = activeView === view;
        return (
          <button
            key={view}
            type="button"
            onClick={() => handleSelect(view)}
            className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-full py-1.5 transition-all active:scale-95 ${
              isActive
                ? 'text-cyan-300 font-extrabold'
                : 'text-white/70 hover:text-white'
            }`}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={18} aria-hidden="true" className={isActive ? 'fill-cyan-400/20 text-cyan-300' : ''} />
            <span className="text-[10px] font-bold">{text}</span>
          </button>
        );
      })}
    </nav>
  );
}

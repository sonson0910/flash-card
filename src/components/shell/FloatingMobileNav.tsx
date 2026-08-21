import { BookOpen, Flame, House, Trophy } from 'lucide-react';
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
      className="fixed bottom-4 inset-x-4 z-40 mx-auto flex max-w-md items-center justify-around rounded-full border border-white/20 bg-[#071014]/90 p-2 shadow-2xl backdrop-blur-2xl md:hidden"
      aria-label="Mobile navigation bar"
    >
      {/* Home / Landing Tab */}
      <button
        type="button"
        onClick={() => handleSelect('landing')}
        className={`flex flex-1 flex-col items-center gap-1 rounded-full py-1.5 transition-all active:scale-95 ${
          activeView === 'landing'
            ? 'text-cyan-300 font-extrabold'
            : 'text-white/70 hover:text-white'
        }`}
        aria-label="Home"
        aria-current={activeView === 'landing' ? 'page' : undefined}
      >
        <House size={18} className={activeView === 'landing' ? 'fill-cyan-400/20 text-cyan-300' : ''} />
        <span className="text-[10px] font-bold">Home</span>
      </button>

      {/* Today Tab */}
      <button
        type="button"
        onClick={() => handleSelect('today')}
        className={`flex flex-1 flex-col items-center gap-1 rounded-full py-1.5 transition-all active:scale-95 ${
          activeView === 'today'
            ? 'text-cyan-300 font-extrabold'
            : 'text-white/70 hover:text-white'
        }`}
        aria-label="Today's plan"
        aria-current={activeView === 'today' ? 'page' : undefined}
      >
        <Flame size={18} className={activeView === 'today' ? 'fill-cyan-400/20 text-cyan-300' : ''} />
        <span className="text-[10px] font-bold">Today</span>
      </button>

      {/* Library Tab */}
      <button
        type="button"
        onClick={() => handleSelect('library')}
        className={`flex flex-1 flex-col items-center gap-1 rounded-full py-1.5 transition-all active:scale-95 ${
          activeView === 'library'
            ? 'text-cyan-300 font-extrabold'
            : 'text-white/70 hover:text-white'
        }`}
        aria-label="Vocabulary Library"
        aria-current={activeView === 'library' ? 'page' : undefined}
      >
        <BookOpen size={18} className={activeView === 'library' ? 'fill-cyan-400/20 text-cyan-300' : ''} />
        <span className="text-[10px] font-bold">Library</span>
      </button>

      {/* Progress / Stats Tab */}
      <button
        type="button"
        onClick={() => handleSelect('progress')}
        className={`flex flex-1 flex-col items-center gap-1 rounded-full py-1.5 transition-all active:scale-95 ${
          activeView === 'progress'
            ? 'text-cyan-300 font-extrabold'
            : 'text-white/70 hover:text-white'
        }`}
        aria-label="Progress & Achievements"
        aria-current={activeView === 'progress' ? 'page' : undefined}
      >
        <Trophy size={18} className={activeView === 'progress' ? 'fill-cyan-400/20 text-cyan-300' : ''} />
        <span className="text-[10px] font-bold">Progress</span>
      </button>
    </nav>
  );
}

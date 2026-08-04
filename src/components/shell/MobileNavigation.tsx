import type { MouseEvent } from 'react';
import { BarChart3, BookOpen, Gamepad2, Map, Play } from 'lucide-react';
import { isPracticeView, type ShellViewMode } from './shellTypes';

export interface MobileNavigationProps {
  viewMode: ShellViewMode;
  canUseVisibleLibrary: boolean;
  practiceLibraryCount: number;
  isPracticeMenuOpen: boolean;
  isStatsOpen: boolean;
  onOpenLibrary: () => void;
  onOpenCatalog: () => void;
  onStartStudy: () => void | Promise<void>;
  onOpenPractice: (event: MouseEvent<HTMLButtonElement>) => void;
  onOpenInsights: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function MobileNavigation({
  viewMode,
  canUseVisibleLibrary,
  practiceLibraryCount,
  isPracticeMenuOpen,
  isStatsOpen,
  onOpenLibrary,
  onOpenCatalog,
  onStartStudy,
  onOpenPractice,
  onOpenInsights,
}: MobileNavigationProps) {
  const practiceActive = isPracticeView(viewMode);

  return (
    <div role="navigation" aria-label="Primary" className={`${viewMode === 'study' ? 'hidden' : 'flex'} lg:hidden fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-50 liquid-glass min-h-14 rounded-[22px] items-center justify-around px-2 transition-transform`}>
      <button type="button" onClick={onOpenLibrary} className={`min-h-11 flex flex-col items-center justify-center gap-0.5 flex-1 py-1 cursor-pointer transition-colors rounded-xl ${viewMode === 'library' ? 'bg-[var(--sf-surface-raised)] text-cyan-700 dark:text-cyan-300 font-black' : 'text-[var(--sf-text-muted)]'}`} aria-current={viewMode === 'library' ? 'page' : undefined}>
        <BookOpen size={18} aria-hidden="true" />
        <span className="text-[10px] font-extrabold">Library</span>
      </button>
      <button type="button" onClick={onOpenCatalog} className={`min-h-11 flex flex-col items-center justify-center gap-0.5 flex-1 py-1 cursor-pointer transition-colors rounded-xl ${viewMode === 'catalog' ? 'bg-[var(--sf-surface-raised)] text-cyan-700 dark:text-cyan-300 font-black' : 'text-[var(--sf-text-muted)]'}`} aria-current={viewMode === 'catalog' ? 'page' : undefined}>
        <Map size={18} aria-hidden="true" />
        <span className="text-[10px] font-extrabold">Paths</span>
      </button>
      <button type="button" onClick={onStartStudy} disabled={!canUseVisibleLibrary} className={`min-h-11 flex flex-col items-center justify-center gap-0.5 flex-1 py-1 cursor-pointer transition-colors rounded-xl disabled:opacity-40 disabled:cursor-not-allowed ${viewMode === 'study' ? 'text-cyan-700 dark:text-cyan-300 font-black scale-105' : 'text-[var(--sf-text-muted)]'}`}>
        <Play size={18} aria-hidden="true" />
        <span className="text-[10px] font-extrabold">Study</span>
      </button>
      <button type="button" onClick={onOpenPractice} disabled={practiceLibraryCount < 4} className={`min-h-11 flex flex-col items-center justify-center gap-0.5 flex-1 py-1 cursor-pointer transition-colors rounded-xl disabled:opacity-40 disabled:cursor-not-allowed ${practiceActive ? 'text-cyan-700 dark:text-cyan-300 font-black scale-105' : 'text-[var(--sf-text-muted)]'}`} aria-current={practiceActive ? 'page' : undefined} aria-haspopup="dialog" aria-expanded={isPracticeMenuOpen}>
        <Gamepad2 size={18} aria-hidden="true" />
        <span className="text-[10px] font-extrabold">Practice</span>
      </button>
      <button type="button" onClick={onOpenInsights} aria-pressed={isStatsOpen} aria-haspopup="dialog" className={`min-h-11 flex flex-col items-center justify-center gap-0.5 flex-1 py-1 cursor-pointer transition-all rounded-xl ${isStatsOpen ? 'text-cyan-700 dark:text-cyan-300 font-black scale-105' : 'text-[var(--sf-text-muted)]'}`}>
        <BarChart3 size={18} aria-hidden="true" />
        <span className="text-[10px] font-extrabold">Insights</span>
      </button>
    </div>
  );
}

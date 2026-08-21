import { BarChart3, BookOpen, House, Map } from 'lucide-react';
import { isPracticeView, type ShellViewMode } from './shellTypes';

export interface MobileNavigationProps {
  viewMode: ShellViewMode;
  onOpenToday: () => void;
  onOpenLibrary: () => void;
  onOpenCatalog: () => void;
  onOpenProgress: () => void;
}

export function MobileNavigation({
  viewMode,
  onOpenToday,
  onOpenLibrary,
  onOpenCatalog,
  onOpenProgress,
}: MobileNavigationProps) {
  return (
    <div role="navigation" aria-label="Primary" className={`${isPracticeView(viewMode) ? 'hidden' : 'grid'} lg:hidden fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-50 liquid-glass min-h-14 grid-cols-[repeat(auto-fit,minmax(min(100%,4rem),1fr))] rounded-[22px] items-center gap-1 px-2 py-1 transition-transform`}>
      <button type="button" onClick={onOpenToday} className={`min-h-11 min-w-0 w-full flex flex-col items-center justify-center gap-0.5 py-1 cursor-pointer transition-colors rounded-xl ${viewMode === 'today' ? 'bg-[var(--sf-surface-raised)] text-cyan-700 dark:text-cyan-300 font-black' : 'text-[var(--sf-text-muted)]'}`} aria-current={viewMode === 'today' ? 'page' : undefined}>
        <House size={18} aria-hidden="true" />
        <span className="text-[10px] font-extrabold">Today</span>
      </button>
      <button type="button" onClick={onOpenCatalog} className={`min-h-11 min-w-0 w-full flex flex-col items-center justify-center gap-0.5 py-1 cursor-pointer transition-colors rounded-xl ${viewMode === 'catalog' ? 'bg-[var(--sf-surface-raised)] text-cyan-700 dark:text-cyan-300 font-black' : 'text-[var(--sf-text-muted)]'}`} aria-current={viewMode === 'catalog' ? 'page' : undefined}>
        <Map size={18} aria-hidden="true" />
        <span className="text-[10px] font-extrabold">Paths</span>
      </button>
      <button type="button" onClick={onOpenLibrary} className={`min-h-11 min-w-0 w-full flex flex-col items-center justify-center gap-0.5 py-1 cursor-pointer transition-colors rounded-xl ${viewMode === 'library' ? 'bg-[var(--sf-surface-raised)] text-cyan-700 dark:text-cyan-300 font-black' : 'text-[var(--sf-text-muted)]'}`} aria-current={viewMode === 'library' ? 'page' : undefined}>
        <BookOpen size={18} aria-hidden="true" />
        <span className="text-[10px] font-extrabold">Vocabulary</span>
      </button>
      <button type="button" onClick={onOpenProgress} className={`min-h-11 min-w-0 w-full flex flex-col items-center justify-center gap-0.5 py-1 cursor-pointer transition-colors rounded-xl ${viewMode === 'progress' ? 'bg-[var(--sf-surface-raised)] text-cyan-700 dark:text-cyan-300 font-black' : 'text-[var(--sf-text-muted)]'}`} aria-current={viewMode === 'progress' ? 'page' : undefined}>
        <BarChart3 size={18} aria-hidden="true" />
        <span className="text-[10px] font-extrabold">Progress</span>
      </button>
    </div>
  );
}

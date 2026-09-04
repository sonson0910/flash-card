import { Download, Loader2, Settings2, Sparkles, Trash2, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSoundSettings } from '../../lib/interactionSounds';
import { useZenGlassMode } from '../../lib/useZenGlassMode';

interface LibraryManagementMenuProps {
  readonly isExporting?: boolean;
  readonly isLibraryMutationPending?: boolean;
  readonly onExportLibrary?: () => void | Promise<void>;
  readonly onClearLibrary?: (focusReturnTarget: HTMLButtonElement) => void;
}

const menuItemClass = 'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-slate-800 dark:text-slate-200 transition-colors hover:bg-slate-100 dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none cursor-pointer';

export function LibraryManagementMenu({
  isExporting = false,
  isLibraryMutationPending = false,
  onExportLibrary,
  onClearLibrary,
}: LibraryManagementMenuProps) {
  const { isSoundEnabled: soundActive, toggleSound } = useSoundSettings();
  const [isZenMode, setZenMode] = useZenGlassMode();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const availableItems = () => Array.from(
    rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
  ).filter(item => !item.disabled);
  const focusItem = (position: 'first' | 'last') => {
    const items = availableItems();
    items[position === 'first' ? 0 : items.length - 1]?.focus();
  };
  const openAndFocus = (position: 'first' | 'last') => {
    setIsOpen(true);
    globalThis.requestAnimationFrame(() => focusItem(position));
  };
  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openAndFocus(event.key === 'ArrowDown' ? 'first' : 'last');
  };
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = availableItems();
    const currentIndex = items.findIndex(item => item === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusItem(event.key === 'Home' ? 'first' : 'last');
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length > 0) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? (direction > 0 ? 0 : items.length - 1)
        : (currentIndex + direction + items.length) % items.length;
      items[nextIndex]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative z-20 w-fit">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Manage library"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="library-management-menu"
        title="Manage library"
        style={{ minHeight: 44 }}
        onClick={() => setIsOpen(open => !open)}
        onKeyDown={handleTriggerKeyDown}
        className="liquid-control flex size-11 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-white/90 text-slate-700 shadow-xs transition-colors hover:border-cyan-300/70 hover:text-cyan-600 dark:border-white/15 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:border-cyan-400/50 dark:hover:bg-cyan-400/10 dark:hover:text-cyan-300 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
      >
        <Settings2 size={18} aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          id="library-management-menu"
          role="menu"
          aria-label="Library management"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-slate-200/90 bg-white/95 p-2 shadow-2xl backdrop-blur-2xl dark:border-white/15 dark:bg-slate-900/95 z-50 transition-all duration-150"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              toggleSound();
            }}
            className={menuItemClass}
          >
            {soundActive ? <Volume2 size={17} aria-hidden="true" className="text-cyan-600 dark:text-cyan-400 shrink-0" /> : <VolumeX size={17} aria-hidden="true" className="text-slate-400 shrink-0" />}
            <span className="truncate">{soundActive ? 'Sound effects: On' : 'Sound effects: Muted'}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setZenMode(prev => !prev);
            }}
            className={menuItemClass}
            title="Toggle between Standard Learning mode and Zen Minimalist Glass mode"
          >
            <Sparkles size={17} aria-hidden="true" className={isZenMode ? 'text-cyan-600 dark:text-cyan-400 shrink-0 animate-pulse' : 'text-slate-400 shrink-0'} />
            <span className="truncate">{isZenMode ? 'Card style: Zen Glass' : 'Card style: Standard'}</span>
          </button>
          {onExportLibrary && (
            <button
              type="button"
              role="menuitem"
              disabled={isExporting}
              onClick={() => {
                setIsOpen(false);
                void onExportLibrary();
              }}
              className={menuItemClass}
            >
              {isExporting ? <Loader2 size={17} className="animate-spin text-cyan-600 shrink-0" aria-hidden="true" /> : <Download size={17} aria-hidden="true" className="shrink-0" />}
              <span className="truncate">{isExporting ? 'Exporting library…' : 'Export library to Excel'}</span>
            </button>
          )}
          {onClearLibrary && (
            <button
              type="button"
              role="menuitem"
              disabled={isLibraryMutationPending}
              onClick={() => {
                const focusReturnTarget = triggerRef.current;
                if (!focusReturnTarget) return;
                setIsOpen(false);
                onClearLibrary(focusReturnTarget);
              }}
              className={`${menuItemClass} text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30`}
            >
              <Trash2 size={17} aria-hidden="true" className="shrink-0" />
              <span className="truncate">Clear the entire library</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export type { LibraryManagementMenuProps };

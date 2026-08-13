import { Download, Loader2, Settings2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

interface LibraryManagementMenuProps {
  readonly isExporting: boolean;
  readonly isLibraryMutationPending: boolean;
  readonly onExportLibrary: () => void | Promise<void>;
  readonly onClearLibrary: (focusReturnTarget: HTMLButtonElement) => void;
}

const menuItemClass = 'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

export function LibraryManagementMenu({
  isExporting,
  isLibraryMutationPending,
  onExportLibrary,
  onClearLibrary,
}: LibraryManagementMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const exportRef = useRef<HTMLButtonElement | null>(null);
  const clearRef = useRef<HTMLButtonElement | null>(null);

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

  const availableItems = () => [exportRef.current, clearRef.current]
    .filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
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
    <div ref={rootRef} className="relative z-10 w-fit">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Manage library"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="library-management-menu"
        title="Manage library"
        onClick={() => setIsOpen(open => !open)}
        onKeyDown={handleTriggerKeyDown}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] shadow-sm transition-colors hover:border-[var(--sf-brand)] hover:text-[var(--sf-brand-text)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
      >
        <Settings2 size={18} aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          id="library-management-menu"
          role="menu"
          aria-label="Library management"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 mt-2 w-64 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-2 shadow-xl"
        >
          <button
            ref={exportRef}
            type="button"
            role="menuitem"
            disabled={isExporting}
            onClick={() => {
              setIsOpen(false);
              void onExportLibrary();
            }}
            className={menuItemClass}
          >
            {isExporting ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}
            {isExporting ? 'Exporting library…' : 'Export library to Excel'}
          </button>
          <button
            ref={clearRef}
            type="button"
            role="menuitem"
            disabled={isLibraryMutationPending}
            onClick={() => {
              const focusReturnTarget = triggerRef.current;
              if (!focusReturnTarget) return;
              setIsOpen(false);
              onClearLibrary(focusReturnTarget);
            }}
            className={`${menuItemClass} text-rose-700 dark:text-rose-300`}
          >
            <Trash2 size={17} aria-hidden="true" />
            Clear the entire library
          </button>
        </div>
      )}
    </div>
  );
}

export type { LibraryManagementMenuProps };

import { Download, Loader2, Settings2, Sparkles, Trash2, Volume2, VolumeX } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSoundSettings } from '../../lib/interactionSounds';
import { useZenGlassMode } from '../../lib/useZenGlassMode';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import { Trans } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';

interface LibraryManagementMenuProps {
  readonly isExporting?: boolean;
  readonly isLibraryMutationPending?: boolean;
  readonly onExportLibrary?: () => void | Promise<void>;
  readonly onClearLibrary?: (focusReturnTarget: HTMLButtonElement) => void;
}

const menuItemClass = 'crystal-chamfer-sm flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left text-xs font-bold text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none cursor-pointer';
const PlanUsageMeter = lazy(() => Promise.all([
  import('../../features/plan/PlanUsageMeter'), loadCatalog(getActiveUiLocale(), 'billing'),
]).then(([module]) => ({ default: module.PlanUsageMeter })));
const UpgradeDialog = lazy(() => Promise.all([
  import('../../features/billing/UpgradeDialog'), loadCatalog(getActiveUiLocale(), 'billing'),
]).then(([module]) => ({ default: module.UpgradeDialog })));
const AccountDataSection = lazy(() => Promise.all([
  import('../../features/account/AccountDataSection'), loadCatalog(getActiveUiLocale(), 'account'),
]).then(([module]) => ({ default: module.AccountDataSection })));

export function LibraryManagementMenu({
  isExporting = false,
  isLibraryMutationPending = false,
  onExportLibrary,
  onClearLibrary,
}: LibraryManagementMenuProps) {
  const { _ } = useLingui();
  const { isSoundEnabled: soundActive, toggleSound } = useSoundSettings();
  const [isZenMode, setZenMode] = useZenGlassMode();
  const [isOpen, setIsOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [accountDataOpen, setAccountDataOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
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
    menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [],
  );
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
        aria-label={_(msg({ id: 'shell.library-menu.trigger', message: 'Manage library' }))}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="library-management-menu"
        title={_(msg({ id: 'shell.library-menu.trigger', message: 'Manage library' }))}
        style={{ minHeight: 44 }}
        onClick={() => setIsOpen(open => !open)}
        onKeyDown={handleTriggerKeyDown}
        className="crystal-chamfer-sm liquid-control flex size-11 shrink-0 items-center justify-center border border-[var(--sf-border)] bg-[var(--sf-surface-control)] text-[var(--sf-text)] shadow-xs transition-colors hover:border-[var(--sf-brand)] hover:text-[var(--sf-brand-text)] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
      >
        <Settings2 size={18} aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          ref={menuRef}
          id="library-management-menu"
          role="menu"
          aria-label={_(msg({ id: 'shell.library-menu.label', message: 'Library management' }))}
          onKeyDown={handleMenuKeyDown}
          className="crystal-chamfer absolute right-0 top-full z-50 mt-2 w-64 border border-[var(--sf-border)] bg-[var(--sf-surface)] p-2 text-[var(--sf-text)] shadow-2xl backdrop-blur-2xl transition-[opacity,transform] duration-150"
        >
          <Suspense fallback={null}><PlanUsageMeter source="menu" onOpenUpgrade={() => { setIsOpen(false); setUpgradeOpen(true); }} /></Suspense>
          <a role="menuitem" href="/privacy.html" className={menuItemClass}><Trans id="shell.menu.privacy" message="Privacy" /></a>
          <a role="menuitem" href="/terms.html" className={menuItemClass}><Trans id="shell.menu.terms" message="Terms" /></a>
          <a role="menuitem" href="/browser-extension-privacy.html" className={menuItemClass}><Trans id="shell.menu.extension-privacy" message="Extension privacy" /></a>
          <button type="button" role="menuitem" className={menuItemClass} onClick={() => { setIsOpen(false); setAccountDataOpen(true); }}><Trans id="shell.menu.account-data" message="Account data" /></button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              toggleSound();
            }}
            className={menuItemClass}
          >
            {soundActive ? <Volume2 size={17} aria-hidden="true" className="text-cyan-600 dark:text-cyan-400 shrink-0" /> : <VolumeX size={17} aria-hidden="true" className="text-slate-400 shrink-0" />}
            <span className="truncate">{soundActive ? <Trans id="shell.menu.sound-on" message="Sound effects: On" /> : <Trans id="shell.menu.sound-muted" message="Sound effects: Muted" />}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setZenMode(prev => !prev);
            }}
            className={menuItemClass}
            title={_(msg({ id: 'shell.library-menu.zen-toggle-description', message: 'Toggle between Standard Learning mode and Zen Minimalist Glass mode' }))}
          >
            <Sparkles size={17} aria-hidden="true" className={isZenMode ? 'text-cyan-600 dark:text-cyan-400 shrink-0 animate-pulse' : 'text-slate-400 shrink-0'} />
            <span className="truncate">{isZenMode ? <Trans id="shell.menu.card-style-zen" message="Card style: Zen Glass" /> : <Trans id="shell.menu.card-style-standard" message="Card style: Standard" />}</span>
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
              <span className="truncate">{isExporting ? <Trans id="shell.menu.exporting" message="Exporting library…" /> : <Trans id="shell.menu.export" message="Export library to Excel" />}</span>
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
              <span className="truncate"><Trans id="shell.menu.clear-library" message="Clear the entire library" /></span>
            </button>
          )}
        </div>
      )}
      {upgradeOpen && <Suspense fallback={null}><UpgradeDialog open={upgradeOpen} onOpenChange={open => {
        setUpgradeOpen(open);
        if (!open) globalThis.requestAnimationFrame(() => triggerRef.current?.focus());
      }} trigger="menu" /></Suspense>}
      {accountDataOpen && <Suspense fallback={null}><AccountDataSection open={accountDataOpen} onOpenChange={open => {
        setAccountDataOpen(open);
        if (!open) globalThis.requestAnimationFrame(() => triggerRef.current?.focus());
      }} onExportLibrary={onExportLibrary} /></Suspense>}
    </div>
  );
}

export type { LibraryManagementMenuProps };

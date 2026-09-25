import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Check, Moon, Palette, Settings2, Sun } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTheme } from '../../features/theme/ThemeProvider';
import type { ThemeFamily, ThemeMode } from '../../features/theme/themePreference';

const optionClass = 'flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm font-semibold text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';
export const nextThemeMode = (mode: ThemeMode): ThemeMode => mode === 'dark' ? 'light' : 'dark';

export function ThemeMenu({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { _ } = useLingui(); const { family, mode, setFamily, setMode } = useTheme();
  const [open, setOpen] = useState(false); const rootRef = useRef<HTMLDivElement>(null); const menuRef = useRef<HTMLDivElement>(null); const triggerRef = useRef<HTMLButtonElement>(null);
  const nextMode = nextThemeMode(mode);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);
  const choose = (nextFamily: ThemeFamily, nextThemeMode: ThemeMode) => { setFamily(nextFamily); setMode(nextThemeMode); setOpen(false); triggerRef.current?.focus(); };
  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]') ?? []);
  const openAndFocus = (position: 'first' | 'last') => { setOpen(true); globalThis.requestAnimationFrame(() => items()[position === 'first' ? 0 : items().length - 1]?.focus()); };
  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openAndFocus(event.key === 'ArrowDown' ? 'first' : 'last'); } };
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => { const menuItems = items(); const index = menuItems.indexOf(document.activeElement as HTMLButtonElement); if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); menuItems[event.key === 'Home' ? 0 : menuItems.length - 1]?.focus(); } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && menuItems.length) { event.preventDefault(); menuItems[(index + (event.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length]?.focus(); } };
  return <div ref={rootRef} className="claude-theme-menu relative flex items-center gap-1">
    <button type="button" onClick={() => setMode(nextMode)} aria-pressed={mode === 'dark'} aria-label={_(msg({ id: 'shell.theme.quick-toggle', message: 'Switch light and dark mode' }))} title={_(msg({ id: 'shell.theme.quick-toggle', message: 'Switch light and dark mode' }))} className="claude-theme-quick-toggle flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-control)] text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none">{mode === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</button>
    <button ref={triggerRef} type="button" aria-label={_(msg({ id: 'shell.theme.open', message: 'Choose theme' }))} aria-haspopup="menu" aria-expanded={open} onClick={() => { if (open) setOpen(false); else openAndFocus('first'); }} onKeyDown={onTriggerKeyDown} className="claude-theme-picker flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-control)] text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"><Palette size={18} aria-hidden="true" /></button>
    {open && <div ref={menuRef} role="menu" aria-label={_(msg({ id: 'shell.theme.menu', message: 'Theme' }))} onKeyDown={onMenuKeyDown} className="claude-theme-menu-popover absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-1.5 shadow-xl crystal-chamfer">
      {([['classic', 'dark', <Trans id="shell.theme.classic-dark" message="Midnight Aurora" />], ['classic', 'light', <Trans id="shell.theme.classic-light" message="Ink & Paper" />], ['crystal', 'dark', <Trans id="shell.theme.crystal-dark" message="Crystal Star: Night" />], ['crystal', 'light', <Trans id="shell.theme.crystal-light" message="Crystal Star: Day" />]] as const).map(([nextFamily, nextThemeMode, label]) => <button key={`${nextFamily}-${nextThemeMode}`} type="button" role="menuitemradio" aria-checked={family === nextFamily && mode === nextThemeMode} className={optionClass} onClick={() => choose(nextFamily, nextThemeMode)}><span>{label}</span>{family === nextFamily && mode === nextThemeMode && <Check size={16} aria-hidden="true" className="text-[var(--sf-brand-text)]" />}</button>)}
      {onOpenSettings && <button type="button" role="menuitem" className={`${optionClass} border-t border-[var(--sf-border)]`} onClick={() => { setOpen(false); onOpenSettings(); }}><span><Trans id="shell.theme.appearance-settings" message="More appearance options" /></span><Settings2 size={16} aria-hidden="true" /></button>}
    </div>}
  </div>;
}

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Check, Languages } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSetUiLocale, useUiLocale } from '../../i18n/I18nProvider';
import { ENABLED_UI_LOCALES, UI_LOCALES, type UiLocale } from '../../i18n/locales';

const itemClass = 'flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm font-semibold text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';

export function LanguageMenu() {
  const { _ } = useLingui(); const locale = useUiLocale(); const setUiLocale = useSetUiLocale();
  const [open, setOpen] = useState(false); const rootRef = useRef<HTMLDivElement>(null); const menuRef = useRef<HTMLDivElement>(null); const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);
  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
  const openAndFocus = (position: 'first' | 'last') => { setOpen(true); globalThis.requestAnimationFrame(() => items()[position === 'first' ? 0 : items().length - 1]?.focus()); };
  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openAndFocus(event.key === 'ArrowDown' ? 'first' : 'last'); } };
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => { const menuItems = items(); const index = menuItems.indexOf(document.activeElement as HTMLButtonElement); if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); menuItems[event.key === 'Home' ? 0 : menuItems.length - 1]?.focus(); } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && menuItems.length) { event.preventDefault(); menuItems[(index + (event.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length]?.focus(); } };
  return <div ref={rootRef} className="relative">
    <button ref={triggerRef} type="button" aria-label={_(msg({ id: 'shell.language.open', message: 'Choose language' }))} aria-haspopup="menu" aria-expanded={open} onClick={() => { if (open) setOpen(false); else openAndFocus('first'); }} onKeyDown={onTriggerKeyDown} className="flex size-11 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-control)] text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"><Languages size={18} aria-hidden="true" /></button>
    {open && <div ref={menuRef} role="menu" aria-label={_(msg({ id: 'shell.language.menu', message: 'Language' }))} onKeyDown={onMenuKeyDown} className="absolute right-0 top-full z-50 mt-2 w-48 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-1.5 shadow-xl">
      {ENABLED_UI_LOCALES.map(option => <button key={option} type="button" role="menuitemradio" aria-checked={locale === option} lang={option} className={itemClass} onClick={() => { void setUiLocale(option as UiLocale); setOpen(false); }}><span>{UI_LOCALES[option].autonym}</span>{locale === option && <Check size={16} aria-hidden="true" className="text-[var(--sf-brand-text)]" />}</button>)}
    </div>}
  </div>;
}

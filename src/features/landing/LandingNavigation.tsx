import { Menu, X } from 'lucide-react';
import { useRef } from 'react';

interface LandingNavigationProps {
  readonly onEnterApp: () => void;
  readonly onOpenLibrary?: () => void;
  readonly onOpenCatalog?: () => void;
  readonly onSignIn?: () => void | Promise<void>;
  readonly user?: { displayName?: string | null; email?: string | null; photoURL?: string | null } | null;
}
const focusClass = 'focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-cyan-200';
const navItemClass = `flex min-h-11 items-center rounded-full px-3 transition-colors hover:text-cyan-100 ${focusClass} motion-reduce:transition-none`;

export function LandingNavigation({ onEnterApp, onOpenLibrary, onOpenCatalog, onSignIn, user }: LandingNavigationProps) {
  const mobileNavRef = useRef<HTMLDetailsElement | null>(null);
  const closeMobileNav = () => mobileNavRef.current?.removeAttribute('open');

  return (
    <header className="relative z-20 flex items-center justify-between gap-5">
      <a href="#top" className={`flex min-h-11 items-center gap-2.5 rounded-xl ${focusClass}`}>
        <img src="/brand/sonflash-logo-192.png?v=3e7aaa58" alt="" className="size-9 rounded-xl object-cover sm:size-10" />
        <span className="text-xl font-black tracking-[-0.05em] text-white">Son<span className="text-cyan-200">Flash</span></span>
      </a>

      <nav aria-label="Landing navigation" className="hidden items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2 text-sm font-semibold text-slate-300 backdrop-blur-xl md:flex">
        <a href="#features" className={navItemClass}>AI Features</a>
        <a href="#methods" className={navItemClass}>FSRS Method</a>
        <button type="button" onClick={onOpenCatalog ?? onEnterApp} className={navItemClass}>Curriculum</button>
        <button type="button" onClick={onOpenLibrary ?? onEnterApp} className={navItemClass}>Vocabulary Library</button>
      </nav>

      <details
        ref={mobileNavRef}
        className="group relative md:hidden"
        onKeyDown={event => {
          if (event.key !== 'Escape' || !event.currentTarget.open) return;
          event.preventDefault();
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }}
      >
        <summary aria-label="Open navigation menu" className={`flex size-11 cursor-pointer list-none items-center justify-center rounded-full border border-white/20 bg-white/[0.05] text-white backdrop-blur-xl ${focusClass} [&::-webkit-details-marker]:hidden`}>
          <Menu size={19} className="group-open:hidden" aria-hidden="true" />
          <X size={19} className="hidden group-open:block" aria-hidden="true" />
        </summary>
        <nav aria-label="Mobile navigation" className="absolute right-0 top-14 z-30 flex w-[min(18rem,calc(100vw-2rem))] flex-col rounded-3xl border border-white/15 bg-[#0b151c]/95 p-3 text-base font-bold text-white shadow-2xl shadow-black/50 backdrop-blur-2xl">
          <a href="#features" onClick={closeMobileNav} className={`flex min-h-11 items-center rounded-2xl px-4 hover:bg-white/10 ${focusClass}`}>AI Features</a>
          <a href="#methods" onClick={closeMobileNav} className={`flex min-h-11 items-center rounded-2xl px-4 hover:bg-white/10 ${focusClass}`}>FSRS Method</a>
          <button type="button" onClick={() => { closeMobileNav(); (onOpenCatalog ?? onEnterApp)(); }} className={`min-h-11 rounded-2xl px-4 text-left hover:bg-white/10 ${focusClass}`}>Curriculum</button>
          <button type="button" onClick={() => { closeMobileNav(); (onOpenLibrary ?? onEnterApp)(); }} className={`min-h-11 rounded-2xl px-4 text-left hover:bg-white/10 ${focusClass}`}>Vocabulary Library</button>
          {onSignIn && !user && <button type="button" onClick={() => { closeMobileNav(); void onSignIn(); }} className={`min-h-11 rounded-2xl px-4 text-left text-cyan-100 hover:bg-white/10 ${focusClass}`}>Sign in with Google</button>}
        </nav>
      </details>
    </header>
  );
}

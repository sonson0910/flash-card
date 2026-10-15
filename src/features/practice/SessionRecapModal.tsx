import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { CalendarDays, CheckCircle2, RotateCcw, Sparkles, Trophy, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Lumi } from '../../components/lumi/Lumi';
import { CountUp } from '../../components/motion/CountUp';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { formatNumber } from '../../lib/format';
import { triggerHaptic } from '../../lib/haptics';
import { playRewardSound } from '../../lib/interactionSounds';
import { readLumiEnabled } from '../settings/lumi-preference';
import type { CardData } from '../../types/card';
import { loadTomorrowDueCount } from './session-recap-service';
import './practice-board.css';

interface SessionRecapModalProps {
  open: boolean;
  onClose: () => void;
  onViewWeeklyRecap?: () => void;
  onRetryWeak?: () => void;
  totalCards: number;
  goodCount: number;
  againCount: number;
  xpEarned: number;
  weakCards: CardData[];
  targetLanguage?: string;
}

export function SessionRecapModal({ open, onClose, onViewWeeklyRecap, onRetryWeak, totalCards, goodCount, againCount, xpEarned, weakCards, targetLanguage }: SessionRecapModalProps) {
  const { _ } = useLingui();
  const accuracy = totalCards > 0 ? Math.round((goodCount / totalCards) * 100) : 100;
  const isCrystal = globalThis.document?.documentElement.dataset.themeFamily === 'crystal';
  const showLumi = isCrystal && readLumiEnabled();

  // The session-finale cue: fires once when the recap is actually reached (this component
  // only mounts/opens at the end of a real session), not on every re-render while it stays open.
  useEffect(() => {
    if (!open) return;
    playRewardSound();
    triggerHaptic('success');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per recap arrival, not per prop change
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={openState => !openState && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm" />
        <Dialog.Content asChild aria-describedby="session-recap-description">
        {/* GSAP's entrance tween takes exclusive ownership of this element's `transform`
            inline style while it animates (see GsapEntrance.tsx), which would clobber a
            centering transform placed on the same node for the brief window before its
            onComplete clears the animated props. Centering lives on this non-animated
            wrapper instead, so GSAP only ever controls the inner box's own transform. */}
        <div className="practice-recap-frame fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2">
        <GsapEntrance
          variant="result"
          data-session-recap="true"
          className="practice-recap-board block max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 text-[var(--sf-text)] shadow-2xl outline-none sm:p-7 [html[data-theme-family=crystal]_&]:crystal-chamfer"
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-0 h-24 bg-[radial-gradient(ellipse_at_top,var(--sf-surface-raised),transparent_70%)] opacity-70" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/20 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm [html[data-theme-family=crystal]_&]:from-[var(--sf-brand)] [html[data-theme-family=crystal]_&]:to-rose-500">
                <Trophy size={24} aria-hidden="true" />
                {showLumi && <Lumi pose="proud" size={58} className="pointer-events-none absolute -bottom-2 -right-3 max-w-none drop-shadow-md" />}
              </div>
              <div>
                <Dialog.Title className="font-display text-2xl font-black tracking-tight text-[var(--sf-text)] sm:text-3xl [html[data-theme-family=crystal]_&]:font-black [html[data-theme-family=crystal]_&]:italic"><Trans id="recap.title" message="Session complete" /></Dialog.Title>
                <Dialog.Description id="session-recap-description" className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans id="recap.description" message="Here is what you strengthened today." /></Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm" aria-label={_(msg({ id: 'recap.close', message: 'Close recap' }))}><X size={18} aria-hidden="true" /></Dialog.Close>
          </div>

          <div className="relative mt-6 grid grid-cols-3 gap-2.5 text-center sm:gap-3">
            <Stat label={<Trans id="recap.reviewed" message="Reviewed" />} value={<CountUp to={totalCards} />} />
            <Stat label={<Trans id="recap.retained" message="Retained" />} value={<><CountUp to={accuracy} suffix="%" /><span aria-hidden="true">%</span></>} tone="success" />
            <Stat label={<Trans id="recap.xp-earned" message="XP earned" />} value={<><span aria-hidden="true">+</span><CountUp to={xpEarned} /></>} tone="warm" />
          </div>

          <div className="relative mt-4 grid gap-2 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3.5 text-sm font-semibold [html[data-theme-family=crystal]_&]:crystal-chamfer-sm sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 text-emerald-700 dark:text-emerald-300"><span className="flex items-center gap-1.5"><CheckCircle2 size={16} aria-hidden="true" /><span><Trans id="recap.mastered" message="Remembered" /></span></span><span className="font-bold tabular-nums text-[var(--sf-text)]"><Trans id="recap.word-count" message="{count, plural, one {# word} other {# words}}" values={{ count: goodCount }} /></span></div>
            <div className="flex items-center justify-between gap-3 text-rose-700 dark:text-rose-300"><span className="flex items-center gap-1.5"><RotateCcw size={16} aria-hidden="true" /><span><Trans id="recap.needs-review" message="To revisit" /></span></span><span className="font-bold tabular-nums text-[var(--sf-text)]"><Trans id="recap.word-count" message="{count, plural, one {# word} other {# words}}" values={{ count: againCount }} /></span></div>
          </div>

          {weakCards.length > 0 && <div className="relative mt-4"><p className="mb-2 text-[11px] font-black uppercase tracking-wider text-[var(--sf-text-muted)]"><Trans id="recap.words-to-reinforce" message="Words to reinforce ({count})" values={{ count: formatNumber(weakCards.length) }} /></p><div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1 scrollbar-none">{weakCards.map(card => <span key={card.id} lang={card.language ?? 'en'} className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-700 dark:text-rose-200 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">{card.word}</span>)}</div></div>}

          <TomorrowDue key={targetLanguage ?? 'all'} targetLanguage={targetLanguage} />

          <div className="relative mt-6 flex flex-col gap-2.5 sm:flex-row">
            {weakCards.length > 0 && onRetryWeak && <button type="button" onClick={onRetryWeak} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 text-sm font-bold text-rose-700 transition-all hover:bg-rose-500/20 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-rose-200 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"><RotateCcw size={16} aria-hidden="true" /><Trans id="recap.retry-weak" message="Review {count, plural, one {# word} other {# words}}" values={{ count: weakCards.length }} /></button>}
            {onViewWeeklyRecap && <button type="button" onClick={onViewWeeklyRecap} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 text-sm font-bold text-[var(--sf-text)] transition-all hover:border-[var(--sf-brand)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"><CalendarDays size={16} aria-hidden="true" /><Trans id="recap.weekly" message="View weekly recap" /></button>}
            <button type="button" onClick={onClose} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 text-sm font-bold text-[var(--sf-on-brand)] shadow-md transition-all hover:bg-[var(--sf-brand-hover)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"><Sparkles size={16} aria-hidden="true" /><Trans id="recap.continue" message="Continue learning" /></button>
          </div>
        </GsapEntrance>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TomorrowDue({ targetLanguage }: { targetLanguage?: string }) {
  const request = useRef<Promise<number> | null>(null);
  const [result, setResult] = useState<{ status: 'loading' | 'ready' | 'error'; count?: number }>({ status: 'loading' });

  useEffect(() => {
    request.current ??= loadTomorrowDueCount(targetLanguage);
    let active = true;
    void request.current.then(
      count => { if (active) setResult({ status: 'ready', count }); },
      () => { if (active) setResult({ status: 'error' }); },
    );
    return () => { active = false; };
  }, [targetLanguage]);

  return <div className="relative mt-4 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3.5 text-sm text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm" aria-live="polite">
    <span className="font-semibold"><Trans id="recap.tomorrow" message="Tomorrow" /></span>
    <span className="ml-2 text-[var(--sf-text-muted)]">
      {result.status === 'loading' && <Trans id="recap.tomorrow-loading" message="Checking cards due…" />}
      {result.status === 'error' && <Trans id="recap.tomorrow-error" message="Count unavailable" />}
      {result.status === 'ready' && <Trans id="recap.tomorrow-count" message="{count, plural, one {# card due} other {# cards due}}" values={{ count: result.count ?? 0 }} />}
    </span>
  </div>;
}

function Stat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: 'success' | 'warm' }) {
  const toneClass = tone === 'success' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : tone === 'warm' ? 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)]';
  return <div className={`rounded-2xl border p-3 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm ${toneClass}`}><span className="block text-[11px] font-bold uppercase tracking-wider opacity-80">{label}</span><span className="mt-1 block font-display text-2xl font-black tabular-nums sm:text-3xl">{value}</span></div>;
}

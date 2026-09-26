import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getPilotOffer, recordPurchaseIntent, type PilotOffer } from './billingService';
import { recordPilotClientEvent } from '../../lib/analytics';
import { formatNumber } from '../../lib/format';

export function UpgradeDialog({ open, onOpenChange, trigger }: {
  open: boolean; onOpenChange(open: boolean): void; trigger: 'quota' | 'menu';
}) {
  const { _ } = useLingui();
  const [offer, setOffer] = useState<PilotOffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    recordPilotClientEvent({ name: 'paywall_viewed', props: { trigger, offerId: 'pro-vn-30d-v1' } });
    let active = true;
    setLoading(true); setError(null); setRecorded(false);
    void getPilotOffer().then(value => { if (active) setOffer(value); }, () => {
      if (active) setError(_(msg({ id: 'billing.upgrade.error.load', message: "Couldn't load the Pro plan. Please try again later." })));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, trigger, _]);
  const submit = async () => {
    if (submitting || recorded) return;
    setSubmitting(true); setError(null);
    try {
      await recordPurchaseIntent(trigger);
      setRecorded(true);
    } catch {
      setError(_(msg({ id: 'billing.upgrade.error.submit', message: "Your request wasn't recorded. Please try again later." })));
    } finally { setSubmitting(false); }
  };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="crystal-starfield fixed inset-0 z-[100] bg-[var(--sf-scrim)] backdrop-blur-sm" />
      <Dialog.Content className="crystal-chamfer fixed left-1/2 top-1/2 z-[101] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] [background-image:var(--sf-dialog-bg)] text-[var(--sf-text)] shadow-2xl outline-none">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--sf-border)] px-5 py-5 sm:px-7">
          <div>
            <p className="premium-kicker text-[11px] uppercase tracking-[.14em]"><Trans id="billing.upgrade.kicker" message="SonFlash Pro" /></p>
            <Dialog.Title className="mt-1 font-serif text-3xl font-bold tracking-tight [html[data-theme-family=crystal]_&]:font-display [html[data-theme-family=crystal]_&]:font-black [html[data-theme-family=crystal]_&]:italic"><Trans id="billing.upgrade.title" message="Add momentum to your learning" /></Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-[var(--sf-text-muted)]"><Trans id="billing.upgrade.description" message="The same AI card quality as Free, with more generations." /></Dialog.Description>
          </div>
          <Dialog.Close aria-label={_(msg({ id: 'billing.dialog.close', message: 'Close' }))} className="liquid-control flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--sf-text-muted)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"><X size={18} /></Dialog.Close>
        </header>
        <div className="space-y-4 px-5 py-5 sm:px-7">
        {loading && <p role="status" className="text-sm text-[var(--sf-text-muted)]"><Trans id="billing.upgrade.loading" message="Loading plan details…" /></p>}
        {offer && <article className="rounded-2xl border border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_8%,var(--sf-surface))] p-5 shadow-[var(--sf-panel-shadow)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
          <p className="text-sm font-semibold text-[var(--sf-text-muted)]"><Trans id="billing.upgrade.offer.duration" message="Pro · {days, plural, one {# day} other {# days}}" values={{ days: offer.proDurationDays }} /></p>
          <p className="mt-2 font-serif text-4xl font-bold tracking-tight text-[var(--sf-brand-text)] [html[data-theme-family=crystal]_&]:font-display">{offer.displayPriceVnd === null ? _(msg({ id: 'billing.upgrade.offer.fallback-price', message: '79,000 ₫ + VAT' })) : `${formatNumber(offer.displayPriceVnd)} ₫`}</p>
          <p className="mt-3 flex gap-2 text-sm text-[var(--sf-text-muted)]"><Check size={17} className="shrink-0 text-[var(--sf-brand-text)]" /><Trans id="billing.upgrade.offer.cards" message="{count, plural, one {# AI card} other {# AI cards}} for the plan duration" values={{ count: offer.proMonthlyAiCards }} /></p>
          <p className="mt-2 text-sm text-[var(--sf-text-muted)]"><Trans id="billing.upgrade.offer.no-renew" message="No auto-renewal. Payment is not being collected or opened yet." /></p>
        </article>}
        {recorded && <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-700 dark:text-emerald-200"><Trans id="billing.upgrade.recorded" message="Your purchase interest is recorded. The founder will reach out when sales open." /></p>}
        {error && <p role="alert" className="rounded-xl border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_10%,var(--sf-surface))] p-3 text-sm text-[var(--sf-danger)]">{error}</p>}
        <p className="text-xs leading-5 text-[var(--sf-text-muted)]">
          <Trans
            id="billing.upgrade.consent"
            message="For learners aged 18 and over. By registering, you agree to the <terms>Terms</terms> and the <privacy>Privacy Policy</privacy>."
            components={{
              terms: <a href="/terms.html" className="rounded underline hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2" />,
              privacy: <a href="/privacy.html" className="rounded underline hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2" />,
            }}
          />
        </p>
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--sf-border)] pt-4 sm:flex-row sm:justify-end">
          <Dialog.Close className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-5 font-semibold [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"><Trans id="billing.dialog.close" message="Close" /></Dialog.Close>
          {offer && !recorded && <button type="button" disabled={submitting} onClick={() => void submit()} className="min-h-11 rounded-xl bg-[var(--sf-brand)] px-5 font-bold text-[var(--sf-on-brand)] shadow-md hover:bg-[var(--sf-brand-hover)] disabled:opacity-60 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">{submitting ? <Trans id="billing.upgrade.submit.busy" message="Recording…" /> : <Trans id="billing.upgrade.submit.idle" message="Register interest for launch" />}</button>}
        </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

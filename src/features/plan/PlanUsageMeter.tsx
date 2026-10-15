import { msg } from '@lingui/core/macro';
import { lazy, Suspense, useState } from 'react';
import { Trans } from '@lingui/react';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import { getDateTimeFormat } from '../../lib/format';
import { usePlanUsage } from './usePlanUsage';

const UpgradeDialog = lazy(() => Promise.all([
  import('../billing/UpgradeDialog'), loadCatalog(getActiveUiLocale(), 'billing'),
]).then(([module]) => ({ default: module.UpgradeDialog })));

export function PlanUsageMeter({ source = 'quota', onOpenUpgrade }: {
  source?: 'quota' | 'menu'; onOpenUpgrade?: () => void;
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const usage = usePlanUsage();
  if (!usage) return null;
  const exhausted = usage.used >= usage.limit;
  const reset = getDateTimeFormat({ timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium' }).format(usage.periodEndsAt);
  return (
    <div role="status" aria-live="polite" className="crystal-chamfer-sm rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-3 text-xs text-[var(--sf-text-muted)] shadow-[var(--sf-panel-shadow)]">
      <div className="flex items-center justify-between gap-3"><span className="font-semibold text-[var(--sf-text)]"><Trans {...msg({ context: 'plan.usage.label', message: 'AI cards' })} /></span><span className="font-mono">{usage.used} / {usage.limit}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--sf-border)]"><div className="h-full rounded-full bg-[var(--sf-brand)]" style={{ width: `${Math.min(100, usage.used / usage.limit * 100)}%` }} /></div>
      <span className="mt-2 block">{usage.tier === 'pro'
        ? <Trans {...msg({ context: 'plan.usage.period.pro', message: '{used} / {limit} AI cards on the Pro plan' })} values={{ used: usage.used, limit: usage.limit }} />
        : <Trans {...msg({ context: 'plan.usage.period.free', message: '{used} / {limit} AI cards this month' })} values={{ used: usage.used, limit: usage.limit }} />}</span>
      {exhausted && <p className="mt-1 text-amber-700 dark:text-amber-300">
        <Trans {...msg({ context: 'plan.usage.exhausted', message: 'No AI card generations left. Resets {reset}. You can still review, add cards manually, and export your data.' })} values={{ reset }} />
        {usage.tier === 'free' && <> <Trans {...msg({ context: 'plan.usage.exhausted.pro-hint', message: 'Pro adds more generations.' })} /></>}
      </p>}
      {usage.tier === 'free' && (exhausted || source === 'menu') && <button type="button"
        role={source === 'menu' ? 'menuitem' : undefined}
        onClick={() => onOpenUpgrade ? onOpenUpgrade() : setUpgradeOpen(true)} className="mt-3 min-h-11 rounded-xl border border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_8%,var(--sf-surface))] px-3 font-bold text-[var(--sf-brand-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
        <Trans {...msg({ context: 'plan.usage.view-pro', message: 'See Pro plan' })} />
      </button>}
      {upgradeOpen && <Suspense fallback={null}><UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} trigger={source} /></Suspense>}
    </div>
  );
}

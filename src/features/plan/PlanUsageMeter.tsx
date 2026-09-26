import { lazy, Suspense, useState } from 'react';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
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
  const reset = usage.periodEndsAt.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return (
    <div role="status" aria-live="polite" className="crystal-chamfer-sm rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-3 text-xs text-[var(--sf-text-muted)] shadow-[var(--sf-panel-shadow)]">
      <div className="flex items-center justify-between gap-3"><span className="font-semibold text-[var(--sf-text)]">AI cards</span><span className="font-mono">{usage.used} / {usage.limit}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--sf-border)]"><div className="h-full rounded-full bg-[var(--sf-brand)]" style={{ width: `${Math.min(100, usage.used / usage.limit * 100)}%` }} /></div>
      <span className="mt-2 block">{usage.used} / {usage.limit} thẻ AI {usage.tier === 'pro' ? 'gói Pro' : 'tháng này'}</span>
      {exhausted && <p className="mt-1 text-amber-700 dark:text-amber-300">
        Hết lượt tạo thẻ AI. Đặt lại {reset}. Bạn vẫn có thể ôn tập, thêm thẻ thủ công và xuất dữ liệu.
        {usage.tier === 'free' && ' Gói Pro có thêm lượt tạo thẻ.'}
      </p>}
      {usage.tier === 'free' && (exhausted || source === 'menu') && <button type="button"
        role={source === 'menu' ? 'menuitem' : undefined}
        onClick={() => onOpenUpgrade ? onOpenUpgrade() : setUpgradeOpen(true)} className="mt-3 min-h-11 rounded-xl border border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_8%,var(--sf-surface))] px-3 font-bold text-[var(--sf-brand-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
        Xem gói Pro
      </button>}
      {upgradeOpen && <Suspense fallback={null}><UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} trigger={source} /></Suspense>}
    </div>
  );
}

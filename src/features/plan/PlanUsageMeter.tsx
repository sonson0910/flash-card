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
    <div role="status" aria-live="polite" className="rounded-xl border border-[var(--sf-border)] px-3 py-2 text-xs text-[var(--sf-text-muted)]">
      <span>{usage.used} / {usage.limit} thẻ AI {usage.tier === 'pro' ? 'gói Pro' : 'tháng này'}</span>
      {exhausted && <p className="mt-1 text-amber-700 dark:text-amber-300">
        Hết lượt tạo thẻ AI. Đặt lại {reset}. Bạn vẫn có thể ôn tập, thêm thẻ thủ công và xuất dữ liệu.
        {usage.tier === 'free' && ' Gói Pro có thêm lượt tạo thẻ.'}
      </p>}
      {usage.tier === 'free' && (exhausted || source === 'menu') && <button type="button"
        role={source === 'menu' ? 'menuitem' : undefined}
        onClick={() => onOpenUpgrade ? onOpenUpgrade() : setUpgradeOpen(true)} className="mt-2 min-h-11 rounded-full border border-cyan-500 px-3 font-bold text-cyan-700 dark:text-cyan-300">
        Xem gói Pro
      </button>}
      {upgradeOpen && <Suspense fallback={null}><UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} trigger={source} /></Suspense>}
    </div>
  );
}

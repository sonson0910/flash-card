import { usePlanUsage } from './usePlanUsage';

export function PlanUsageMeter() {
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
    </div>
  );
}

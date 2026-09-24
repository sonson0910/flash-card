import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';

export interface PlanUsage {
  tier: 'free' | 'pro';
  used: number;
  limit: number;
  periodEndsAt: Date;
}

const monthPeriod = (now: Date) => {
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit',
  }).format(now);
  const [year, number] = month.split('-').map(Number);
  return { key: `free-${month}`, endsAt: new Date(Date.UTC(year, number, 1, -7)) };
};

// A learner's device clock can run a few minutes behind the server. Without tolerance, a Pro grant whose
// `startsAt` is "now" on the server reads as being in the future on the device, and the meter shows a stale
// "Free, exhausted" state until the device clock catches up (or the free period rolls over).
const PRO_START_CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;

export interface ResolvedPlanPeriod {
  tier: 'free' | 'pro';
  key: string;
  endsAt: Date;
  /** When to re-evaluate the plan: the period end, or an upcoming `startsAt` still inside the skew window. */
  nextRefreshAt: Date;
}

export function resolvePlanPeriod(plan: Record<string, unknown> | undefined, now: Date): ResolvedPlanPeriod {
  const proEnd = (plan?.expiresAt as { toDate?: () => Date } | undefined)?.toDate?.();
  const proStart = (plan?.startsAt as { toDate?: () => Date } | undefined)?.toDate?.();
  const proStartClearsSkewTolerance = Boolean(proStart)
    && proStart!.getTime() - PRO_START_CLOCK_SKEW_TOLERANCE_MS <= now.getTime();
  const pro = plan?.tier === 'pro' && typeof plan.entitlementId === 'string'
    && proStart && proStartClearsSkewTolerance && proEnd && now < proEnd;
  const free = monthPeriod(now);
  const tier: 'free' | 'pro' = pro ? 'pro' : 'free';
  const key = pro ? `pro-${plan!.entitlementId}` : free.key;
  const endsAt = pro ? proEnd! : free.endsAt;
  // The plan document already says "pro" but startsAt has not cleared the skew tolerance yet: schedule a
  // refresh right when it does, instead of only re-checking at the free period's end.
  const pendingProStart = !pro && plan?.tier === 'pro' && proStart && proStart.getTime() > now.getTime()
    ? new Date(proStart.getTime() - PRO_START_CLOCK_SKEW_TOLERANCE_MS)
    : null;
  const nextRefreshAt = pendingProStart && pendingProStart.getTime() < endsAt.getTime() ? pendingProStart : endsAt;
  return { tier, key, endsAt, nextRefreshAt };
}

export function usePlanUsage(): PlanUsage | null {
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  useEffect(() => {
    if (!auth || !db) return;
    let stopPlan: (() => void) | null = null;
    let stopUsage: (() => void) | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const stopAuth = onAuthStateChanged(auth, user => {
      stopPlan?.();
      stopUsage?.();
      if (refreshTimer) clearTimeout(refreshTimer);
      stopUsage = null;
      setUsage(null);
      if (!user || !db) return;
      const bindUsage = (plan: Record<string, unknown> | undefined) => {
        stopUsage?.();
        if (refreshTimer) clearTimeout(refreshTimer);
        const now = new Date();
        const { tier, key, endsAt, nextRefreshAt } = resolvePlanPeriod(plan, now);
        refreshTimer = setTimeout(() => bindUsage(plan), Math.min(Math.max(1, nextRefreshAt.getTime() - now.getTime() + 1_000), 2_147_483_647));
        stopUsage = onSnapshot(doc(db!, 'users', user.uid, 'ai_usage', key), snapshot => {
          const data = snapshot.data();
          const used = Number.isSafeInteger(data?.used) && data!.used >= 0 ? data!.used as number : 0;
          const limit = Number.isSafeInteger(data?.limit) && data!.limit > 0 ? data!.limit as number : tier === 'pro' ? 1_000 : 30;
          setUsage({ tier, used, limit, periodEndsAt: endsAt });
        }, () => setUsage(null));
      };
      stopPlan = onSnapshot(doc(db, 'users', user.uid, 'profile', 'plan'), planSnapshot => bindUsage(planSnapshot.data()), () => setUsage(null));
    });
    return () => { stopAuth(); stopPlan?.(); stopUsage?.(); if (refreshTimer) clearTimeout(refreshTimer); };
  }, []);
  return usage;
}

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
        const proEnd = (plan?.expiresAt as { toDate?: () => Date } | undefined)?.toDate?.();
        const proStart = (plan?.startsAt as { toDate?: () => Date } | undefined)?.toDate?.();
        const pro = plan?.tier === 'pro' && typeof plan.entitlementId === 'string'
          && proStart && proStart <= now && proEnd && now < proEnd;
        const free = monthPeriod(now);
        const key = pro ? `pro-${plan!.entitlementId}` : free.key;
        const endsAt = pro ? proEnd : free.endsAt;
        const tier = pro ? 'pro' : 'free';
        refreshTimer = setTimeout(() => bindUsage(plan), Math.min(Math.max(1, endsAt.getTime() - now.getTime() + 1_000), 2_147_483_647));
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

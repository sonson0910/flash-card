import { useEffect, useState } from 'react';

const MINUTE_MS = 60_000;

/**
 * The current time, refreshed on each minute boundary and when the page becomes visible again
 * (background tabs throttle timers). A fixed `now` turns the clock off, for tests and fixtures.
 */
export const useMinuteClock = (fixedNow?: Date): Date => {
  const [now, setNow] = useState(() => new Date());
  const fixed = fixedNow?.getTime();
  useEffect(() => {
    if (fixed !== undefined) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS) + 25);
    };
    timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS) + 25);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer !== undefined) clearTimeout(timer);
      tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fixed]);
  return fixed !== undefined ? new Date(fixed) : now;
};

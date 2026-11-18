import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CourseSessionActions, CourseSessionController, CourseSessionSnapshot } from './courseSessionController';
import { resolveCoursePort } from './resolveCoursePort';

const idleSnapshot: CourseSessionSnapshot = {
  ownerId: null, status: 'idle', source: null, profile: null, activeCourse: null, pending: false, errorCode: null,
};
const notMounted = async () => ({ ok: false as const, error: new Error('CourseProvider is not mounted yet.') });
const noopActions = {
  retry: async () => {},
  createCourse: notMounted, updateCourse: notMounted, archiveCourse: notMounted, reopenCourse: notMounted,
  switchCourse: notMounted, addGoal: notMounted, updateGoal: notMounted, removeGoal: notMounted,
  clearError: () => {},
} as unknown as CourseSessionActions;

export interface CourseGateValue { readonly model: CourseSessionSnapshot; readonly actions: CourseSessionActions }
/** Exported so tests can supply a fixed snapshot without waiting on the real async controller. */
const unavailableValue: CourseGateValue = { model: idleSnapshot, actions: noopActions };
export const CourseContext = createContext<CourseGateValue>(unavailableValue);

/** Any consumer works before the controller chunk resolves: it just reads the idle snapshot until then. */
export const useCourseSession = (): CourseGateValue => useContext(CourseContext);

export const readyCourseSessionForOwner = (session: CourseGateValue | null, ownerId: string | null): CourseGateValue | null =>
  ownerId && session?.model.ownerId === ownerId && session.model.status === 'ready' ? session : null;

/** Onboarding only ever starts for an owner whose course profile document does not exist yet. */
export const useNeedsOnboarding = (): boolean => {
  const { model } = useCourseSession();
  return model.status === 'ready' && model.source === 'absent';
};

/**
 * Mounted once near the app root. Its own module stays tiny (no validation,
 * no adapter, no Firestore/Functions imports at the top level) so it costs
 * almost nothing in the initial bundle; `courseSessionController` and the
 * Firebase adapter only load once an owner id is actually activated.
 */
export function CourseProvider({ ownerId, children }: { readonly ownerId: string | null; readonly children: ReactNode }) {
  const [value, setValue] = useState<CourseGateValue>({ model: idleSnapshot, actions: noopActions });
  const controllerRef = useRef<CourseSessionController | null>(null);
  // The controller chunk resolves asynchronously; activating with the owner
  // captured at mount would miss a sign-in that lands while it loads.
  const ownerIdRef = useRef(ownerId);
  ownerIdRef.current = ownerId;

  useEffect(() => {
    let disposed = false;
    void import('./courseSessionController').then(({ createCourseSessionController }) => {
      if (disposed) return;
      const controller = createCourseSessionController(resolveCoursePort);
      controllerRef.current = controller;
      const sync = () => setValue({ model: controller.getSnapshot(), actions: controller.actions });
      controller.subscribe(sync);
      sync();
      void controller.activate(ownerIdRef.current);
    });
    return () => {
      disposed = true;
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
    // The controller is created once; ownerId changes are handled by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (controllerRef.current) void controllerRef.current.activate(ownerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  return <CourseContext.Provider value={value.model.ownerId === ownerId ? value : unavailableValue}>{children}</CourseContext.Provider>;
}

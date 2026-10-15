import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  createSharedDeckSessionController,
  type SharedDeckAdapter,
  type SharedDeckBrowser,
  type SharedDeckCoursePort,
  type SharedDeckIntakePort,
  type SharedDeckSessionActions,
  type SharedDeckSessionSnapshot,
} from './sharedDeckSessionController';

const windowBrowser: SharedDeckBrowser = {
  getCurrentUrl: () => window.location.href,
  replaceLocation: location => window.history.replaceState(
    window.history.state,
    document.title,
    location,
  ),
};

export interface UseSharedDeckSessionOptions {
  ownerKey: string | null;
  adapter: SharedDeckAdapter;
  intake: SharedDeckIntakePort;
  browser?: SharedDeckBrowser;
  /** Optional; omit to keep today's behavior. See `shareCourseMatching.ts`. */
  coursePort?: SharedDeckCoursePort | null;
}

export interface UseSharedDeckSessionResult {
  model: SharedDeckSessionSnapshot;
  actions: SharedDeckSessionActions;
}

export function useSharedDeckSession({
  ownerKey,
  adapter,
  intake,
  browser = windowBrowser,
  coursePort,
}: UseSharedDeckSessionOptions): UseSharedDeckSessionResult {
  const intakeRef = useRef(intake);
  const coursePortRef = useRef(coursePort);
  const coursePortProvidedRef = useRef(coursePort !== undefined);
  const forwardedIntake = useMemo<SharedDeckIntakePort>(() => ({
    adoptShared: request => intakeRef.current.adoptShared(request),
  }), []);
  const forwardedCoursePort = useMemo<SharedDeckCoursePort>(() => ({
    ensureCourseForIncomingShare: preview => {
      const current = coursePortRef.current;
      if (current) return current.ensureCourseForIncomingShare(preview);
      if (!coursePortProvidedRef.current) return Promise.resolve();
      return Promise.reject(new Error('The course session is still loading.'));
    },
    shouldValidateIncomingPair: () => coursePortProvidedRef.current,
  }), []);
  const controller = useMemo(
    () => createSharedDeckSessionController({
      adapter,
      intake: forwardedIntake,
      browser,
      coursePort: forwardedCoursePort,
    }),
    [adapter, browser, forwardedCoursePort, forwardedIntake],
  );
  const model = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useLayoutEffect(() => {
    // Invalidate an old owner's pending accept before forwarding the new
    // owner's intake and course ports below. The passive effect remains as a
    // fallback for environments that do not run layout effects.
    void controller.activate(ownerKey);
    intakeRef.current = intake;
    coursePortRef.current = coursePort;
    coursePortProvidedRef.current = coursePort !== undefined;
  }, [controller, coursePort, intake, ownerKey]);

  useEffect(() => {
    void controller.activate(ownerKey);
  }, [controller, ownerKey]);

  useEffect(() => () => controller.dispose(), [controller]);

  return { model, actions: controller.actions };
}

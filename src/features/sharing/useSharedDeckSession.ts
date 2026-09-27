import { useEffect, useMemo, useSyncExternalStore } from 'react';
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
  coursePort = null,
}: UseSharedDeckSessionOptions): UseSharedDeckSessionResult {
  const controller = useMemo(
    () => createSharedDeckSessionController({ adapter, intake, browser, coursePort }),
    [adapter, browser, intake, coursePort],
  );
  const model = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    void controller.activate(ownerKey);
  }, [controller, ownerKey]);

  useEffect(() => () => controller.dispose(), [controller]);

  return { model, actions: controller.actions };
}

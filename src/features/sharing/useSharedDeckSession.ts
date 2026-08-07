import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  createSharedDeckSessionController,
  type SharedDeckAdapter,
  type SharedDeckBrowser,
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
}: UseSharedDeckSessionOptions): UseSharedDeckSessionResult {
  const controller = useMemo(
    () => createSharedDeckSessionController({ adapter, intake, browser }),
    [adapter, browser, intake],
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

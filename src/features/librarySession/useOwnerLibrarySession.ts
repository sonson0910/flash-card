import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  createOwnerLibrarySessionController,
  type OwnerLibrarySessionAdapter,
} from './ownerLibrarySessionController';

export interface UseOwnerLibrarySessionOptions {
  ownerId: string | null;
  libraryEpoch: number | null;
  cloudTotal: number;
  adapter: OwnerLibrarySessionAdapter;
}

export function useOwnerLibrarySession({
  ownerId,
  libraryEpoch,
  cloudTotal,
  adapter,
}: UseOwnerLibrarySessionOptions) {
  const controller = useMemo(
    () => createOwnerLibrarySessionController({ adapter }),
    [adapter],
  );
  const model = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const activationCloudTotalRef = useRef(cloudTotal);
  activationCloudTotalRef.current = cloudTotal;

  useEffect(
    () => controller.activate({
      ownerId,
      libraryEpoch,
      cloudTotal: activationCloudTotalRef.current,
    }),
    [controller, libraryEpoch, ownerId],
  );

  useEffect(() => {
    void controller.updateContext({ ownerId, libraryEpoch, cloudTotal });
  }, [cloudTotal, controller, libraryEpoch, ownerId]);

  const actions = useMemo(() => ({
    migrateLegacy: controller.migrateLegacy,
  }), [controller]);

  return { model, actions };
}

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import { createIdentitySessionController } from './identitySessionController';
import { createIdentitySessionFirebaseAdapter } from './identitySessionFirebaseAdapter';

export function useIdentitySession({
  app,
  database,
  configured,
}: {
  app: FirebaseApp | null;
  database: Firestore | null;
  configured: boolean;
}) {
  const adapter = useMemo(
    () => createIdentitySessionFirebaseAdapter({ app, database, configured }),
    [app, configured, database],
  );
  const controller = useMemo(() => createIdentitySessionController({ adapter }), [adapter]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => controller.start(), [controller]);

  return {
    ...snapshot,
    signIn: controller.signIn,
    signOut: controller.signOut,
    clearError: controller.clearError,
    acceptVerifiedOwnerEpoch: controller.acceptVerifiedOwnerEpoch,
  };
}

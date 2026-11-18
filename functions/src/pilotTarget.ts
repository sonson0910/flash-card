import runtimeTarget from './runtime-target.json';

export type PilotTarget = 'production' | 'staging';

const projects: Record<PilotTarget, string> = {
  production: 'encoded-hangout-433912-h2',
  staging: 'sonflash-staging-20260906',
};

export function validatePilotTarget(environment: NodeJS.ProcessEnv): {
  target: PilotTarget; projectId: string; databaseId: string;
} {
  const target = environment.PILOT_TARGET?.trim();
  const projectId = environment.FIREBASE_PROJECT_ID?.trim();
  const databaseId = environment.FIRESTORE_DATABASE_ID?.trim();
  if ((target !== 'production' && target !== 'staging')
    || projectId !== projects[target]
    || databaseId !== runtimeTarget.firestoreDatabaseId) {
    throw new Error('PILOT_TARGET, FIREBASE_PROJECT_ID and FIRESTORE_DATABASE_ID must name one sealed pilot target.');
  }
  return { target, projectId, databaseId };
}

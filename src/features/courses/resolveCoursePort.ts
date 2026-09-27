import type { CoursePort } from './coursePort';

let cachedPort: Promise<CoursePort> | null = null;

/**
 * Loads the Firebase course adapter on first use. Both imports stay dynamic so
 * the course gate adds no Firestore or Functions code to the initial bundle.
 */
export const resolveCoursePort = (): Promise<CoursePort> => {
  if (!cachedPort) {
    cachedPort = Promise.all([import('./firebaseCourseAdapter'), import('../../lib/firebase')])
      .then(([adapter, firebase]) => adapter.createFirebaseCourseAdapter({
        app: firebase.app, database: firebase.db, configured: firebase.isFirebaseConfigured,
      }));
  }
  return cachedPort;
};

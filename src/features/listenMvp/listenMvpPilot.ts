import type { ListenMvpLessonV1 } from './listenMvpContract';

/**
 * Canonical production seam. Candidate audio remains unavailable until a
 * trusted reviewed/published binding is supplied by a later release step.
 */
export const LISTEN_MVP_PILOT_LESSONS: readonly ListenMvpLessonV1[] = Object.freeze([]);

export function selectListenMvpPilotLesson(_index: number): ListenMvpLessonV1 | null {
  return null;
}

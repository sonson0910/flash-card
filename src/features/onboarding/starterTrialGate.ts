import type { CourseTargetLanguage } from '../courses/courseModel';
import type { StarterCardOutcome } from './createStarterCards';

export type StarterTrialResult = StarterCardOutcome | 'already-added';

/**
 * Lets one onboarding write starter cards for a single target language. Each target has its own
 * operation id, so a second target would reserve the monthly AI-card quota again and leave the
 * first batch outside the course the learner finishes with. Asking again for the same target is
 * allowed because the server replays that operation without spending quota. A batch that failed
 * or was refused for quota wrote nothing, so it does not hold the claim.
 */
export function createStarterTrialGate() {
  let claimedTarget: CourseTargetLanguage | null = null;
  return {
    async run(
      target: CourseTargetLanguage,
      create: () => Promise<StarterCardOutcome>,
    ): Promise<StarterTrialResult> {
      if (claimedTarget !== null && claimedTarget !== target) return 'already-added';
      const previousClaim = claimedTarget;
      claimedTarget = target;
      try {
        const outcome = await create();
        if (outcome.created.length === 0) claimedTarget = previousClaim;
        return outcome;
      } catch (error) {
        claimedTarget = previousClaim;
        throw error;
      }
    },
  };
}

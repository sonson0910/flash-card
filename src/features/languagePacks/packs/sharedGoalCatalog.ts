import type { LanguagePackGoal } from '../types';

/**
 * Goal ids shared by every wave-1 pack. Onboarding (a later phase) renders
 * the label via its own <Trans>/msg() call using labelId/labelMessage; this
 * module only classifies which goals are available for the pack, so it
 * intentionally holds no JSX and needs no catalog entry of its own yet.
 */
export const COMMON_LANGUAGE_PACK_GOALS: readonly LanguagePackGoal[] = [
  { id: 'general', labelId: 'language-pack.goal.general', labelMessage: 'General fluency' },
  { id: 'exam', labelId: 'language-pack.goal.exam', labelMessage: 'Exam preparation' },
  { id: 'travel', labelId: 'language-pack.goal.travel', labelMessage: 'Travel and daily life' },
  { id: 'communication', labelId: 'language-pack.goal.communication', labelMessage: 'Conversation and communication' },
];

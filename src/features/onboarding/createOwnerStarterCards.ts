import { db } from '../../lib/firebase';
import type { CourseNativeLanguage, CourseTargetLanguage } from '../courses/courseModel';
import { createStarterCards, type StarterCardOutcome } from './createStarterCards';

/** Binds starter-card creation to the app's Firestore instance so onboarding UI never imports Firebase. */
export async function createOwnerStarterCards(
  ownerId: string,
  targetLanguage: CourseTargetLanguage,
  nativeLanguage: CourseNativeLanguage,
): Promise<StarterCardOutcome> {
  if (!db) throw new Error('Firebase is not configured.');
  return createStarterCards(db, ownerId, targetLanguage, nativeLanguage);
}

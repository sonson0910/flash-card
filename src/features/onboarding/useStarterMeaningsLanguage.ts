import { useCallback, useState } from 'react';
import type { CourseNativeLanguage } from '../courses/courseModel';
import { starterMeaningsLanguageStore } from './starterTrialGate';

/**
 * Tracks the native language the starter cards were written with. The cards keep those meanings
 * when the learner changes the native language afterwards, so the trial says so. The first batch
 * decides the language and it is kept on the device, so a reload or a resumed setup that adds
 * the same words again in the new language does not hide the note.
 */
export function useStarterMeaningsLanguage(ownerId: string, nativeLanguage: CourseNativeLanguage) {
  const [store] = useState(() => starterMeaningsLanguageStore(ownerId));
  const [writtenWith, setWrittenWith] = useState<CourseNativeLanguage | null>(() => store.read());
  const remember = useCallback((language: CourseNativeLanguage) => setWrittenWith(store.rememberFirst(language)), [store]);
  return { followsEarlierLanguage: writtenWith !== null && writtenWith !== nativeLanguage, remember };
}

import type { CardData } from '../types/card';
import { projectCourseCardIndex as projectProjection } from '../../functions/src/course-card-index-contract';

export {
  COURSE_QUERY_INDEX_PROJECTION_VERSION,
  COURSE_QUERY_INDEX_SCHEMA_VERSION,
  SUPPORTED_TARGET_LANGUAGES,
  UnsupportedCourseCardLanguageError,
  effectiveCardTargetLanguage,
  isSupportedTargetLanguage,
} from '../../functions/src/course-card-index-contract';

export type {
  CourseCardIndexDifficulty,
  CourseCardIndexInput,
  CourseCardIndexProjection,
  CourseCardIndexRow,
  CourseQueryContext,
  CourseQueryIndexGeneration,
  CourseQueryIndexGenerationStatus,
  CourseQueryIndexPointer,
  SupportedTargetLanguage,
} from '../../functions/src/course-card-index-contract';

export function projectCourseCardIndex(card: Partial<CardData>, cardId: string) {
  return projectProjection(card as Readonly<Record<string, unknown>>, cardId);
}

export const buildCourseCardIndexProjection = projectCourseCardIndex;
export const projectCourseCard = projectCourseCardIndex;

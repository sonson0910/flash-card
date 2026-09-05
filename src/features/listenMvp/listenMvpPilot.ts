import { parseCatalogSourceAssetRegistryV1 } from '../catalogPipeline/catalogValidation';
import {
  parseListenMvpLessonV1 as parseLesson,
  type ListenMvpLessonV1,
} from './listenMvpContract';
import {
  LISTEN_MVP_PILOT_LESSONS_DATA,
  LISTEN_MVP_PILOT_REGISTRY_DATA,
} from './listenMvpPilotData';

export const LISTEN_MVP_PILOT_REGISTRY = Object.freeze(
  parseCatalogSourceAssetRegistryV1(LISTEN_MVP_PILOT_REGISTRY_DATA),
);

export const listenMvpPilotRegistry = LISTEN_MVP_PILOT_REGISTRY;

const knownLexemeIds = new Set(LISTEN_MVP_PILOT_LESSONS_DATA.flatMap(lesson => lesson.chunk.lexemeIds));

const parsePilotDataLesson = (lesson: (typeof LISTEN_MVP_PILOT_LESSONS_DATA)[number]) =>
  parseListenMvpPilotLessonV1({
    clip: lesson.clip,
    chunk: lesson.chunk,
    comprehension: lesson.comprehension,
  });

export function parseListenMvpPilotLessonV1(value: unknown): ListenMvpLessonV1 {
  return parseLesson(value, LISTEN_MVP_PILOT_REGISTRY, knownLexemeIds);
}

export const LISTEN_MVP_PILOT_LESSONS: readonly ListenMvpLessonV1[] = Object.freeze(
  LISTEN_MVP_PILOT_LESSONS_DATA.flatMap(lesson => {
    try {
      return [parsePilotDataLesson(lesson)];
    } catch {
      return [];
    }
  }),
);

export const listenMvpPilotLessons = LISTEN_MVP_PILOT_LESSONS;

export function selectListenMvpPilotLesson(index: number): ListenMvpLessonV1 | null {
  if (!Number.isSafeInteger(index) || LISTEN_MVP_PILOT_LESSONS.length === 0) return null;
  const normalizedIndex = ((index % LISTEN_MVP_PILOT_LESSONS.length) + LISTEN_MVP_PILOT_LESSONS.length)
    % LISTEN_MVP_PILOT_LESSONS.length;
  return LISTEN_MVP_PILOT_LESSONS[normalizedIndex] ?? null;
}

export { VOA_ATTRIBUTION, VOA_RIGHTS_URL } from './listenMvpPilotData';

import { useLearningStatePersistence } from './useLearningStatePersistence';
import type { LearningPersistenceHook } from './learningPersistencePort';

export const defaultLearningPersistenceHook: LearningPersistenceHook = useLearningStatePersistence;

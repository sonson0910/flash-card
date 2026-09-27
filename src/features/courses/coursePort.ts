import type {
  Course,
  CourseGoal,
  CourseProfile,
  CreateCourseInput,
  CreateGoalInput,
  UpdateCourseInput,
  UpdateGoalInput,
} from './courseModel';

export type CourseProfileSource = 'cloud' | 'absent';

export interface CourseProfileRead {
  readonly source: CourseProfileSource;
  readonly profile: CourseProfile;
}

/**
 * The course boundary is intentionally independent of Firebase and React.
 * Sign-in is required to study, so every caller supplies a real owner id;
 * the Firebase adapter rejects null rather than quietly switching to local
 * state.
 */
export interface CoursePort {
  readonly available: boolean;
  load(ownerId: string | null): Promise<CourseProfileRead>;
  createCourse(ownerId: string | null, input: CreateCourseInput): Promise<CourseProfile>;
  updateCourse(ownerId: string | null, courseId: string, input: UpdateCourseInput): Promise<CourseProfile>;
  archiveCourse(ownerId: string | null, courseId: string): Promise<CourseProfile>;
  reopenCourse(ownerId: string | null, courseId: string): Promise<CourseProfile>;
  setActiveCourse(ownerId: string | null, courseId: string): Promise<CourseProfile>;
  addGoal(ownerId: string | null, courseId: string, input: CreateGoalInput): Promise<CourseProfile>;
  updateGoal(ownerId: string | null, courseId: string, goalId: string, input: UpdateGoalInput): Promise<CourseProfile>;
  removeGoal(ownerId: string | null, courseId: string, goalId: string): Promise<CourseProfile>;
}

export type { Course, CourseGoal, CourseProfile };


import { describe, expect, it } from 'vitest';
import { CourseError } from './courseModel';
import { createLocalCourseAdapter, type CourseProfileStorage } from './localCourseAdapter';

class MemoryStorage implements CourseProfileStorage {
  private readonly values = new Map<string, string>();
  private failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('storage is full');
    this.values.set(key, value);
  }

  failNextWrite(): void {
    this.failWrites = true;
  }
}

const createIdFactory = () => {
  let course = 0;
  let goal = 0;
  return (kind: 'course' | 'goal'): string => kind === 'course'
    ? `course-${++course}`
    : `goal-${++goal}`;
};

describe('local course adapter', () => {
  it('returns an explicit local legacy fallback without a cloud write', async () => {
    const storage = new MemoryStorage();
    const adapter = createLocalCourseAdapter({ storage, createId: createIdFactory() });

    await expect(adapter.load(null)).resolves.toMatchObject({
      source: 'local',
      profile: {
        activeCourseId: 'legacy-en-vi',
        courses: [{ id: 'legacy-en-vi', targetLanguage: 'en', nativeLanguage: 'vi' }],
      },
    });
    expect(storage.getItem('sonflash_course_profile_v1:anonymous')).toBeNull();
  });

  it('keeps owner profiles isolated and enforces one course per target', async () => {
    const adapter = createLocalCourseAdapter({
      storage: new MemoryStorage(),
      createId: createIdFactory(),
      now: () => '2026-09-25T00:00:00.000Z',
    });

    const ownerA = await adapter.createCourse('owner-a', { targetLanguage: 'ko', nativeLanguage: 'vi' });
    expect(ownerA.courses.map(course => course.targetLanguage)).toEqual(['en', 'ko']);
    await expect(adapter.createCourse('owner-a', { targetLanguage: 'ko', nativeLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'course-exists', details: { courseId: 'course-1' } });
    await expect(adapter.load('owner-b')).resolves.toMatchObject({
      source: 'local',
      profile: { activeCourseId: 'legacy-en-vi' },
    });
    await expect(adapter.load('owner-a')).resolves.toMatchObject({
      profile: { activeCourseId: 'legacy-en-vi', courses: [{ id: 'legacy-en-vi' }, { id: 'course-1' }] },
    });
  });

  it('archives safely, rejects archived selection, and reopens by the same ID', async () => {
    const adapter = createLocalCourseAdapter({ storage: new MemoryStorage(), createId: createIdFactory() });
    await adapter.createCourse('owner-a', { targetLanguage: 'ko', nativeLanguage: 'vi' });

    const archived = await adapter.archiveCourse('owner-a', 'legacy-en-vi');
    expect(archived.activeCourseId).toBe('course-1');
    await expect(adapter.setActiveCourse('owner-a', 'legacy-en-vi'))
      .rejects.toMatchObject({ code: 'course-archived' });

    const reopened = await adapter.reopenCourse('owner-a', 'legacy-en-vi');
    expect(reopened.activeCourseId).toBe('legacy-en-vi');
    expect(reopened.courses[0]).toMatchObject({ id: 'legacy-en-vi', status: 'active' });
  });

  it('keeps the current session usable when browser storage writes are denied', async () => {
    const storage = new MemoryStorage();
    const adapter = createLocalCourseAdapter({ storage, createId: createIdFactory() });
    storage.failNextWrite();

    const updated = await adapter.createCourse('owner-a', { targetLanguage: 'ko', nativeLanguage: 'vi' });
    expect(updated.courses.some(course => course.targetLanguage === 'ko')).toBe(true);
    await expect(adapter.load('owner-a')).resolves.toMatchObject({
      profile: { courses: [{ id: 'legacy-en-vi' }, { id: 'course-1' }] },
    });
  });

  it('does not publish a mutation after the owner switches', async () => {
    let currentOwner: string | null = 'owner-a';
    const adapter = createLocalCourseAdapter({
      storage: new MemoryStorage(),
      getCurrentOwner: () => currentOwner,
      createId: createIdFactory(),
    });
    currentOwner = 'owner-b';

    await expect(adapter.createCourse('owner-a', { targetLanguage: 'ko', nativeLanguage: 'vi' }))
      .rejects.toMatchObject({ code: 'owner-changed' });
    currentOwner = 'owner-a';
    await expect(adapter.load('owner-a')).resolves.toMatchObject({
      profile: { courses: [{ id: 'legacy-en-vi' }] },
    });
  });

  it('does not turn an invalid saved profile into a successful fallback', async () => {
    const storage = new MemoryStorage();
    storage.setItem('sonflash_course_profile_v1:user:owner-a', JSON.stringify({ courses: [] }));
    const adapter = createLocalCourseAdapter({ storage });

    await expect(adapter.load('owner-a')).rejects.toBeInstanceOf(CourseError);
    await expect(adapter.load('owner-a')).rejects.toMatchObject({ code: 'profile-invalid' });
  });
});

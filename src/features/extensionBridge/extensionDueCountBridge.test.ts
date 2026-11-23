import { describe, expect, it } from 'vitest';
import { extensionDueCountFor } from './extensionDueCountBridge';

const cloud = (overrides: Partial<Parameters<typeof extensionDueCountFor>[0]> = {}) => ({
  ownerId: 'owner-a',
  statsTargetLanguage: 'ko' as string | null | undefined,
  stats: { due: 4, dueAsOfDate: '2026-11-23' },
  ...overrides,
});

describe('extensionDueCountFor', () => {
  it('returns the due count only for the active course, today and the signed-in owner', () => {
    expect(extensionDueCountFor(cloud(), 'owner-a', 'ko', '2026-11-23')).toBe(4);
  });

  it('has no count before any stats were loaded for the active course', () => {
    expect(extensionDueCountFor(cloud({ statsTargetLanguage: undefined, stats: { due: 0 } }), 'owner-a', 'ko', '2026-11-23')).toBeNull();
  });

  it('has no count while the loaded stats belong to the previous course', () => {
    expect(extensionDueCountFor(cloud({ statsTargetLanguage: 'en' }), 'owner-a', 'ko', '2026-11-23')).toBeNull();
  });

  it('has no count for stats computed on an earlier day', () => {
    expect(extensionDueCountFor(cloud({ stats: { due: 4, dueAsOfDate: '2026-11-22' } }), 'owner-a', 'ko', '2026-11-23')).toBeNull();
  });

  it('has no count when the stats belong to another owner', () => {
    expect(extensionDueCountFor(cloud({ ownerId: 'owner-b' }), 'owner-a', 'ko', '2026-11-23')).toBeNull();
    expect(extensionDueCountFor(cloud({ ownerId: null }), null, 'ko', '2026-11-23')).toBeNull();
  });
});

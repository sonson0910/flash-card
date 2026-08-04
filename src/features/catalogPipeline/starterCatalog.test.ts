import { describe, expect, it } from 'vitest';
import { buildCatalogRelease } from './catalogBuilder';
import { createEnglishStarterCatalog } from './starterCatalog';

describe('English starter catalog', () => {
  it('publishes distinct IELTS, TOEIC and General paths from foundation to advanced', async () => {
    const source = await createEnglishStarterCatalog();
    const counts = source.memberships.reduce<Record<string, number>>((result, candidate) => {
      const key = `${candidate.entity.trackId}:${candidate.entity.tier}`;
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {});

    expect(source.lexemes).toHaveLength(300);
    expect(source.memberships).toHaveLength(300);
    expect(counts).toEqual({
      'ielts:foundation': 50,
      'ielts:core': 50,
      'ielts:advanced': 50,
      'toeic:foundation': 30,
      'toeic:core': 30,
      'toeic:advanced': 30,
      'general:foundation': 20,
      'general:core': 20,
      'general:advanced': 20,
    });

    await expect(buildCatalogRelease(source, {
      releaseId: 'starter-v1',
      sequence: 1,
      previousReleaseId: null,
      createdAt: '2026-08-04T00:00:00.000Z',
    })).resolves.toMatchObject({ status: 'built' });
  });
});

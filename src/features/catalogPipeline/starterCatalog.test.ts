import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildCatalogRelease, fingerprintCatalogSourceBundle } from './catalogBuilder';
import { createEnglishStarterCatalogDraft } from './starterCatalog';

beforeAll(() => vi.useFakeTimers({ now: new Date('2026-08-04T00:00:00.000Z') }));
afterAll(() => vi.useRealTimers());

describe('English starter catalog', () => {
  it('keeps the generated IELTS, TOEIC and General starter selection as an editorial draft', async () => {
    const source = createEnglishStarterCatalogDraft();
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

    expect([...source.lexemes, ...source.memberships].every(candidate => (
      candidate.review.status === 'unreviewed'
      && candidate.provenance.origin === 'ai-assisted'
      && candidate.provenance.publishability === 'non-publishable'
    ))).toBe(true);
    expect(source.lexemes.every(candidate => candidate.entity.provenance.editorialStatus === 'draft'))
      .toBe(true);
    expect(source.memberships.every(candidate => candidate.entity.editorialStatus === 'draft'))
      .toBe(true);

    await expect(buildCatalogRelease(source, {
      sequence: 1,
      previousReleaseId: null,
      reviewerAuthority: {
        reviewerId: 'fixture-reviewer',
        approvedDigest: await fingerprintCatalogSourceBundle(source),
        reviewedAt: '2026-08-04T00:00:00.000Z',
      },
    })).resolves.toMatchObject({ status: 'rejected', reason: 'entity-not-published' });
  });
});

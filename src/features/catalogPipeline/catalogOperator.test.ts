import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  CatalogLexemeCandidateV1,
  CatalogMembershipCandidateV1,
  CatalogSourceBundleV1,
} from './catalogContracts';
import { buildCatalogRelease, fingerprintCatalogSourceBundle } from './catalogBuilder';
import { createEnglishPilotCatalog } from './pilotCatalog';

const buildOptionsFor = async (source: CatalogSourceBundleV1) => ({
  sequence: 1,
  previousReleaseId: null,
  reviewerAuthority: {
    reviewerId: 'fixture-reviewer',
    approvedDigest: await fingerprintCatalogSourceBundle(source),
    reviewedAt: '2026-08-03T00:00:00.000Z',
  },
});

beforeAll(() => vi.useFakeTimers({ now: new Date('2026-08-03T00:00:00.000Z') }));
afterAll(() => vi.useRealTimers());

const markEntityPublished = (
  candidate: CatalogLexemeCandidateV1,
): CatalogLexemeCandidateV1 => ({
  ...candidate,
  entity: {
    ...candidate.entity,
    provenance: { ...candidate.entity.provenance, editorialStatus: 'published' },
  },
});

const markMembershipPublished = (
  candidate: CatalogMembershipCandidateV1,
): CatalogMembershipCandidateV1 => ({
  ...candidate,
  entity: { ...candidate.entity, editorialStatus: 'published' },
});

describe('catalog operator publication gate', () => {
  it('rejects the unreviewed draft pilot without producing release artifacts', async () => {
    const source = createEnglishPilotCatalog();
    const result = await buildCatalogRelease(source, await buildOptionsFor(source));

    expect(result).toEqual({
      status: 'rejected',
      reason: 'entity-not-published',
      path: 'lexemes[0]',
    });
    expect(result).not.toHaveProperty('artifact');
  });

  it('still rejects the pilot if entity statuses are dishonestly changed to published', async () => {
    const pilot = createEnglishPilotCatalog();
    const statusOnlyMutation: CatalogSourceBundleV1 = {
      ...pilot,
      lexemes: pilot.lexemes.map(markEntityPublished),
      memberships: pilot.memberships.map(markMembershipPublished),
    };

    const result = await buildCatalogRelease(statusOnlyMutation, await buildOptionsFor(statusOnlyMutation));

    expect(result).toEqual({
      status: 'rejected',
      reason: 'provenance-not-publishable',
      path: 'lexemes[0]',
    });
    expect(result).not.toHaveProperty('artifact');
  });
});

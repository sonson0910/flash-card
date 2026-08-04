import { describe, expect, it } from 'vitest';

import type {
  CatalogLexemeCandidateV1,
  CatalogMembershipCandidateV1,
  CatalogSourceBundleV1,
} from './catalogContracts';
import { buildCatalogRelease } from './catalogBuilder';
import { createEnglishPilotCatalog } from './pilotCatalog';

const buildOptions = {
  sequence: 1,
  previousReleaseId: null,
  createdAt: '2026-08-03T00:00:00.000Z',
  reviewerAuthority: { trustedReviewerIds: [] },
} as const;

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
    const result = await buildCatalogRelease(createEnglishPilotCatalog(), buildOptions);

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

    const result = await buildCatalogRelease(statusOnlyMutation, buildOptions);

    expect(result).toEqual({
      status: 'rejected',
      reason: 'provenance-not-publishable',
      path: 'lexemes[0]',
    });
    expect(result).not.toHaveProperty('artifact');
  });
});

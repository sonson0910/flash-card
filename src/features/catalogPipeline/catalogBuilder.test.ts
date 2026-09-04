import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLexemeId, createTrackMembershipId } from '../multilingual/lexemeIdentity';
import type { LexemeV3, TrackMembershipV3 } from '../multilingual/schemaV3';
import type {
  CatalogCandidateProvenanceV1,
  CatalogSourceAssetRegistryV1,
  CatalogSourceBundleV1,
} from './catalogContracts';
import {
  buildCatalogRelease,
  canonicalCatalogJson,
  deriveCatalogReleaseId,
  fingerprintCatalogApproval,
  fingerprintCatalogEntity,
  fingerprintCatalogReviewContent,
  sha256Hex,
} from './catalogBuilder';

const now = '2026-08-03T10:00:00.000Z';

beforeAll(() => vi.useFakeTimers({ now: new Date(now) }));
afterAll(() => vi.useRealTimers());

const provenance: CatalogCandidateProvenanceV1 = {
  schemaVersion: 1,
  sourceRef: 'editorial-team',
  sourceUrl: null,
  licenseId: 'CC0-1.0',
  rightsEvidenceId: 'rights:editorial-2026',
  attribution: 'LingoFlash editorial team',
  authorId: 'author-1',
  origin: 'human-authored',
  publishability: 'publishable',
};

const rightsRegistry = (): CatalogSourceAssetRegistryV1 => ({
  registryVersion: 1,
  assets: [{
    sourceRef: 'editorial-team',
    sourceUrl: null,
    licenseId: 'CC0-1.0',
    rightsEvidenceId: 'rights:editorial-2026',
    basis: 'open-license',
    commercialUse: 'allowed',
    derivatives: 'allowed',
    rehosting: 'allowed',
    attribution: { required: false, text: null },
    thirdPartyFragments: 'none',
    territory: 'worldwide',
    expiresAt: null,
    sourceRevision: 'revision-1',
    sourceAssetSha256: 'a'.repeat(64),
    revokedAt: null,
  }],
});

const lexeme = (index: number, contentVersion = 1): LexemeV3 => {
  const identity = {
    language: 'en', normalizedLemma: `term ${index}`, partOfSpeech: 'noun', senseKey: 'primary',
  };
  return {
    schemaVersion: 3,
    id: createLexemeId(identity),
    ...identity,
    lemma: `Term ${index}`,
    definitions: [{ language: 'vi', text: `Nghia ${index}` }],
    phonetics: [], examples: [], collocations: [], wordFamily: [],
    media: { audioUrl: null, imageUrl: null },
    compatibility: {
      legacyPartOfSpeech: 'noun', translation: `Nghia ${index}`, explanation: '',
      explanationTranslation: '', emoji: '', exampleSentence: '', exampleTranslation: '',
      synonyms: [], antonyms: [], register: '', commonMistake: '',
    },
    provenance: {
      source: provenance.sourceRef,
      license: provenance.licenseId,
      reviewer: 'fixture-reviewer',
      editorialStatus: 'published',
    },
    contentVersion,
    createdAt: now,
    updatedAt: now,
  };
};

const membership = (
  item: LexemeV3,
  rank: number,
  contentVersion = 1,
): TrackMembershipV3 => ({
  schemaVersion: 3,
  id: createTrackMembershipId({ trackId: 'general', lexemeId: item.id }),
  lexemeId: item.id,
  trackId: 'general',
  tier: 'foundation',
  cefrLevel: 'A1',
  topic: 'basics',
  legacyCategory: 'General',
  skills: ['reading'],
  rank,
  lessonGroup: 'pilot',
  editorialStatus: 'published',
  contentVersion,
});

async function bundle(count = 1): Promise<CatalogSourceBundleV1> {
  const lexemes = Array.from({ length: count }, (_, index) => lexeme(index));
  const memberships = lexemes.map((item, index) => membership(item, index));
  return {
    manifest: {
      manifestVersion: 1,
      catalogId: 'english-pilot',
      contentLanguage: 'en',
      supportLanguages: ['vi'],
      lexemeFiles: ['lexemes/core.jsonl'],
      membershipFiles: ['memberships/general.jsonl'],
    },
    lexemes: await Promise.all(lexemes.map(async entity => ({
      entity,
      provenance,
      review: {
        status: 'reviewed' as const,
        reviewerId: 'fixture-reviewer',
        reviewedAt: now,
        contentDigest: await fingerprintCatalogReviewContent({
          ...entity,
          provenance: { ...entity.provenance, editorialStatus: 'reviewed' },
        }),
      },
    }))),
    memberships: await Promise.all(memberships.map(async entity => ({
      entity,
      provenance,
      review: {
        status: 'reviewed' as const,
        reviewerId: 'fixture-reviewer',
        reviewedAt: now,
        contentDigest: await fingerprintCatalogReviewContent({
          ...entity,
          editorialStatus: 'reviewed',
        }),
      },
    }))),
  };
}

const lineageOptions = {
  sequence: 1,
  previousReleaseId: null,
  reviewerAuthority: {
    reviewerId: 'fixture-reviewer', approvedDigest: '0'.repeat(64), reviewedAt: now,
  },
  trustedAssetRegistry: rightsRegistry(),
};

const optionsFor = async (
  source: CatalogSourceBundleV1,
  reviewerId = 'fixture-reviewer',
): Promise<typeof lineageOptions> => ({
  ...lineageOptions,
  reviewerAuthority: {
    reviewerId,
    approvedDigest: await fingerprintCatalogApproval(source, rightsRegistry()),
    reviewedAt: now,
  },
});

describe('buildCatalogRelease', () => {
  it('rejects an approval digest that does not match the validated source bundle', async () => {
    const source = await bundle();
    const result = await buildCatalogRelease(source, {
      ...lineageOptions,
      reviewerAuthority: {
        reviewerId: 'fixture-reviewer',
        approvedDigest: '0'.repeat(64),
        reviewedAt: now,
      },
    });

    expect(result).toEqual({ status: 'rejected', reason: 'approval-digest-mismatch' });
  });

  it('rejects source content changed after the protected digest was approved', async () => {
    const source = await bundle();
    const approvedDigest = await fingerprintCatalogApproval(source, rightsRegistry());
    const changed = {
      ...source,
      lexemes: source.lexemes.map(candidate => ({
        ...candidate,
        entity: { ...candidate.entity, lemma: 'Changed after review' },
      })),
    };

    const result = await buildCatalogRelease(changed, {
      ...lineageOptions,
      reviewerAuthority: { reviewerId: 'fixture-reviewer', approvedDigest, reviewedAt: now },
    });

    expect(result).toEqual({ status: 'rejected', reason: 'approval-digest-mismatch' });
  });

  it('rejects a protected approval that is stale or from the future', async () => {
    const source = await bundle();
    const approvedDigest = await fingerprintCatalogApproval(source, rightsRegistry());
    const base = {
      ...lineageOptions,
      reviewerAuthority: { reviewerId: 'fixture-reviewer', approvedDigest, reviewedAt: now },
    };

    await expect(buildCatalogRelease(source, {
      ...base,
      reviewerAuthority: {
        ...base.reviewerAuthority,
        reviewedAt: '2026-08-01T10:00:00.000Z',
      },
    })).resolves.toEqual({ status: 'rejected', reason: 'approval-stale' });
    await expect(buildCatalogRelease(source, {
      ...base,
      reviewerAuthority: {
        ...base.reviewerAuthority,
        reviewedAt: '2026-08-03T10:10:01.000Z',
      },
    })).resolves.toEqual({ status: 'rejected', reason: 'approval-in-future' });
  });

  it('does not let a caller-supplied clock override the protected freshness window', async () => {
    const source = await bundle();
    const callerOptions = {
      sequence: 1,
      previousReleaseId: null,
      reviewerAuthority: {
        reviewerId: 'fixture-reviewer',
        approvedDigest: await fingerprintCatalogApproval(source, rightsRegistry()),
        reviewedAt: '2026-08-01T10:00:00.000Z',
      },
      trustedAssetRegistry: rightsRegistry(),
      referenceTime: '2026-08-01T10:00:00.000Z',
    } as unknown as Parameters<typeof buildCatalogRelease>[1];
    const result = await buildCatalogRelease(source, callerOptions);

    expect(result).toEqual({ status: 'rejected', reason: 'approval-stale' });
  });

  it('uses only the protected reviewer identity when authorizing source review evidence', async () => {
    const source = await bundle();
    const result = await buildCatalogRelease(source, {
      ...lineageOptions,
      reviewerAuthority: {
        reviewerId: 'spoofed-source-reviewer',
        approvedDigest: await fingerprintCatalogApproval(source, rightsRegistry()),
        reviewedAt: now,
      },
    });

    expect(result).toMatchObject({
      status: 'rejected', reason: 'reviewer-not-trusted', path: 'lexemes[0]',
    });
  });

  it('rejects source review claims that are not authorized by the external build boundary', async () => {
    const source = await bundle();
    const result = await buildCatalogRelease(source, {
      ...await optionsFor(source, 'different-fixture-reviewer'),
    });

    expect(result).toMatchObject({
      status: 'rejected', reason: 'reviewer-not-trusted', path: 'lexemes[0]',
    });
  });

  it('keeps reviewed content binding stable across the reviewed to published workflow projection', async () => {
    const published = lexeme(0);
    const reviewed = {
      ...published,
      provenance: { ...published.provenance, editorialStatus: 'reviewed' as const },
    };
    expect(await fingerprintCatalogReviewContent(reviewed))
      .toBe(await fingerprintCatalogReviewContent(published));
    expect(await fingerprintCatalogEntity(reviewed)).not.toBe(await fingerprintCatalogEntity(published));
    expect(await fingerprintCatalogReviewContent({
      ...reviewed,
      definitions: [{ language: 'vi', text: 'Noi dung da bi thay doi' }],
    })).not.toBe(await fingerprintCatalogReviewContent(reviewed));
  });

  it('rejects malformed runtime input at the strict seam instead of throwing', async () => {
    await expect(buildCatalogRelease(
      null as unknown as CatalogSourceBundleV1,
      lineageOptions,
    )).resolves.toEqual({ status: 'rejected', reason: 'invalid-source' });
    const source = await bundle();
    await expect(buildCatalogRelease(source, {
      ...lineageOptions,
      trustedAssetRegistry: null as unknown as CatalogSourceAssetRegistryV1,
    })).resolves.toEqual({ status: 'rejected', reason: 'invalid-rights-registry' });
  });

  it('builds exact immutable manifest counts and content hashes', async () => {
    const source = await bundle();
    const options = await optionsFor(source);
    const result = await buildCatalogRelease(source, options);
    expect(result.status).toBe('built');
    if (result.status !== 'built') return;
    expect(result.artifact.manifest).toMatchObject({
      catalogId: 'english-pilot',
      releaseId: await deriveCatalogReleaseId(source, options),
      sequence: 1,
      previousReleaseId: null,
      createdAt: now,
      counts: { lexemes: 1, memberships: 1, chunks: 1 },
    });
    const [chunk] = result.artifact.chunks;
    expect(chunk.descriptor.sha256).toBe(await sha256Hex(chunk.bytes));
    expect(chunk.descriptor.byteLength).toBe(chunk.bytes.byteLength);
    expect(new TextDecoder().decode(result.artifact.manifestBytes))
      .toBe(canonicalCatalogJson(result.artifact.manifest));
  });

  it('derives immutable release ids from canonical content and lineage metadata', async () => {
    const source = await bundle(2);
    const reordered = {
      ...source,
      lexemes: [...source.lexemes].reverse(),
      memberships: [...source.memberships].reverse(),
    };
    const first = await deriveCatalogReleaseId(source, lineageOptions);
    const second = await deriveCatalogReleaseId(reordered, lineageOptions);
    const changedSource = await bundle(2);
    const changedEntity = {
      ...changedSource.lexemes[0].entity,
      definitions: [{ language: 'vi', text: 'Noi dung khac' }],
    };
    const changed: CatalogSourceBundleV1 = {
      ...changedSource,
      lexemes: [{
        ...changedSource.lexemes[0],
        entity: changedEntity,
        review: {
          status: 'reviewed',
          reviewerId: 'fixture-reviewer',
          reviewedAt: now,
          contentDigest: await fingerprintCatalogReviewContent(changedEntity),
        },
      }, ...changedSource.lexemes.slice(1)],
    };

    expect(first).toMatch(/^r-[a-f0-9]{24}$/);
    expect(second).toBe(first);
    expect(await deriveCatalogReleaseId(changed, lineageOptions)).not.toBe(first);
  });

  it('rejects templated placeholder prose even when metadata claims review', async () => {
    const source = await bundle();
    const entity = {
      ...source.lexemes[0].entity,
      examples: [{
        text: 'Learners can term 0 in a practical situation.',
        translations: [{ language: 'vi', text: 'Vi du mau.' }],
      }],
      compatibility: {
        ...source.lexemes[0].entity.compatibility,
        explanation: 'Term 0 is a noun in the LingoFlash English starter catalog.',
      },
    };
    const templatedSource: CatalogSourceBundleV1 = {
      ...source,
      lexemes: [{
        ...source.lexemes[0],
        entity,
        review: {
          status: 'reviewed', reviewerId: 'fixture-reviewer', reviewedAt: now,
          contentDigest: await fingerprintCatalogReviewContent(entity),
        },
      }],
    };

    await expect(buildCatalogRelease(templatedSource, await optionsFor(templatedSource))).resolves.toMatchObject({
      status: 'rejected', reason: 'semantic-quality', path: 'lexemes[0]',
    });
  });

  it('produces byte-identical output regardless of accepted source ordering', async () => {
    const source = await bundle(3);
    const reordered = {
      ...source,
      lexemes: [...source.lexemes].reverse(),
      memberships: [...source.memberships].reverse(),
    };
    const first = await buildCatalogRelease(source, await optionsFor(source));
    const second = await buildCatalogRelease(reordered, await optionsFor(reordered));
    expect(first.status).toBe('built');
    expect(second.status).toBe('built');
    if (first.status !== 'built' || second.status !== 'built') return;
    expect([...first.artifact.manifestBytes]).toEqual([...second.artifact.manifestBytes]);
    expect(first.artifact.chunks.map(chunk => [...chunk.bytes]))
      .toEqual(second.artifact.chunks.map(chunk => [...chunk.bytes]));
  });

  it('binds protected approval and release identity to referenced rights snapshots', async () => {
    const source = await bundle();
    const registry = rightsRegistry();
    const changedRegistry: CatalogSourceAssetRegistryV1 = {
      ...registry,
      assets: [{ ...registry.assets[0], sourceRevision: 'revision-2' }],
    };
    const unrelatedRegistry: CatalogSourceAssetRegistryV1 = {
      ...registry,
      assets: [
        ...registry.assets,
        { ...registry.assets[0], sourceRef: 'unreferenced-asset' },
      ],
    };
    const originalDigest = await fingerprintCatalogApproval(source, registry);
    const changedDigest = await fingerprintCatalogApproval(source, changedRegistry);
    expect(changedDigest).not.toBe(originalDigest);
    expect(await fingerprintCatalogApproval(source, unrelatedRegistry)).toBe(originalDigest);
    expect(await deriveCatalogReleaseId(source, {
      ...lineageOptions,
      trustedAssetRegistry: changedRegistry,
    })).not.toBe(await deriveCatalogReleaseId(source, lineageOptions));

    const result = await buildCatalogRelease(source, {
      ...lineageOptions,
      trustedAssetRegistry: changedRegistry,
      reviewerAuthority: {
        ...lineageOptions.reviewerAuthority,
        approvedDigest: originalDigest,
      },
    });
    expect(result).toEqual({ status: 'rejected', reason: 'approval-digest-mismatch' });
  });

  it('canonicalizes rights territory ordering in approval fingerprints', async () => {
    const source = await bundle();
    const first: CatalogSourceAssetRegistryV1 = {
      ...rightsRegistry(),
      assets: [{ ...rightsRegistry().assets[0], territory: ['US', 'CA'] }],
    };
    const second: CatalogSourceAssetRegistryV1 = {
      ...rightsRegistry(),
      assets: [{ ...rightsRegistry().assets[0], territory: ['CA', 'US'] }],
    };
    expect(await fingerprintCatalogApproval(source, first))
      .toBe(await fingerprintCatalogApproval(source, second));
  });

  it.each([
    ['expiry', { expiresAt: '2026-08-03T10:30:00.000Z' }, 'rights-expired'],
    ['revocation', { revokedAt: '2026-08-03T10:30:00.000Z' }, 'rights-revoked'],
  ] as const)('uses the trusted current build time for rights %s', async (_label, change, reason) => {
    const source = await bundle();
    const registry: CatalogSourceAssetRegistryV1 = {
      ...rightsRegistry(),
      assets: [{ ...rightsRegistry().assets[0], ...change }],
    };
    const authority = {
      ...lineageOptions.reviewerAuthority,
      approvedDigest: await fingerprintCatalogApproval(source, registry),
    };
    vi.setSystemTime(new Date('2026-08-03T10:31:00.000Z'));
    try {
      const result = await buildCatalogRelease(source, {
        ...lineageOptions,
        reviewerAuthority: authority,
        trustedAssetRegistry: registry,
      });
      expect(result).toMatchObject({ status: 'rejected', reason });
    } finally {
      vi.setSystemTime(new Date(now));
    }
  });

  it('chunks at no more than 100 memberships and 512 KiB each', async () => {
    const source = await bundle(101);
    const result = await buildCatalogRelease(source, await optionsFor(source));
    expect(result.status).toBe('built');
    if (result.status !== 'built') return;
    expect(result.artifact.chunks).toHaveLength(2);
    expect(result.artifact.chunks.every(chunk => chunk.payload.memberships.length <= 100)).toBe(true);
    expect(result.artifact.chunks.every(chunk => chunk.payload.memberships.length > 0)).toBe(true);
    expect(result.artifact.chunks.every(chunk => chunk.bytes.byteLength <= 512 * 1024)).toBe(true);
  });

  it('rejects unreferenced lexemes instead of emitting delivery-incompatible empty chunks', async () => {
    const source = await bundle();
    const changed = { ...source, memberships: [] };
    const result = await buildCatalogRelease(changed, await optionsFor(changed));
    expect(result).toMatchObject({ status: 'rejected', reason: 'unreferenced-lexeme' });
  });

  it.each(['source', 'license', 'reviewer'] as const)(
    'rejects a public %s projection that differs from reviewed sidecar evidence',
    async field => {
      const source = await bundle();
      const entity = {
        ...source.lexemes[0].entity,
        provenance: { ...source.lexemes[0].entity.provenance, [field]: 'mismatched-public-value' },
      };
      const changed: CatalogSourceBundleV1 = {
        ...source,
        lexemes: [{
          ...source.lexemes[0],
          entity,
          review: {
            status: 'reviewed',
            reviewerId: 'fixture-reviewer',
            reviewedAt: now,
            contentDigest: await fingerprintCatalogReviewContent(entity),
          },
        }],
      };
      const result = await buildCatalogRelease(changed, await optionsFor(changed));
      expect(result).toMatchObject({ status: 'rejected', reason: 'public-provenance-mismatch' });
    },
  );

  it.each([
    ['draft entity', async () => {
      const source = await bundle();
      return { ...source, lexemes: [{
        ...source.lexemes[0],
        entity: {
          ...source.lexemes[0].entity,
          provenance: { ...source.lexemes[0].entity.provenance, editorialStatus: 'draft' as const },
        },
      }] };
    }],
    ['non-publishable provenance', async () => {
      const source = await bundle();
      return { ...source, lexemes: [{
        ...source.lexemes[0],
        provenance: { ...source.lexemes[0].provenance, publishability: 'non-publishable' as const },
      }] };
    }],
    ['self review', async () => {
      const source = await bundle();
      return { ...source, lexemes: [{
        ...source.lexemes[0],
        review: { ...source.lexemes[0].review, reviewerId: source.lexemes[0].provenance.authorId },
      }] };
    }],
    ['unbound review digest', async () => {
      const source = await bundle();
      return { ...source, lexemes: [{
        ...source.lexemes[0],
        review: { ...source.lexemes[0].review, contentDigest: '0'.repeat(64) },
      }] };
    }],
  ])('refuses publication for %s', async (_label, source) => {
    const changed = await source();
    const result = await buildCatalogRelease(changed, await optionsFor(changed));
    expect(result.status).toBe('rejected');
  });

  it('rejects generated pilot drafts rather than manufacturing publication evidence', async () => {
    const source = await bundle();
    const draft = {
      ...source,
      lexemes: source.lexemes.map(candidate => ({
        ...candidate,
        entity: {
          ...candidate.entity,
          provenance: {
            ...candidate.entity.provenance,
            license: 'NOASSERTION',
            reviewer: 'unreviewed',
            editorialStatus: 'draft' as const,
          },
        },
        provenance: {
          ...candidate.provenance,
          licenseId: 'NOASSERTION',
          origin: 'ai-assisted' as const,
          generator: { provider: 'synthetic', model: 'pilot-v1' },
          publishability: 'non-publishable' as const,
        },
        review: { status: 'unreviewed' as const },
      })),
    };
    expect((await buildCatalogRelease(draft, await optionsFor(draft))).status).toBe('rejected');
  });

  it('uses catalogEditorial license policy at the publication gate', async () => {
    const source = await bundle();
    const entity = {
      ...source.lexemes[0].entity,
      provenance: { ...source.lexemes[0].entity.provenance, license: 'NOASSERTION' },
    };
    const changed: CatalogSourceBundleV1 = {
      ...source,
      lexemes: [{
        ...source.lexemes[0],
        entity,
        provenance: { ...source.lexemes[0].provenance, licenseId: 'NOASSERTION' },
        review: {
          status: 'reviewed',
          reviewerId: 'fixture-reviewer',
          reviewedAt: now,
          contentDigest: await fingerprintCatalogReviewContent(entity),
        },
      }],
    };
    const result = await buildCatalogRelease(changed, await optionsFor(changed));
    expect(result).toMatchObject({ status: 'rejected', reason: 'rights-license-mismatch' });
  });

  it('publishes project-authored content only with bounded rights evidence', async () => {
    const source = await bundle();
    const entity = {
      ...source.lexemes[0].entity,
      provenance: { ...source.lexemes[0].entity.provenance, license: 'project-authored' },
    };
    const candidate = {
      ...source.lexemes[0],
      entity,
      provenance: {
        ...source.lexemes[0].provenance,
        licenseId: 'project-authored',
        rightsEvidenceId: 'rights:editorial-contract-2026',
      },
      review: {
        status: 'reviewed' as const,
        reviewerId: 'fixture-reviewer',
        reviewedAt: now,
        contentDigest: await fingerprintCatalogReviewContent(entity),
      },
    };
    const changed = { ...source, lexemes: [candidate] };
    expect((await buildCatalogRelease(changed, await optionsFor(changed))).status)
      .toBe('rejected');
    const missingRights = {
      ...source,
      lexemes: [{
        ...candidate,
        provenance: { ...candidate.provenance, rightsEvidenceId: null },
      }],
    };
    expect(await buildCatalogRelease(missingRights, await optionsFor(missingRights)))
      .toMatchObject({ status: 'rejected', reason: 'rights-license-mismatch' });
  });

  it('rejects a content-bound review when reviewer and author are the same identity', async () => {
    const source = await bundle();
    const entity = {
      ...source.lexemes[0].entity,
      provenance: { ...source.lexemes[0].entity.provenance, reviewer: provenance.authorId },
    };
    const changed: CatalogSourceBundleV1 = {
      ...source,
      lexemes: [{
        ...source.lexemes[0],
        entity,
        review: {
          status: 'reviewed',
          reviewerId: provenance.authorId,
          reviewedAt: now,
          contentDigest: await fingerprintCatalogReviewContent(entity),
        },
      }],
    };
    const result = await buildCatalogRelease(changed, await optionsFor(changed, provenance.authorId));
    expect(result).toMatchObject({ status: 'rejected', reason: 'reviewer-is-author' });
  });
});

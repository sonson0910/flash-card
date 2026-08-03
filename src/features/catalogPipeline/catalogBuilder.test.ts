import { describe, expect, it } from 'vitest';
import { createLexemeId, createTrackMembershipId } from '../multilingual/lexemeIdentity';
import type { LexemeV3, TrackMembershipV3 } from '../multilingual/schemaV3';
import type {
  CatalogCandidateProvenanceV1,
  CatalogSourceBundleV1,
} from './catalogContracts';
import {
  buildCatalogRelease,
  canonicalCatalogJson,
  fingerprintCatalogEntity,
  sha256Hex,
} from './catalogBuilder';

const now = '2026-08-03T10:00:00.000Z';

const provenance: CatalogCandidateProvenanceV1 = {
  schemaVersion: 1,
  sourceRef: 'editorial-team',
  sourceUrl: null,
  licenseId: 'CC0-1.0',
  attribution: 'LingoFlash editorial team',
  authorId: 'author-1',
  origin: 'human-authored',
  publishability: 'publishable',
};

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
      reviewer: 'reviewer-1',
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
        reviewerId: 'reviewer-1',
        reviewedAt: now,
        contentDigest: await fingerprintCatalogEntity(entity),
      },
    }))),
    memberships: await Promise.all(memberships.map(async entity => ({
      entity,
      provenance,
      review: {
        status: 'reviewed' as const,
        reviewerId: 'reviewer-1',
        reviewedAt: now,
        contentDigest: await fingerprintCatalogEntity(entity),
      },
    }))),
  };
}

const options = {
  releaseId: 'english-pilot-0001',
  sequence: 1,
  previousReleaseId: null,
  createdAt: now,
} as const;

describe('buildCatalogRelease', () => {
  it('rejects malformed runtime input at the strict seam instead of throwing', async () => {
    await expect(buildCatalogRelease(
      null as unknown as CatalogSourceBundleV1,
      options,
    )).resolves.toEqual({ status: 'rejected', reason: 'invalid-source' });
  });

  it('builds exact immutable manifest counts and content hashes', async () => {
    const result = await buildCatalogRelease(await bundle(), options);
    expect(result.status).toBe('built');
    if (result.status !== 'built') return;
    expect(result.artifact.manifest).toMatchObject({
      catalogId: 'english-pilot',
      releaseId: options.releaseId,
      sequence: 1,
      previousReleaseId: null,
      counts: { lexemes: 1, memberships: 1, chunks: 1 },
    });
    const [chunk] = result.artifact.chunks;
    expect(chunk.descriptor.sha256).toBe(await sha256Hex(chunk.bytes));
    expect(chunk.descriptor.byteLength).toBe(chunk.bytes.byteLength);
    expect(new TextDecoder().decode(result.artifact.manifestBytes))
      .toBe(canonicalCatalogJson(result.artifact.manifest));
  });

  it('produces byte-identical output regardless of accepted source ordering', async () => {
    const source = await bundle(3);
    const reordered = {
      ...source,
      lexemes: [...source.lexemes].reverse(),
      memberships: [...source.memberships].reverse(),
    };
    const first = await buildCatalogRelease(source, options);
    const second = await buildCatalogRelease(reordered, options);
    expect(first.status).toBe('built');
    expect(second.status).toBe('built');
    if (first.status !== 'built' || second.status !== 'built') return;
    expect([...first.artifact.manifestBytes]).toEqual([...second.artifact.manifestBytes]);
    expect(first.artifact.chunks.map(chunk => [...chunk.bytes]))
      .toEqual(second.artifact.chunks.map(chunk => [...chunk.bytes]));
  });

  it('chunks at no more than 100 memberships and 512 KiB each', async () => {
    const result = await buildCatalogRelease(await bundle(101), options);
    expect(result.status).toBe('built');
    if (result.status !== 'built') return;
    expect(result.artifact.chunks).toHaveLength(2);
    expect(result.artifact.chunks.every(chunk => chunk.payload.memberships.length <= 100)).toBe(true);
    expect(result.artifact.chunks.every(chunk => chunk.payload.memberships.length > 0)).toBe(true);
    expect(result.artifact.chunks.every(chunk => chunk.bytes.byteLength <= 512 * 1024)).toBe(true);
  });

  it('rejects unreferenced lexemes instead of emitting delivery-incompatible empty chunks', async () => {
    const source = await bundle();
    const result = await buildCatalogRelease({ ...source, memberships: [] }, options);
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
      const result = await buildCatalogRelease({
        ...source,
        lexemes: [{
          ...source.lexemes[0],
          entity,
          review: {
            status: 'reviewed',
            reviewerId: 'reviewer-1',
            reviewedAt: now,
            contentDigest: await fingerprintCatalogEntity(entity),
          },
        }],
      }, options);
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
    const result = await buildCatalogRelease(await source(), options);
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
    expect((await buildCatalogRelease(draft, options)).status).toBe('rejected');
  });

  it('uses catalogEditorial license policy at the publication gate', async () => {
    const source = await bundle();
    const entity = {
      ...source.lexemes[0].entity,
      provenance: { ...source.lexemes[0].entity.provenance, license: 'NOASSERTION' },
    };
    const result = await buildCatalogRelease({
      ...source,
      lexemes: [{
        ...source.lexemes[0],
        entity,
        provenance: { ...source.lexemes[0].provenance, licenseId: 'NOASSERTION' },
        review: {
          status: 'reviewed',
          reviewerId: 'reviewer-1',
          reviewedAt: now,
          contentDigest: await fingerprintCatalogEntity(entity),
        },
      }],
    }, options);
    expect(result).toMatchObject({ status: 'rejected', reason: 'license-not-publishable' });
  });

  it('rejects a content-bound review when reviewer and author are the same identity', async () => {
    const source = await bundle();
    const entity = {
      ...source.lexemes[0].entity,
      provenance: { ...source.lexemes[0].entity.provenance, reviewer: provenance.authorId },
    };
    const result = await buildCatalogRelease({
      ...source,
      lexemes: [{
        ...source.lexemes[0],
        entity,
        review: {
          status: 'reviewed',
          reviewerId: provenance.authorId,
          reviewedAt: now,
          contentDigest: await fingerprintCatalogEntity(entity),
        },
      }],
    }, options);
    expect(result).toMatchObject({ status: 'rejected', reason: 'reviewer-is-author' });
  });
});

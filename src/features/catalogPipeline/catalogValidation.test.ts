import { describe, expect, it } from 'vitest';
import { createLexemeId, createTrackMembershipId } from '../multilingual/lexemeIdentity';
import { SCHEMA_V3_LIMITS, type LexemeV3, type TrackMembershipV3 } from '../multilingual/schemaV3';
import {
  CATALOG_PIPELINE_LIMITS,
  type CatalogCandidateProvenanceV1,
  type CatalogContentChunkV1,
  type CatalogContentRightsV1,
  type CatalogMediaClipV1,
  type CatalogReviewEvidenceV1,
} from './catalogContracts';
import {
  CatalogValidationError,
  assertCatalogContentReferences,
  parseCatalogCandidateProvenanceV1,
  parseCatalogChunkV1,
  parseCatalogContentChunkV1,
  parseCatalogContentRightsV1,
  parseCatalogMediaClipV1,
  parseCatalogReleaseManifestV1,
  parseCatalogSourceAssetRegistryV1,
  parseCatalogSourceManifestV1,
  parseCatalogTranscriptCueV1,
  validateCatalogSourceBundle,
} from './catalogValidation';

const now = '2026-08-03T00:00:00.000Z';

const provenance: CatalogCandidateProvenanceV1 = {
  schemaVersion: 1,
  sourceRef: 'sonflash-editorial-draft',
  sourceUrl: null,
  licenseId: 'NOASSERTION',
  rightsEvidenceId: null,
  attribution: 'AI-assisted draft; rights not verified.',
  authorId: 'catalog-generator',
  origin: 'ai-assisted',
  generator: { provider: 'google', model: 'gemini-catalog-draft' },
  publishability: 'non-publishable',
};

const review: CatalogReviewEvidenceV1 = { status: 'unreviewed' };

function lexeme(index = 0): LexemeV3 {
  const identity = {
    language: 'en',
    normalizedLemma: `word ${index}`,
    partOfSpeech: 'noun',
    senseKey: 'primary',
  };
  return {
    schemaVersion: 3,
    id: createLexemeId(identity),
    ...identity,
    lemma: `Word ${index}`,
    definitions: [{ language: 'vi', text: `Nghia ${index}` }],
    phonetics: [],
    examples: [],
    collocations: [],
    wordFamily: [],
    media: { audioUrl: null, imageUrl: null },
    compatibility: {
      legacyPartOfSpeech: 'noun', translation: `Nghia ${index}`, explanation: '',
      explanationTranslation: '', emoji: '', exampleSentence: '', exampleTranslation: '',
      synonyms: [], antonyms: [], register: '', commonMistake: '',
    },
    provenance: {
      source: provenance.sourceRef,
      license: provenance.licenseId,
      reviewer: 'unreviewed',
      editorialStatus: 'draft',
    },
    contentVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function membership(item: LexemeV3, trackId = 'general', rank = 0): TrackMembershipV3 {
  const identity = { trackId, lexemeId: item.id };
  return {
    schemaVersion: 3,
    id: createTrackMembershipId(identity),
    ...identity,
    tier: 'foundation',
    cefrLevel: 'A1',
    topic: 'basics',
    legacyCategory: trackId === 'general' ? 'General' : trackId.toUpperCase(),
    skills: ['reading'],
    rank,
    lessonGroup: 'pilot-1',
    editorialStatus: 'draft',
    contentVersion: 1,
  };
}

const sourceManifest = () => ({
  manifestVersion: 1,
  catalogId: 'english-pilot',
  contentLanguage: 'en',
  supportLanguages: ['vi'],
  lexemeFiles: ['lexemes/core.jsonl'],
  membershipFiles: ['memberships/general.jsonl'],
});

const sourceAssetRegistry = () => ({
  registryVersion: 1,
  assets: [{
    sourceRef: 'sonflash-editorial-draft',
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

const contentRights = (): CatalogContentRightsV1 => ({
  schemaVersion: 1,
  registryVersion: 1,
  sourceRef: 'sonflash-editorial-draft',
  sourceAssetSha256: 'a'.repeat(64),
});

const contentChunk = (): CatalogContentChunkV1 => ({
  schemaVersion: 1,
  id: 'book-a-room',
  language: 'en',
  kind: 'phrase',
  text: 'book a room',
  lexemeIds: ['book'],
  contentRights: contentRights(),
});

const mediaClip = (): CatalogMediaClipV1 => ({
  schemaVersion: 1,
  id: 'hotel-clip',
  language: 'en',
  mediaKind: 'audio',
  path: 'media/hotel-clip.mp3',
  mimeType: 'audio/mpeg',
  byteLength: 4_096,
  durationMs: 5_000,
  contentRights: contentRights(),
  transcriptCues: [{
    schemaVersion: 1,
    id: 'hotel-clip-cue-1',
    clipId: 'hotel-clip',
    language: 'en',
    startMs: 0,
    endMs: 2_000,
    text: 'I would like to book a room.',
  }],
});

describe('catalog contract parsers', () => {
  it('parses rights-bound phrase and sentence-level audio contracts', () => {
    expect(parseCatalogContentRightsV1(contentRights())).toEqual(contentRights());
    expect(parseCatalogContentChunkV1(contentChunk())).toEqual(contentChunk());
    expect(parseCatalogTranscriptCueV1(mediaClip().transcriptCues[0]))
      .toEqual(mediaClip().transcriptCues[0]);
    expect(parseCatalogMediaClipV1(mediaClip())).toEqual(mediaClip());
  });

  it('rejects unknown fields and malformed content rights', () => {
    expect(() => parseCatalogContentRightsV1({
      ...contentRights(), unexpected: true,
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogContentRightsV1({
      ...contentRights(), sourceAssetSha256: 'not-a-digest',
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogContentRightsV1({
      ...contentRights(), sourceRef: 'Not Canonical',
    })).toThrow(CatalogValidationError);
  });

  it.each([
    ['content chunk', parseCatalogContentChunkV1, { ...contentChunk(), unexpected: true }],
    ['transcript cue', parseCatalogTranscriptCueV1, { ...mediaClip().transcriptCues[0], unexpected: true }],
    ['media clip', parseCatalogMediaClipV1, { ...mediaClip(), unexpected: true }],
  ])('rejects unknown fields in a %s', (_label, parse, value) => {
    expect(() => parse(value)).toThrow(CatalogValidationError);
  });

  it('bounds chunk text and requires useful lexeme references', () => {
    expect(() => parseCatalogContentChunkV1({ ...contentChunk(), text: '' }))
      .toThrow(CatalogValidationError);
    expect(() => parseCatalogContentChunkV1({
      ...contentChunk(), text: 'x'.repeat(CATALOG_PIPELINE_LIMITS.maximumContentChunkTextLength + 1),
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogContentChunkV1({
      ...contentChunk(), lexemeIds: [],
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogContentChunkV1({
      ...contentChunk(),
      lexemeIds: Array.from(
        { length: CATALOG_PIPELINE_LIMITS.maximumContentChunkLexemeReferences + 1 },
        (_, index) => `lexeme-${index}`,
      ),
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogContentChunkV1({
      ...contentChunk(), lexemeIds: ['x'.repeat(CATALOG_PIPELINE_LIMITS.maximumIdentifierLength + 1)],
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogContentChunkV1({
      ...contentChunk(), lexemeIds: ['book', 'book'],
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogContentChunkV1({
      ...contentChunk(), kind: 'sentence',
    })).toThrow(CatalogValidationError);
  });

  it('rejects sparse lexeme reference arrays instead of treating holes as values', () => {
    const sparseLexemeIds = new Array(1);
    expect(() => parseCatalogContentChunkV1({
      ...contentChunk(), lexemeIds: sparseLexemeIds,
    })).toThrow(CatalogValidationError);
  });

  it('rejects media paths, MIME types, byte sizes, and durations outside the contract', () => {
    expect(() => parseCatalogMediaClipV1({ ...mediaClip(), path: '../private.mp3' }))
      .toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({ ...mediaClip(), path: 'https://example.com/clip.mp3' }))
      .toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({
      ...mediaClip(), path: 'ht\ntps:/\t/attacker.example/clip.mp3',
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({ ...mediaClip(), mimeType: 'video/mp4' }))
      .toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({ ...mediaClip(), byteLength: 0 }))
      .toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({
      ...mediaClip(), byteLength: CATALOG_PIPELINE_LIMITS.maximumMediaClipBytes + 1,
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({ ...mediaClip(), durationMs: 0 }))
      .toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({
      ...mediaClip(), durationMs: CATALOG_PIPELINE_LIMITS.maximumMediaClipDurationMs + 1,
    })).toThrow(CatalogValidationError);
  });

  it('rejects cues that do not match the clip or its ordered duration', () => {
    const clip = mediaClip();
    expect(() => parseCatalogTranscriptCueV1({
      ...clip.transcriptCues[0], startMs: -1,
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogTranscriptCueV1({
      ...clip.transcriptCues[0], startMs: 0.5,
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogTranscriptCueV1({
      ...clip.transcriptCues[0],
      text: 'x'.repeat(CATALOG_PIPELINE_LIMITS.maximumTranscriptCueTextLength + 1),
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({
      ...clip,
      transcriptCues: [{ ...clip.transcriptCues[0], clipId: 'other-clip' }],
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({
      ...clip,
      transcriptCues: [{ ...clip.transcriptCues[0], language: 'vi' }],
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({
      ...clip,
      transcriptCues: [
        clip.transcriptCues[0],
        { ...clip.transcriptCues[0], id: 'hotel-clip-cue-2', startMs: 1_500, endMs: 3_000 },
      ],
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({
      ...clip,
      transcriptCues: [{ ...clip.transcriptCues[0], startMs: 4_500, endMs: 5_001 }],
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({
      ...clip,
      transcriptCues: [{ ...clip.transcriptCues[0], endMs: 1_000, startMs: 1_000 }],
    })).toThrow(CatalogValidationError);
  });

  it('bounds transcript cue count and rejects duplicate cue IDs', () => {
    const clip = mediaClip();
    expect(() => parseCatalogMediaClipV1({
      ...clip,
      transcriptCues: Array.from(
        { length: CATALOG_PIPELINE_LIMITS.maximumTranscriptCues + 1 },
        (_, index) => ({ ...clip.transcriptCues[0], id: `cue-${index}` }),
      ),
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogMediaClipV1({
      ...clip,
      transcriptCues: [
        clip.transcriptCues[0],
        { ...clip.transcriptCues[0], startMs: 2_000, endMs: 3_000 },
      ],
    })).toThrow(CatalogValidationError);
  });

  it('rejects sparse transcript cue arrays instead of silently dropping cues', () => {
    const sparseTranscriptCues = new Array(1);
    expect(() => parseCatalogMediaClipV1({
      ...mediaClip(), transcriptCues: sparseTranscriptCues,
    })).toThrow(CatalogValidationError);
  });

  it('requires content references to resolve against trusted registry and known lexemes', () => {
    const registry = parseCatalogSourceAssetRegistryV1(sourceAssetRegistry());
    const chunk = parseCatalogContentChunkV1(contentChunk());
    const clip = parseCatalogMediaClipV1(mediaClip());
    expect(() => assertCatalogContentReferences(chunk, registry, new Set(['book'])))
      .not.toThrow();
    expect(() => assertCatalogContentReferences(clip, registry)).not.toThrow();
    expect(() => assertCatalogContentReferences(chunk, registry, new Set(['other'])))
      .toThrow(/lexeme/i);
    expect(() => assertCatalogContentReferences({
      ...chunk,
      contentRights: { ...chunk.contentRights, sourceRef: 'missing-asset' },
    }, registry, new Set(['book']))).toThrow(/sourceRef/i);
    expect(() => assertCatalogContentReferences({
      ...clip,
      contentRights: { ...clip.contentRights, sourceAssetSha256: 'b'.repeat(64) },
    }, registry)).toThrow(/checksum/i);
    expect(() => assertCatalogContentReferences({
      ...clip,
      contentRights: { ...clip.contentRights, registryVersion: 2 } as unknown as CatalogContentRightsV1,
    }, registry)).toThrow(/version/i);
    const missingChecksumRegistry = parseCatalogSourceAssetRegistryV1({
      ...sourceAssetRegistry(),
      assets: [{ ...sourceAssetRegistry().assets[0], sourceAssetSha256: null }],
    });
    expect(() => assertCatalogContentReferences(clip, missingChecksumRegistry))
      .toThrow(/checksum/i);
  });

  it('strictly parses bounded trusted source asset rights', () => {
    expect(parseCatalogSourceAssetRegistryV1(sourceAssetRegistry())).toEqual(sourceAssetRegistry());
    expect(() => parseCatalogSourceAssetRegistryV1({
      ...sourceAssetRegistry(),
      unexpected: true,
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogSourceAssetRegistryV1({
      ...sourceAssetRegistry(),
      assets: [sourceAssetRegistry().assets[0], sourceAssetRegistry().assets[0]],
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogSourceAssetRegistryV1({
      ...sourceAssetRegistry(),
      assets: Array.from(
        { length: CATALOG_PIPELINE_LIMITS.maximumSourceAssetRegistryAssets + 1 },
        (_, index) => ({ ...sourceAssetRegistry().assets[0], sourceRef: `asset-${index}` }),
      ),
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogSourceAssetRegistryV1({
      ...sourceAssetRegistry(),
      assets: [{
        ...sourceAssetRegistry().assets[0],
        sourceRevision: 'x'.repeat(CATALOG_PIPELINE_LIMITS.maximumSourceAssetRegistryBytes),
      }],
    })).toThrow(CatalogValidationError);
  });

  it.each([
    ['checksum', { sourceAssetSha256: 'not-a-digest' }],
    ['url', { sourceUrl: 'javascript:alert(1)' }],
    ['time', { expiresAt: '2026-08-03' }],
    ['country', { territory: ['us', 'US'] }],
    ['revocation time', { revokedAt: '2026-08-03' }],
    ['duplicate country', { territory: ['US', 'US'] }],
  ])('rejects malformed trusted asset %s', (_label, change) => {
    expect(() => parseCatalogSourceAssetRegistryV1({
      ...sourceAssetRegistry(),
      assets: [{ ...sourceAssetRegistry().assets[0], ...change }],
    })).toThrow(CatalogValidationError);
  });

  it('requires every rights field while allowing explicit incomplete-evidence nulls', () => {
    const asset = sourceAssetRegistry().assets[0];
    expect(parseCatalogSourceAssetRegistryV1({
      registryVersion: 1,
      assets: [{
        ...asset,
        rightsEvidenceId: null,
        expiresAt: null,
        sourceRevision: null,
        sourceAssetSha256: null,
        revokedAt: null,
      }],
    }).assets[0]).toMatchObject({ rightsEvidenceId: null, sourceRevision: null });
    const { sourceRevision: _sourceRevision, ...missingRevision } = asset;
    expect(() => parseCatalogSourceAssetRegistryV1({
      registryVersion: 1,
      assets: [missingRevision],
    })).toThrow(CatalogValidationError);
  });

  it('rejects attribution text when attribution is not required', () => {
    expect(() => parseCatalogSourceAssetRegistryV1({
      ...sourceAssetRegistry(),
      assets: [{
        ...sourceAssetRegistry().assets[0],
        attribution: { required: false, text: 'Unused credit' },
      }],
    })).toThrow(CatalogValidationError);
  });

  it('allows more than the support-language count of territory codes', () => {
    const countries = Array.from({ length: CATALOG_PIPELINE_LIMITS.maximumSupportLanguages + 1 }, (_, index) => (
      `${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}`
    ));
    const parsed = parseCatalogSourceAssetRegistryV1({
      ...sourceAssetRegistry(),
      assets: [{ ...sourceAssetRegistry().assets[0], territory: countries }],
    });
    expect(parsed.assets[0].territory).toHaveLength(CATALOG_PIPELINE_LIMITS.maximumSupportLanguages + 1);
  });

  it('rejects territory codes beyond the dedicated bounded limit', () => {
    const countries = Array.from({ length: CATALOG_PIPELINE_LIMITS.maximumTerritoryCodes + 1 }, (_, index) => (
      `${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}`
    ));
    expect(() => parseCatalogSourceAssetRegistryV1({
      ...sourceAssetRegistry(),
      assets: [{ ...sourceAssetRegistry().assets[0], territory: countries }],
    })).toThrow(CatalogValidationError);
  });

  it('canonicalizes bounded territory ordering', () => {
    const asset = sourceAssetRegistry().assets[0];
    const first = parseCatalogSourceAssetRegistryV1({
      registryVersion: 1,
      assets: [{ ...asset, territory: ['US', 'CA'] }],
    });
    const second = parseCatalogSourceAssetRegistryV1({
      registryVersion: 1,
      assets: [{ ...asset, territory: ['CA', 'US'] }],
    });
    expect(first).toEqual(second);
    expect(first.assets[0].territory).toEqual(['CA', 'US']);
  });

  it('strictly parses an explicit bounded source manifest', () => {
    expect(parseCatalogSourceManifestV1(sourceManifest())).toEqual(sourceManifest());
  });

  it.each([
    ['unknown fields', { ...sourceManifest(), unexpected: true }],
    ['path traversal', { ...sourceManifest(), lexemeFiles: ['../private.jsonl'] }],
    ['absolute paths', { ...sourceManifest(), lexemeFiles: ['/tmp/private.jsonl'] }],
    ['URL paths', { ...sourceManifest(), lexemeFiles: ['https://example.com/private.jsonl'] }],
    ['encoded traversal', { ...sourceManifest(), lexemeFiles: ['safe/%2e%2e/private.jsonl'] }],
    ['duplicate files', { ...sourceManifest(), lexemeFiles: ['a.jsonl', 'a.jsonl'] }],
    ['cross-list duplicates', {
      ...sourceManifest(), lexemeFiles: ['shared.jsonl'], membershipFiles: ['shared.jsonl'],
    }],
  ])('rejects %s in a source manifest', (_label, input) => {
    expect(() => parseCatalogSourceManifestV1(input)).toThrow(CatalogValidationError);
  });

  it('strictly parses bounded provenance and rejects unsafe source URLs', () => {
    expect(parseCatalogCandidateProvenanceV1(provenance)).toEqual(provenance);
    expect(parseCatalogCandidateProvenanceV1({
      ...provenance,
      sourceUrl: 'https://example.com/source',
    })).toMatchObject({ sourceUrl: 'https://example.com/source' });
    expect(() => parseCatalogCandidateProvenanceV1({
      ...provenance,
      sourceUrl: 'javascript:alert(1)',
    })).toThrow(CatalogValidationError);
  });

  it('strictly parses nullable bounded rights evidence', () => {
    expect(parseCatalogCandidateProvenanceV1({
      ...provenance,
      rightsEvidenceId: 'rights:editorial-contract-2026',
    })).toMatchObject({ rightsEvidenceId: 'rights:editorial-contract-2026' });
    expect(() => parseCatalogCandidateProvenanceV1({
      ...provenance,
      rightsEvidenceId: 'x'.repeat(257),
    })).toThrow(CatalogValidationError);
    const { rightsEvidenceId: _rightsEvidenceId, ...missingEvidenceField } = provenance;
    expect(() => parseCatalogCandidateProvenanceV1(missingEvidenceField))
      .toThrow(CatalogValidationError);
  });

  it('requires bounded provider and model evidence for ai-assisted candidates', () => {
    const { generator: _generator, ...missingGenerator } = provenance;
    expect(() => parseCatalogCandidateProvenanceV1(missingGenerator)).toThrow(CatalogValidationError);
    expect(parseCatalogCandidateProvenanceV1({
      ...provenance,
      generator: { provider: 'google', model: 'gemini-catalog-draft' },
    })).toMatchObject({
      origin: 'ai-assisted',
      generator: { provider: 'google', model: 'gemini-catalog-draft' },
    });
  });

  it('rejects generator metadata on non-AI provenance', () => {
    expect(() => parseCatalogCandidateProvenanceV1({
      ...provenance,
      origin: 'human-authored',
      generator: { provider: 'spoofed', model: 'spoofed' },
    })).toThrow(CatalogValidationError);
  });

  it('bounds source files across both lists and requires both record kinds', () => {
    const paths = Array.from({ length: 51 }, (_, index) => `lexemes/${index}.jsonl`);
    const membershipPaths = Array.from({ length: 50 }, (_, index) => `memberships/${index}.jsonl`);
    expect(() => parseCatalogSourceManifestV1({
      ...sourceManifest(), lexemeFiles: paths, membershipFiles: membershipPaths,
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogSourceManifestV1({
      ...sourceManifest(), lexemeFiles: [],
    })).toThrow(CatalogValidationError);
    expect(() => parseCatalogSourceManifestV1({
      ...sourceManifest(), membershipFiles: [],
    })).toThrow(CatalogValidationError);
  });

  it('parses a bounded immutable release manifest and rejects a malformed hash', () => {
    const manifest = {
      manifestVersion: 1,
      catalogId: 'english-pilot',
      releaseId: 'english-pilot-0001',
      sequence: 1,
      contentLanguage: 'en',
      supportLanguages: ['vi'],
      createdAt: now,
      previousReleaseId: null,
      counts: { lexemes: 1, memberships: 1, chunks: 1, encodedBytes: 100 },
      chunks: [{
        id: 'chunk-0001', ordinal: 0, path: 'english-pilot-0001/chunk-0001.json',
        sha256: 'a'.repeat(64), byteLength: 100, lexemeCount: 1, membershipCount: 1,
        trackIds: ['general'],
      }],
    };
    expect(parseCatalogReleaseManifestV1(manifest)).toEqual(manifest);
    const { catalogId: _catalogId, ...missingCatalogId } = manifest;
    expect(() => parseCatalogReleaseManifestV1(missingCatalogId)).toThrow(CatalogValidationError);
    expect(() => parseCatalogReleaseManifestV1({
      ...manifest,
      chunks: [{ ...manifest.chunks[0], sha256: 'not-a-digest' }],
    })).toThrow(CatalogValidationError);
  });

  it('parses a chunk only when release binding, counts and entity references agree', () => {
    const item = lexeme();
    const relation = membership(item);
    expect(parseCatalogChunkV1({
      formatVersion: 1,
      releaseId: 'english-pilot-0001',
      ordinal: 0,
      lexemes: [item],
      memberships: [relation],
    }, {
      expectedReleaseId: 'english-pilot-0001',
      expectedOrdinal: 0,
      expectedLexemeCount: 1,
      expectedMembershipCount: 1,
    })).toMatchObject({ releaseId: 'english-pilot-0001' });

    expect(() => parseCatalogChunkV1({
      formatVersion: 1,
      releaseId: 'other-release',
      ordinal: 0,
      lexemes: [item],
      memberships: [relation],
    }, {
      expectedReleaseId: 'english-pilot-0001',
      expectedOrdinal: 0,
      expectedLexemeCount: 1,
      expectedMembershipCount: 1,
    })).toThrow(CatalogValidationError);
  });

  it('enforces the approved release and chunk bounds', () => {
    expect(CATALOG_PIPELINE_LIMITS.maximumReleaseMemberships).toBe(10_000);
    expect(CATALOG_PIPELINE_LIMITS.maximumChunks).toBe(100);
    expect(CATALOG_PIPELINE_LIMITS.maximumReleaseBytes).toBe(50 * 1024 * 1024);
    expect(CATALOG_PIPELINE_LIMITS.maximumChunkMemberships).toBe(100);
    expect(CATALOG_PIPELINE_LIMITS.maximumChunkBytes).toBe(512 * 1024);
  });
});

describe('validateCatalogSourceBundle', () => {
  const candidate = (item: LexemeV3) => ({ entity: item, provenance, review });
  const relationCandidate = (item: TrackMembershipV3) => ({ entity: item, provenance, review });

  it('accepts strict candidates and permits one lexeme to be shared across tracks', () => {
    const item = lexeme();
    const result = validateCatalogSourceBundle({
      manifest: sourceManifest(),
      lexemes: [candidate(item)],
      memberships: [
        relationCandidate(membership(item, 'general')),
        relationCandidate(membership(item, 'ielts')),
        relationCandidate(membership(item, 'toeic')),
      ],
    });
    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') expect(result.catalog.memberships).toHaveLength(3);
  });

  it('quarantines a lexeme with more memberships than the runtime reader can load', () => {
    const item = lexeme();
    const memberships = Array.from(
      { length: SCHEMA_V3_LIMITS.memberships + 1 },
      (_, index) => relationCandidate(membership(item, `track-${index}`, index)),
    );

    const result = validateCatalogSourceBundle({
      manifest: sourceManifest(),
      lexemes: [candidate(item)],
      memberships,
    });

    expect(result).toMatchObject({
      status: 'quarantined',
      issues: [expect.objectContaining({
        code: 'invalid-membership',
        path: `memberships.${item.id}`,
      })],
    });
  });

  it('quarantines lexemes outside the manifest content language', () => {
    const item = lexeme();
    const result = validateCatalogSourceBundle({
      manifest: { ...sourceManifest(), contentLanguage: 'vi' },
      lexemes: [candidate(item)],
      memberships: [],
    });
    expect(result).toMatchObject({
      status: 'quarantined',
      issues: [expect.objectContaining({ code: 'lexeme-language-mismatch' })],
    });
  });

  it('quarantines duplicate IDs and canonical identities', () => {
    const item = lexeme();
    const result = validateCatalogSourceBundle({
      manifest: sourceManifest(),
      lexemes: [candidate(item), candidate({ ...item })],
      memberships: [],
    });
    expect(result).toMatchObject({ status: 'quarantined' });
    if (result.status === 'quarantined') {
      expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
        'duplicate-lexeme-id',
        'duplicate-lexeme-identity',
      ]));
    }
  });

  it('quarantines memberships that reference a missing lexeme', () => {
    const absent = lexeme(9);
    const result = validateCatalogSourceBundle({
      manifest: sourceManifest(),
      lexemes: [],
      memberships: [relationCandidate(membership(absent))],
    });
    expect(result).toMatchObject({
      status: 'quarantined',
      issues: [expect.objectContaining({ code: 'missing-lexeme-reference' })],
    });
  });

  it('quarantines malformed candidate records instead of accepting partial data', () => {
    const item = lexeme();
    const result = validateCatalogSourceBundle({
      manifest: sourceManifest(),
      lexemes: [{ ...candidate(item), unexpected: true }],
      memberships: [],
    });
    expect(result).toMatchObject({
      status: 'quarantined',
      issues: [expect.objectContaining({ code: 'invalid-lexeme' })],
    });
  });

  it('enforces exactly 300 memberships in each approved English pilot track', () => {
    const item = lexeme();
    const result = validateCatalogSourceBundle({
      manifest: sourceManifest(),
      lexemes: [candidate(item)],
      memberships: [relationCandidate(membership(item, 'general'))],
    }, { requireEnglishPilotCounts: true });
    expect(result).toMatchObject({ status: 'quarantined' });
    if (result.status === 'quarantined') {
      expect(result.issues.filter(issue => issue.code === 'pilot-count')).toHaveLength(3);
    }
  });

  it('accepts exactly 300 memberships in each English pilot track', () => {
    const lexemes: ReturnType<typeof candidate>[] = [];
    const memberships: ReturnType<typeof relationCandidate>[] = [];
    (['ielts', 'toeic', 'general'] as const).forEach((trackId, trackIndex) => {
      for (let rank = 0; rank < 300; rank += 1) {
        const item = lexeme(trackIndex * 300 + rank);
        lexemes.push(candidate(item));
        memberships.push(relationCandidate(membership(item, trackId, rank)));
      }
    });
    const result = validateCatalogSourceBundle({
      manifest: sourceManifest(),
      lexemes,
      memberships,
    }, { requireEnglishPilotCounts: true });
    expect(result.status).toBe('accepted');
  });
});

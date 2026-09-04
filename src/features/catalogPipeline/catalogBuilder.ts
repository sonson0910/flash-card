import type { LexemeV3, TrackMembershipV3 } from '../multilingual/schemaV3';
import {
  CATALOG_PIPELINE_LIMITS,
  type CatalogChunkDescriptorV1,
  type CatalogChunkV1,
  type CatalogLexemeCandidateV1,
  type CatalogMembershipCandidateV1,
  type CatalogReviewerAuthorityV1,
  type CatalogReleaseManifestV1,
  type CatalogSourceAssetRegistryV1,
  type CatalogSourceBundleV1,
} from './catalogContracts';
import {
  CATALOG_TRUSTED_ARTIFACT_USE,
  evaluateCatalogAssetRights,
  type CatalogAssetRightsRejectionReason,
} from './catalogEditorial';
import {
  parseCatalogSourceAssetRegistryV1,
  parseCatalogReleaseManifestV1,
  validateCatalogSourceBundle,
} from './catalogValidation';

const encoder = new TextEncoder();

const canonicalValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter(key => record[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalValue(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new TypeError('Canonical JSON rejects unsupported values.');
};

export const canonicalCatalogJson = (value: unknown): string => canonicalValue(value);

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

export const fingerprintCatalogEntity = async (
  entity: LexemeV3 | TrackMembershipV3,
): Promise<string> => sha256Hex(encoder.encode(canonicalCatalogJson(entity)));

/** Binds the protected approval to the complete validated source bundle. */
export const fingerprintCatalogSourceBundle = async (
  source: CatalogSourceBundleV1,
): Promise<string> => sha256Hex(encoder.encode(canonicalCatalogJson(source)));

const referencedAssetRights = (
  source: CatalogSourceBundleV1,
  registry: CatalogSourceAssetRegistryV1,
): readonly CatalogSourceAssetRegistryV1['assets'][number][] => {
  const sourceRefs = new Set([
    ...source.lexemes.map(candidate => candidate.provenance.sourceRef),
    ...source.memberships.map(candidate => candidate.provenance.sourceRef),
  ]);
  return registry.assets
    .filter(asset => sourceRefs.has(asset.sourceRef))
    .sort((left, right) => compareCanonical(left.sourceRef, right.sourceRef));
};

export const fingerprintCatalogApproval = async (
  source: CatalogSourceBundleV1,
  registry: CatalogSourceAssetRegistryV1,
): Promise<string> => sha256Hex(encoder.encode(canonicalCatalogJson({
  source: {
    manifest: {
      ...source.manifest,
      supportLanguages: [...source.manifest.supportLanguages].sort(),
      lexemeFiles: [...source.manifest.lexemeFiles].sort(),
      membershipFiles: [...source.manifest.membershipFiles].sort(),
    },
    lexemes: [...source.lexemes].sort((left, right) => compareCanonical(
      left.entity.id,
      right.entity.id,
    )),
    memberships: [...source.memberships].sort((left, right) => compareCanonical(
      left.entity.id,
      right.entity.id,
    )),
  },
  assetRights: referencedAssetRights(source, registry),
  artifactUse: CATALOG_TRUSTED_ARTIFACT_USE,
})));

const reviewContentProjection = (entity: LexemeV3 | TrackMembershipV3): unknown => {
  if ('language' in entity) {
    const {
      reviewer: _reviewer,
      editorialStatus: _editorialStatus,
      ...substantiveProvenance
    } = entity.provenance;
    return { ...entity, provenance: substantiveProvenance };
  }
  const { editorialStatus: _editorialStatus, ...reviewedContent } = entity;
  return reviewedContent;
};

/** Binds reviewed content while excluding only trusted workflow projections. */
export const fingerprintCatalogReviewContent = async (
  entity: LexemeV3 | TrackMembershipV3,
): Promise<string> => sha256Hex(encoder.encode(canonicalCatalogJson(reviewContentProjection(entity))));

export interface CatalogReleaseBuildOptions {
  readonly sequence: number;
  readonly previousReleaseId: string | null;
  /** Supplied by the operator boundary; never inferred from catalog source JSON. */
  readonly reviewerAuthority: CatalogReviewerAuthorityV1;
  /** Supplied by the trusted operator boundary; never inferred from source JSON. */
  readonly trustedAssetRegistry: CatalogSourceAssetRegistryV1;
}

export interface BuiltCatalogChunk {
  readonly descriptor: CatalogChunkDescriptorV1;
  readonly payload: CatalogChunkV1;
  readonly bytes: Uint8Array;
}

export interface BuiltCatalogRelease {
  readonly manifest: CatalogReleaseManifestV1;
  readonly manifestBytes: Uint8Array;
  readonly chunks: readonly BuiltCatalogChunk[];
}

export type CatalogReleaseBuildResult =
  | { readonly status: 'built'; readonly artifact: BuiltCatalogRelease }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'invalid-source'
        | 'entity-not-published'
        | 'provenance-not-publishable'
        | 'license-not-publishable'
        | 'review-required'
        | 'reviewer-not-trusted'
        | 'approval-invalid-authority'
        | 'approval-digest-mismatch'
        | 'approval-invalid-time'
        | 'approval-stale'
        | 'approval-in-future'
        | 'invalid-rights-registry'
        | CatalogAssetRightsRejectionReason
        | 'reviewer-is-author'
        | 'review-digest-mismatch'
        | 'semantic-quality'
        | 'public-provenance-mismatch'
        | 'release-requires-membership'
        | 'unreferenced-lexeme'
        | 'chunk-too-large'
        | 'too-many-chunks'
        | 'release-too-large'
        | 'invalid-release';
      readonly path?: string;
    };

type CatalogReleaseBuildRejection = Extract<CatalogReleaseBuildResult, { status: 'rejected' }>;

const compareCanonical = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
);

const hasMatchingPublicProvenance = (candidate: CatalogLexemeCandidateV1): boolean => {
  const expectedReviewer = candidate.review.status === 'reviewed'
    ? candidate.review.reviewerId
    : 'unreviewed';
  return candidate.entity.provenance.source === candidate.provenance.sourceRef
    && candidate.entity.provenance.license === candidate.provenance.licenseId
    && candidate.entity.provenance.reviewer === expectedReviewer;
};

const publicationIssue = async (
  candidate: CatalogLexemeCandidateV1 | CatalogMembershipCandidateV1,
  reviewerId: string,
  trustedAssetRegistry: CatalogSourceAssetRegistryV1,
  decisionAt: string,
): Promise<CatalogReleaseBuildRejection | null> => {
  if ('provenance' in candidate.entity && !hasMatchingPublicProvenance(
    candidate as CatalogLexemeCandidateV1,
  )) {
    return { status: 'rejected', reason: 'public-provenance-mismatch' };
  }
  const status = 'provenance' in candidate.entity
    ? candidate.entity.provenance.editorialStatus
    : candidate.entity.editorialStatus;
  if (status !== 'published') return { status: 'rejected', reason: 'entity-not-published' };
  if (candidate.provenance.publishability !== 'publishable') {
    return { status: 'rejected', reason: 'provenance-not-publishable' };
  }
  const rights = evaluateCatalogAssetRights({
    source: candidate.provenance.sourceRef,
    sourceUrl: candidate.provenance.sourceUrl,
    licenseId: candidate.provenance.licenseId,
    rightsEvidenceId: candidate.provenance.rightsEvidenceId,
    attribution: candidate.provenance.attribution,
  }, trustedAssetRegistry, CATALOG_TRUSTED_ARTIFACT_USE, decisionAt);
  if (rights.status === 'rejected') return rights;
  if (candidate.review.status !== 'reviewed') {
    return { status: 'rejected', reason: 'review-required' };
  }
  if (candidate.review.reviewerId !== reviewerId) {
    return { status: 'rejected', reason: 'reviewer-not-trusted' };
  }
  if (candidate.review.reviewerId === candidate.provenance.authorId) {
    return { status: 'rejected', reason: 'reviewer-is-author' };
  }
  const digest = await fingerprintCatalogReviewContent(candidate.entity);
  if (candidate.review.contentDigest !== digest) {
    return { status: 'rejected', reason: 'review-digest-mismatch' };
  }
  return null;
};

const canonicalTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
};

const validReviewerId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= CATALOG_PIPELINE_LIMITS.maximumIdentifierLength
  && /^[A-Za-z0-9](?:[A-Za-z0-9._:@/-]{0,127})?$/.test(value)
);

const validDigest = (value: unknown): value is string => (
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
);

const protectedApprovalIssue = (
  authority: CatalogReviewerAuthorityV1,
): CatalogReleaseBuildRejection | null => {
  if (
    typeof authority !== 'object'
    || authority === null
    || !validReviewerId(authority.reviewerId)
    || !validDigest(authority.approvedDigest)
  ) {
    return { status: 'rejected', reason: 'approval-invalid-authority' };
  }
  const reviewedAt = canonicalTimestamp(authority.reviewedAt);
  const reference = Date.now();
  if (reviewedAt === null) {
    return { status: 'rejected', reason: 'approval-invalid-time' };
  }
  if (reviewedAt - reference > CATALOG_PIPELINE_LIMITS.maximumProtectedReviewFutureSkewMs) {
    return { status: 'rejected', reason: 'approval-in-future' };
  }
  if (reference - reviewedAt > CATALOG_PIPELINE_LIMITS.maximumProtectedReviewAgeMs) {
    return { status: 'rejected', reason: 'approval-stale' };
  }
  return null;
};

const hasGeneratedPlaceholderProse = (candidate: CatalogLexemeCandidateV1): boolean => {
  const prose = [
    candidate.entity.compatibility.explanation,
    candidate.entity.compatibility.explanationTranslation,
    ...candidate.entity.examples.flatMap(example => [
      example.text,
      ...example.translations.map(translation => translation.text),
    ]),
  ];
  return prose.some(value => (
    /\bin the LingoFlash (?:English )?(?:starter|pilot) catalog\b/i.test(value)
    || /^The example shows why .+ can be .+\.$/i.test(value)
    || /^Learners can .+ in a practical situation\.$/i.test(value)
  ));
};

const releaseIdentityProjection = (
  source: CatalogSourceBundleV1,
  options: CatalogReleaseBuildOptions,
  assetRightsDigest: string,
): unknown => ({
  catalog: {
    catalogId: source.manifest.catalogId,
    contentLanguage: source.manifest.contentLanguage,
    supportLanguages: [...source.manifest.supportLanguages].sort(),
    lexemes: [...source.lexemes].sort((left, right) => compareCanonical(
      left.entity.id,
      right.entity.id,
    )),
    memberships: [...source.memberships].sort((left, right) => compareCanonical(
      left.entity.id,
      right.entity.id,
    )),
  },
  lineage: {
    sequence: options.sequence,
    previousReleaseId: options.previousReleaseId,
    createdAt: options.reviewerAuthority.reviewedAt,
  },
  assetRightsDigest,
});

export const deriveCatalogReleaseId = async (
  source: CatalogSourceBundleV1,
  options: CatalogReleaseBuildOptions,
): Promise<string> => {
  const assetRightsDigest = await fingerprintCatalogApproval(source, options.trustedAssetRegistry);
  const digest = await sha256Hex(encoder.encode(canonicalCatalogJson(
    releaseIdentityProjection(source, options, assetRightsDigest),
  )));
  return `r-${digest.slice(0, 24)}`;
};

const encodeChunk = (payload: CatalogChunkV1): Uint8Array => (
  encoder.encode(canonicalCatalogJson(payload))
);

interface MutableChunk {
  lexemes: LexemeV3[];
  memberships: TrackMembershipV3[];
}

export async function buildCatalogRelease(
  source: CatalogSourceBundleV1,
  options: CatalogReleaseBuildOptions,
): Promise<CatalogReleaseBuildResult> {
  let trustedAssetRegistry: CatalogSourceAssetRegistryV1;
  try {
    trustedAssetRegistry = parseCatalogSourceAssetRegistryV1(options.trustedAssetRegistry);
  } catch {
    return { status: 'rejected', reason: 'invalid-rights-registry' };
  }
  const validation = validateCatalogSourceBundle(source);
  if (validation.status !== 'accepted') {
    const projectionIssue = validation.issues.find(issue => (
      issue.message.includes('does not match candidate sourceRef')
      || issue.message.includes('does not match candidate licenseId')
      || issue.message.includes('does not match review evidence')
    ));
    return projectionIssue === undefined
      ? { status: 'rejected', reason: 'invalid-source' }
      : {
          status: 'rejected',
          reason: 'public-provenance-mismatch',
          path: projectionIssue.path,
        };
  }
  const catalog = validation.catalog;
  const approvalDigest = await fingerprintCatalogApproval(catalog, trustedAssetRegistry);
  const approvalIssue = protectedApprovalIssue(options.reviewerAuthority);
  if (approvalIssue !== null) return approvalIssue;
  if (approvalDigest !== options.reviewerAuthority.approvedDigest) {
    return { status: 'rejected', reason: 'approval-digest-mismatch' };
  }
  const releaseId = await deriveCatalogReleaseId(catalog, options);
  for (const [kind, candidates] of [
    ['lexemes', catalog.lexemes],
    ['memberships', catalog.memberships],
  ] as const) {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const issue = await publicationIssue(
        candidate,
        options.reviewerAuthority.reviewerId,
        trustedAssetRegistry,
        options.reviewerAuthority.reviewedAt,
      );
      if (issue !== null) return { ...issue, path: `${kind}[${index}]` };
      if (kind === 'lexemes' && hasGeneratedPlaceholderProse(candidate as CatalogLexemeCandidateV1)) {
        return { status: 'rejected', reason: 'semantic-quality', path: `${kind}[${index}]` };
      }
    }
  }

  const sortedLexemes = catalog.lexemes.map(candidate => candidate.entity)
    .sort((left, right) => compareCanonical(left.id, right.id));
  const sortedMemberships = catalog.memberships.map(candidate => candidate.entity)
    .sort((left, right) => compareCanonical(left.id, right.id));
  const lexemesById = new Map(sortedLexemes.map(entity => [entity.id, entity]));
  const referencedLexemes = new Set(sortedMemberships.map(entity => entity.lexemeId));
  if (sortedLexemes.some(entity => !referencedLexemes.has(entity.id))) {
    return { status: 'rejected', reason: 'unreferenced-lexeme' };
  }
  if (sortedMemberships.length === 0) {
    return { status: 'rejected', reason: 'release-requires-membership' };
  }
  const emittedLexemes = new Set<string>();
  const chunks: MutableChunk[] = [];
  let current: MutableChunk = { lexemes: [], memberships: [] };

  const payloadFor = (chunk: MutableChunk, ordinal: number): CatalogChunkV1 => ({
    formatVersion: 1,
    releaseId,
    ordinal,
    lexemes: chunk.lexemes,
    memberships: chunk.memberships,
  });
  const flush = (): void => {
    if (current.lexemes.length === 0 && current.memberships.length === 0) return;
    chunks.push(current);
    current = { lexemes: [], memberships: [] };
  };
  const append = (newLexemes: readonly LexemeV3[], relation?: TrackMembershipV3): boolean => {
    const candidate: MutableChunk = {
      lexemes: [...current.lexemes, ...newLexemes],
      memberships: relation ? [...current.memberships, relation] : current.memberships,
    };
    const tooManyMemberships = candidate.memberships.length
      > CATALOG_PIPELINE_LIMITS.maximumChunkMemberships;
    const tooManyBytes = encodeChunk(payloadFor(candidate, chunks.length)).byteLength
      > CATALOG_PIPELINE_LIMITS.maximumChunkBytes;
    if (!tooManyMemberships && !tooManyBytes) {
      current = candidate;
      return true;
    }
    return false;
  };

  for (const relation of sortedMemberships) {
    const referenced = lexemesById.get(relation.lexemeId);
    if (!referenced) return { status: 'rejected', reason: 'invalid-source' };
    const newLexemes = emittedLexemes.has(referenced.id) ? [] : [referenced];
    if (!append(newLexemes, relation)) {
      flush();
      if (!append(newLexemes, relation)) return { status: 'rejected', reason: 'chunk-too-large' };
    }
    emittedLexemes.add(referenced.id);
  }
  flush();
  if (chunks.length > CATALOG_PIPELINE_LIMITS.maximumChunks) {
    return { status: 'rejected', reason: 'too-many-chunks' };
  }

  const builtChunks: BuiltCatalogChunk[] = [];
  for (let ordinal = 0; ordinal < chunks.length; ordinal += 1) {
    const payload = payloadFor(chunks[ordinal], ordinal);
    const bytes = encodeChunk(payload);
    const id = `chunk-${String(ordinal).padStart(4, '0')}`;
    const descriptor: CatalogChunkDescriptorV1 = {
      id,
      ordinal,
      path: `${catalog.manifest.catalogId}/${releaseId}/${id}.json`,
      sha256: await sha256Hex(bytes),
      byteLength: bytes.byteLength,
      lexemeCount: payload.lexemes.length,
      membershipCount: payload.memberships.length,
      trackIds: [...new Set(payload.memberships.map(item => item.trackId))].sort(),
    };
    builtChunks.push({ descriptor, payload, bytes });
  }
  const encodedBytes = builtChunks.reduce((total, chunk) => total + chunk.bytes.byteLength, 0);
  if (encodedBytes > CATALOG_PIPELINE_LIMITS.maximumReleaseBytes) {
    return { status: 'rejected', reason: 'release-too-large' };
  }
  const manifestValue: CatalogReleaseManifestV1 = {
    manifestVersion: 1,
    catalogId: catalog.manifest.catalogId,
    releaseId,
    sequence: options.sequence,
    contentLanguage: catalog.manifest.contentLanguage,
    supportLanguages: [...catalog.manifest.supportLanguages].sort(),
    createdAt: options.reviewerAuthority.reviewedAt,
    previousReleaseId: options.previousReleaseId,
    counts: {
      lexemes: sortedLexemes.length,
      memberships: sortedMemberships.length,
      chunks: builtChunks.length,
      encodedBytes,
    },
    chunks: builtChunks.map(chunk => chunk.descriptor),
  };
  try {
    const manifest = parseCatalogReleaseManifestV1(manifestValue);
    return {
      status: 'built',
      artifact: {
        manifest,
        manifestBytes: encoder.encode(canonicalCatalogJson(manifest)),
        chunks: builtChunks,
      },
    };
  } catch {
    return { status: 'rejected', reason: 'invalid-release' };
  }
}

import type { LexemeV3, TrackMembershipV3 } from '../multilingual/schemaV3';

export const CATALOG_PIPELINE_LIMITS = Object.freeze({
  maximumSourceFiles: 100,
  maximumLexemes: 10_000,
  maximumReleaseMemberships: 10_000,
  maximumChunks: 100,
  maximumReleaseBytes: 50 * 1024 * 1024,
  maximumChunkMemberships: 100,
  maximumChunkBytes: 512 * 1024,
  maximumPathLength: 512,
  maximumIdentifierLength: 128,
  maximumUrlLength: 2_048,
  maximumAttributionLength: 2_048,
  maximumSupportLanguages: 8,
  maximumTrackIdsPerChunk: 32,
  maximumProtectedReviewAgeMs: 24 * 60 * 60 * 1000,
  maximumProtectedReviewFutureSkewMs: 5 * 60 * 1000,
} as const);

export interface CatalogSourceManifestV1 {
  readonly manifestVersion: 1;
  readonly catalogId: string;
  readonly contentLanguage: string;
  readonly supportLanguages: readonly string[];
  readonly lexemeFiles: readonly string[];
  readonly membershipFiles: readonly string[];
}

export type CatalogCandidateOriginV1 = 'human-authored' | 'ai-assisted' | 'imported';
export type CatalogCandidatePublishabilityV1 =
  | 'non-publishable'
  | 'review-required'
  | 'publishable';

export interface CatalogGeneratorEvidenceV1 {
  readonly provider: string;
  readonly model: string;
}

interface CatalogCandidateProvenanceBaseV1 {
  readonly schemaVersion: 1;
  readonly sourceRef: string;
  readonly sourceUrl: string | null;
  readonly licenseId: string;
  readonly rightsEvidenceId: string | null;
  readonly attribution: string;
  readonly authorId: string;
  readonly publishability: CatalogCandidatePublishabilityV1;
}

export type CatalogCandidateProvenanceV1 = CatalogCandidateProvenanceBaseV1 & (
  | {
      readonly origin: 'ai-assisted';
      readonly generator: CatalogGeneratorEvidenceV1;
    }
  | {
      readonly origin: Exclude<CatalogCandidateOriginV1, 'ai-assisted'>;
      readonly generator?: never;
    }
);

export type CatalogReviewEvidenceV1 =
  | { readonly status: 'unreviewed' }
  | {
      readonly status: 'reviewed';
      readonly reviewerId: string;
      readonly reviewedAt: string;
      readonly contentDigest: string;
    };

export interface CatalogLexemeCandidateV1 {
  readonly entity: LexemeV3;
  readonly provenance: CatalogCandidateProvenanceV1;
  readonly review: CatalogReviewEvidenceV1;
}

export interface CatalogMembershipCandidateV1 {
  readonly entity: TrackMembershipV3;
  readonly provenance: CatalogCandidateProvenanceV1;
  readonly review: CatalogReviewEvidenceV1;
}

export interface CatalogSourceBundleV1 {
  readonly manifest: CatalogSourceManifestV1;
  readonly lexemes: readonly CatalogLexemeCandidateV1[];
  readonly memberships: readonly CatalogMembershipCandidateV1[];
}

/** Protected operator approval; candidate source data cannot supply this authority. */
export interface CatalogReviewerAuthorityV1 {
  readonly reviewerId: string;
  readonly approvedDigest: string;
  readonly reviewedAt: string;
}

export interface CatalogChunkDescriptorV1 {
  readonly id: string;
  readonly ordinal: number;
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly lexemeCount: number;
  readonly membershipCount: number;
  readonly trackIds: readonly string[];
}

export interface CatalogReleaseCountsV1 {
  readonly lexemes: number;
  readonly memberships: number;
  readonly chunks: number;
  readonly encodedBytes: number;
}

export interface CatalogReleaseManifestV1 {
  readonly manifestVersion: 1;
  readonly catalogId: string;
  readonly releaseId: string;
  readonly sequence: number;
  readonly contentLanguage: string;
  readonly supportLanguages: readonly string[];
  readonly createdAt: string;
  readonly previousReleaseId: string | null;
  readonly counts: CatalogReleaseCountsV1;
  readonly chunks: readonly CatalogChunkDescriptorV1[];
}

export interface CatalogChunkV1 {
  readonly formatVersion: 1;
  readonly releaseId: string;
  readonly ordinal: number;
  readonly lexemes: readonly LexemeV3[];
  readonly memberships: readonly TrackMembershipV3[];
}

export type CatalogIssueCode =
  | 'invalid-manifest'
  | 'invalid-lexeme'
  | 'invalid-membership'
  | 'duplicate-lexeme-id'
  | 'duplicate-lexeme-identity'
  | 'duplicate-membership-id'
  | 'duplicate-membership-identity'
  | 'missing-lexeme-reference'
  | 'lexeme-language-mismatch'
  | 'pilot-count';

export interface CatalogIssue {
  readonly code: CatalogIssueCode;
  readonly path: string;
  readonly message: string;
}

export type CatalogValidationResult =
  | { readonly status: 'accepted'; readonly catalog: CatalogSourceBundleV1 }
  | { readonly status: 'quarantined'; readonly issues: readonly CatalogIssue[] };

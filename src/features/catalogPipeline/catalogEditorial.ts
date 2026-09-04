import type {
  CatalogArtifactUseV1,
  CatalogSourceAssetRegistryV1,
  CatalogSourceAssetRightsV1,
} from './catalogContracts';
import { parseCatalogSourceAssetRegistryV1 } from './catalogValidation';

export type CatalogEditorialStatus = 'draft' | 'reviewed' | 'published' | 'archived';
export type CatalogOriginKind = 'human-authored' | 'source-adapted' | 'ai-assisted' | 'legacy-migration';
export type EditorialRole = 'reviewer' | 'publisher' | 'archiver';

export interface CatalogGeneratorEvidence {
  readonly provider: string;
  readonly model: string;
}

export interface CatalogProvenanceEvidence {
  readonly originKind: CatalogOriginKind;
  readonly authorId: string;
  readonly source: string;
  readonly sourceUrl?: string | null;
  readonly licenseId: string;
  readonly attribution: string | null;
  readonly rightsEvidenceId: string | null;
  readonly generator: CatalogGeneratorEvidence | null;
}

export interface CatalogReviewEvidence {
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly contentFingerprint: string;
}

export interface CatalogEditorialRecord {
  readonly entityKind: 'lexeme' | 'membership';
  readonly entityId: string;
  readonly contentVersion: number;
  readonly contentFingerprint: string;
  readonly status: CatalogEditorialStatus;
  readonly provenance: CatalogProvenanceEvidence;
  readonly reviewEvidence: CatalogReviewEvidence | null;
}

export interface TrustedEditorialActor {
  /** Must be supplied by the trusted execution context, never source content. */
  readonly id: string;
  readonly roles: readonly EditorialRole[];
}

export interface CatalogAuditEvent {
  readonly eventId: string;
  readonly entityKind: CatalogEditorialRecord['entityKind'];
  readonly entityId: string;
  readonly contentVersion: number;
  readonly contentFingerprint: string;
  readonly from: CatalogEditorialStatus;
  readonly to: CatalogEditorialStatus;
  readonly actorId: string;
  readonly actorRole: EditorialRole;
  readonly occurredAt: string;
  readonly reason: string;
}

export interface EditorialTransitionCommand {
  readonly current: CatalogEditorialRecord;
  readonly to: CatalogEditorialStatus;
  readonly actor: TrustedEditorialActor;
  /** Must be a trusted server timestamp serialized as ISO 8601. */
  readonly occurredAt: string;
  /** Becomes the append-only audit event ID and idempotency key. */
  readonly correlationId: string;
  readonly reason: string;
  /** Supplied by the trusted execution context; never inferred from source content. */
  readonly trustedAssetRegistry?: CatalogSourceAssetRegistryV1;
}

export const CATALOG_TRUSTED_ARTIFACT_USE: CatalogArtifactUseV1 = Object.freeze({
  commercialUse: true,
  derivatives: true,
  rehosting: true,
  territory: 'worldwide',
});

export type CatalogAssetRightsRejectionReason =
  | 'rights-asset-not-found'
  | 'rights-source-url-mismatch'
  | 'rights-license-mismatch'
  | 'rights-basis-not-authoritative'
  | 'rights-evidence-missing'
  | 'rights-evidence-mismatch'
  | 'rights-commercial-use-not-allowed'
  | 'rights-derivatives-not-allowed'
  | 'rights-rehosting-not-allowed'
  | 'rights-attribution-mismatch'
  | 'rights-third-party-fragments-unresolved'
  | 'rights-territory-restricted'
  | 'rights-source-revision-missing'
  | 'rights-source-checksum-missing'
  | 'rights-expired'
  | 'rights-revoked'
  | 'rights-decision-time-invalid';

export type CatalogAssetRightsEvaluation =
  | { readonly status: 'accepted' }
  | { readonly status: 'rejected'; readonly reason: CatalogAssetRightsRejectionReason };

export type CatalogSourceAssetRightsIndex = ReadonlyMap<string, CatalogSourceAssetRightsV1>;

export const indexCatalogSourceAssetRights = (
  registry: CatalogSourceAssetRegistryV1,
): CatalogSourceAssetRightsIndex => new Map(
  registry.assets.map(asset => [asset.sourceRef, asset]),
);

export type EditorialTransitionDecision =
  | {
      readonly status: 'accepted';
      readonly next: CatalogEditorialRecord;
      readonly auditEvent: CatalogAuditEvent;
    }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'transition-not-allowed'
        | 'actor-not-authorized'
        | 'invalid-record'
        | 'invalid-review-evidence'
        | 'invalid-rights-registry'
        | 'reviewer-is-author'
        | CatalogAssetRightsRejectionReason;
    };

const bounded = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= maximum;

const validIsoTimestamp = (value: string): boolean => {
  if (!bounded(value, 64)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const validFingerprint = (value: string): boolean => /^sha256:[0-9a-f]{64}$/.test(value);

const validSourceUrl = (value: string | null | undefined): boolean => {
  if (value === undefined || value === null) return true;
  if (!bounded(value, 2_048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};

const validProvenance = (provenance: CatalogProvenanceEvidence): boolean => {
  if (!bounded(provenance.authorId, 128)
    || !bounded(provenance.source, 256)
    || !bounded(provenance.licenseId, 64)) return false;
  if (!validSourceUrl(provenance.sourceUrl)) return false;
  if (provenance.attribution !== null && !bounded(provenance.attribution, 512)) return false;
  if (provenance.rightsEvidenceId !== null && !bounded(provenance.rightsEvidenceId, 256)) return false;
  if (provenance.originKind === 'ai-assisted') {
    return provenance.generator !== null
      && bounded(provenance.generator.provider, 128)
      && bounded(provenance.generator.model, 128);
  }
  return provenance.generator === null;
};

const unknownLicense = (licenseId: string): boolean => {
  const normalized = licenseId.toUpperCase();
  return normalized === 'NOASSERTION'
    || normalized === 'UNKNOWN'
    || normalized.startsWith('UNKNOWN-')
    || normalized === 'NON-PUBLISHABLE';
};

const canonicalTime = (value: string): number | null => {
  if (!validIsoTimestamp(value)) return null;
  return Date.parse(value);
};

const permissionDenied = (
  state: 'allowed' | 'prohibited' | 'unknown',
  reason: CatalogAssetRightsRejectionReason,
): CatalogAssetRightsEvaluation => state === 'allowed'
  ? { status: 'accepted' }
  : { status: 'rejected', reason };

export const evaluateCatalogAssetRights = (
  claim: {
    readonly source: string;
    readonly sourceUrl?: string | null;
    readonly licenseId: string;
    readonly rightsEvidenceId: string | null;
    readonly attribution: string | null;
  },
  registry: CatalogSourceAssetRightsIndex | null | undefined,
  use: CatalogArtifactUseV1,
  decisionAt: string,
): CatalogAssetRightsEvaluation => {
  const asset = registry?.get(claim.source);
  if (asset === undefined) return { status: 'rejected', reason: 'rights-asset-not-found' };
  const claimSourceUrl = claim.sourceUrl ?? null;
  if (asset.sourceUrl !== claimSourceUrl) {
    return { status: 'rejected', reason: 'rights-source-url-mismatch' };
  }
  if (asset.licenseId !== claim.licenseId) {
    return { status: 'rejected', reason: 'rights-license-mismatch' };
  }
  if (asset.basis === 'unknown' || unknownLicense(asset.licenseId)) {
    return { status: 'rejected', reason: 'rights-basis-not-authoritative' };
  }
  if (asset.rightsEvidenceId === null || claim.rightsEvidenceId === null) {
    return { status: 'rejected', reason: 'rights-evidence-missing' };
  }
  if (asset.rightsEvidenceId !== claim.rightsEvidenceId) {
    return { status: 'rejected', reason: 'rights-evidence-mismatch' };
  }
  const commercial = permissionDenied(asset.commercialUse, 'rights-commercial-use-not-allowed');
  if (use.commercialUse && commercial.status === 'rejected') return commercial;
  const derivatives = permissionDenied(asset.derivatives, 'rights-derivatives-not-allowed');
  if (use.derivatives && derivatives.status === 'rejected') return derivatives;
  const rehosting = permissionDenied(asset.rehosting, 'rights-rehosting-not-allowed');
  if (use.rehosting && rehosting.status === 'rejected') return rehosting;
  if (asset.attribution.required && claim.attribution !== asset.attribution.text) {
    return { status: 'rejected', reason: 'rights-attribution-mismatch' };
  }
  if (!asset.attribution.required
    && asset.attribution.text !== null
    && claim.attribution !== asset.attribution.text) {
    return { status: 'rejected', reason: 'rights-attribution-mismatch' };
  }
  if (asset.thirdPartyFragments === 'unresolved') {
    return { status: 'rejected', reason: 'rights-third-party-fragments-unresolved' };
  }
  if (use.territory === 'worldwide') {
    if (asset.territory !== 'worldwide') {
      return { status: 'rejected', reason: 'rights-territory-restricted' };
    }
  } else if (asset.territory !== 'worldwide') {
    const granted = new Set(asset.territory);
    if (!use.territory.every(country => granted.has(country))) {
      return { status: 'rejected', reason: 'rights-territory-restricted' };
    }
  }
  if (asset.sourceRevision === null) {
    return { status: 'rejected', reason: 'rights-source-revision-missing' };
  }
  if (asset.sourceAssetSha256 === null || !/^[a-f0-9]{64}$/.test(asset.sourceAssetSha256)) {
    return { status: 'rejected', reason: 'rights-source-checksum-missing' };
  }
  const decisionTimestamp = canonicalTime(decisionAt);
  if (decisionTimestamp === null) {
    return { status: 'rejected', reason: 'rights-decision-time-invalid' };
  }
  if (asset.expiresAt !== null) {
    const expiry = canonicalTime(asset.expiresAt);
    if (expiry === null || expiry <= decisionTimestamp) {
      return { status: 'rejected', reason: 'rights-expired' };
    }
  }
  if (asset.revokedAt !== null) {
    const revoked = canonicalTime(asset.revokedAt);
    if (revoked === null || revoked <= decisionTimestamp) {
      return { status: 'rejected', reason: 'rights-revoked' };
    }
  }
  return { status: 'accepted' };
};

const validReviewEvidence = (record: CatalogEditorialRecord): boolean => {
  const review = record.reviewEvidence;
  return review !== null
    && bounded(review.reviewerId, 128)
    && review.reviewerId !== 'unreviewed'
    && validIsoTimestamp(review.reviewedAt)
    && review.contentFingerprint === record.contentFingerprint;
};

const requiredRole = (
  from: CatalogEditorialStatus,
  to: CatalogEditorialStatus,
): EditorialRole | null => {
  if (from === 'draft' && to === 'reviewed') return 'reviewer';
  if (from === 'reviewed' && to === 'draft') return 'reviewer';
  if (from === 'reviewed' && to === 'published') return 'publisher';
  if (from === 'published' && to === 'archived') return 'archiver';
  return null;
};

const validRecord = (record: CatalogEditorialRecord): boolean =>
  bounded(record.entityId, 128)
  && Number.isSafeInteger(record.contentVersion)
  && record.contentVersion >= 1
  && validFingerprint(record.contentFingerprint)
  && validProvenance(record.provenance)
  && (record.status !== 'draft' || record.reviewEvidence === null);

export const decideEditorialTransition = (
  command: EditorialTransitionCommand,
): EditorialTransitionDecision => {
  const role = requiredRole(command.current.status, command.to);
  if (role === null) return { status: 'rejected', reason: 'transition-not-allowed' };
  if (!validRecord(command.current)
    || !bounded(command.actor.id, 128)
    || !bounded(command.correlationId, 128)
    || !bounded(command.reason, 256)
    || !validIsoTimestamp(command.occurredAt)) {
    return { status: 'rejected', reason: 'invalid-record' };
  }
  if (!command.actor.roles.includes(role)) {
    return { status: 'rejected', reason: 'actor-not-authorized' };
  }
  if (command.current.status !== 'draft' && !validReviewEvidence(command.current)) {
    return { status: 'rejected', reason: 'invalid-review-evidence' };
  }
  if (command.current.status === 'draft'
    && command.to === 'reviewed'
    && command.actor.id === command.current.provenance.authorId) {
    return { status: 'rejected', reason: 'reviewer-is-author' };
  }
  if (command.to === 'published') {
    let trustedAssetRegistry: CatalogSourceAssetRegistryV1;
    try {
      trustedAssetRegistry = parseCatalogSourceAssetRegistryV1(command.trustedAssetRegistry);
    } catch {
      return { status: 'rejected', reason: 'invalid-rights-registry' };
    }
    const trustedAssetRights = indexCatalogSourceAssetRights(trustedAssetRegistry);
    const rights = evaluateCatalogAssetRights({
      source: command.current.provenance.source,
      sourceUrl: command.current.provenance.sourceUrl,
      licenseId: command.current.provenance.licenseId,
      rightsEvidenceId: command.current.provenance.rightsEvidenceId,
      attribution: command.current.provenance.attribution,
    }, trustedAssetRights, CATALOG_TRUSTED_ARTIFACT_USE, command.occurredAt);
    if (rights.status === 'rejected') return rights;
  }

  const reviewEvidence: CatalogReviewEvidence | null = command.to === 'reviewed'
    ? {
        reviewerId: command.actor.id,
        reviewedAt: command.occurredAt,
        contentFingerprint: command.current.contentFingerprint,
      }
    : command.to === 'draft' ? null : command.current.reviewEvidence;
  const next: CatalogEditorialRecord = { ...command.current, status: command.to, reviewEvidence };
  const auditEvent: CatalogAuditEvent = {
    eventId: command.correlationId,
    entityKind: command.current.entityKind,
    entityId: command.current.entityId,
    contentVersion: command.current.contentVersion,
    contentFingerprint: command.current.contentFingerprint,
    from: command.current.status,
    to: command.to,
    actorId: command.actor.id,
    actorRole: role,
    occurredAt: command.occurredAt,
    reason: command.reason,
  };
  return { status: 'accepted', next, auditEvent };
};

export type AuditAppendDecision =
  | { readonly status: 'append' }
  | { readonly status: 'unchanged' }
  | { readonly status: 'conflict'; readonly reason: 'event-id-collision' };

export const decideAuditAppend = (
  existing: CatalogAuditEvent | null,
  incoming: CatalogAuditEvent,
): AuditAppendDecision => {
  if (existing === null) return { status: 'append' };
  const keys: readonly (keyof CatalogAuditEvent)[] = [
    'eventId', 'entityKind', 'entityId', 'contentVersion', 'contentFingerprint',
    'from', 'to', 'actorId', 'actorRole', 'occurredAt', 'reason',
  ];
  return keys.every(key => existing[key] === incoming[key])
    ? { status: 'unchanged' }
    : { status: 'conflict', reason: 'event-id-collision' };
};

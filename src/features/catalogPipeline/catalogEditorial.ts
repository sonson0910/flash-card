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
}

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
        | 'reviewer-is-author'
        | 'license-not-publishable';
    };

const PUBLISHABLE_LICENSES = new Set(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'project-authored']);
const ATTRIBUTION_LICENSES = new Set(['CC-BY-4.0', 'CC-BY-SA-4.0']);

const bounded = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= maximum;

const validIsoTimestamp = (value: string): boolean => {
  if (!bounded(value, 64)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const validFingerprint = (value: string): boolean => /^sha256:[0-9a-f]{64}$/.test(value);

export const isLicensePublishable = (evidence: {
  readonly licenseId: string;
  readonly attribution: string | null;
  readonly rightsEvidenceId?: string | null;
}): boolean => {
  if (!PUBLISHABLE_LICENSES.has(evidence.licenseId)) return false;
  if (ATTRIBUTION_LICENSES.has(evidence.licenseId) && !bounded(evidence.attribution, 512)) return false;
  if (evidence.licenseId === 'project-authored' && !bounded(evidence.rightsEvidenceId, 256)) return false;
  return evidence.attribution === null || bounded(evidence.attribution, 512);
};

const validProvenance = (provenance: CatalogProvenanceEvidence): boolean => {
  if (!bounded(provenance.authorId, 128)
    || !bounded(provenance.source, 256)
    || !bounded(provenance.licenseId, 64)) return false;
  if (provenance.attribution !== null && !bounded(provenance.attribution, 512)) return false;
  if (provenance.rightsEvidenceId !== null && !bounded(provenance.rightsEvidenceId, 256)) return false;
  if (provenance.originKind === 'ai-assisted') {
    return provenance.generator !== null
      && bounded(provenance.generator.provider, 128)
      && bounded(provenance.generator.model, 128);
  }
  return provenance.generator === null;
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
    if (!isLicensePublishable(command.current.provenance)) {
      return { status: 'rejected', reason: 'license-not-publishable' };
    }
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

import { fingerprintCatalogReviewContent } from '../catalogPipeline/catalogBuilder';
import type { CatalogSourceBundleV1 } from '../catalogPipeline/catalogContracts';
import { isLicensePublishable } from '../catalogPipeline/catalogEditorial';
import { validateCatalogSourceBundle } from '../catalogPipeline/catalogValidation';

export type ContentReadinessReason =
  | 'entity-not-published'
  | 'provenance-not-publishable'
  | 'license-not-publishable'
  | 'rights-evidence-required'
  | 'review-required'
  | 'reviewer-is-author'
  | 'review-digest-mismatch';

export type ContentReadinessResult =
  | { readonly status: 'quarantined'; readonly issues: readonly unknown[] }
  | {
      readonly status: 'ready' | 'blocked';
      readonly counts: { readonly lexemes: number; readonly memberships: number };
      readonly reasons: readonly ContentReadinessReason[];
    };

export async function assessContentReadiness(value: unknown): Promise<ContentReadinessResult> {
  const validated = validateCatalogSourceBundle(value);
  if (validated.status === 'quarantined') return { status: 'quarantined', issues: validated.issues };
  const catalog: CatalogSourceBundleV1 = validated.catalog;
  const reasons = new Set<ContentReadinessReason>();
  for (const candidate of [...catalog.lexemes, ...catalog.memberships]) {
    const entityStatus = 'provenance' in candidate.entity
      ? candidate.entity.provenance.editorialStatus
      : candidate.entity.editorialStatus;
    if (entityStatus !== 'published') reasons.add('entity-not-published');
    if (candidate.provenance.publishability !== 'publishable') reasons.add('provenance-not-publishable');
    if (candidate.provenance.rightsEvidenceId === null) reasons.add('rights-evidence-required');
    if (!isLicensePublishable({
      licenseId: candidate.provenance.licenseId,
      attribution: candidate.provenance.attribution,
      rightsEvidenceId: candidate.provenance.rightsEvidenceId,
    })) reasons.add('license-not-publishable');
    if (candidate.review.status === 'unreviewed') {
      reasons.add('review-required');
      continue;
    }
    if (candidate.review.reviewerId === candidate.provenance.authorId) reasons.add('reviewer-is-author');
    if (candidate.review.contentDigest !== await fingerprintCatalogReviewContent(candidate.entity)) {
      reasons.add('review-digest-mismatch');
    }
  }
  const ordered = [...reasons].sort();
  return {
    status: ordered.length === 0 ? 'ready' : 'blocked',
    counts: { lexemes: catalog.lexemes.length, memberships: catalog.memberships.length },
    reasons: ordered,
  };
}

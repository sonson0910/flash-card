import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  deriveCatalogReleaseId,
  fingerprintCatalogReviewContent,
  fingerprintCatalogSourceBundle,
} from '../src/features/catalogPipeline/catalogBuilder';
import type {
  CatalogLexemeCandidateV1,
  CatalogMembershipCandidateV1,
  CatalogSourceBundleV1,
} from '../src/features/catalogPipeline/catalogContracts';
import { validateCatalogSourceBundle } from '../src/features/catalogPipeline/catalogValidation';
import { loadCatalogSource } from './catalog-operator';

const DRAFT_MANIFEST = 'catalog/english-paths-draft/source/manifest.json';
const APPROVED_SOURCE = 'catalog/english-paths-approved/source';
const DRAFT_DIGEST = '871ca255da3950bfcef1d8e0277bdc9b2f15b07ecd274c65ec0bdc9d9718426d';
const REVIEWER_ID = 'sonson0910';
const REVIEWED_AT = '2026-09-29T02:33:10.000Z';
const RIGHTS_EVIDENCE_ID = 'owner-approval-2026-09-29-english-paths';

async function main(): Promise<void> {
  const draft = await loadCatalogSource(DRAFT_MANIFEST);
  if (await fingerprintCatalogSourceBundle(draft) !== DRAFT_DIGEST || draft.manifest.manifestVersion !== 2) {
    throw new TypeError('The approved English Paths draft changed; a new editorial approval is required.');
  }

  const approveProvenance = <T extends CatalogLexemeCandidateV1 | CatalogMembershipCandidateV1>(
    candidate: T,
  ) => ({
    ...candidate.provenance,
    licenseId: 'project-authored',
    rightsEvidenceId: RIGHTS_EVIDENCE_ID,
    attribution: 'SonFlash owner-approved AI-assisted English Paths content.',
    publishability: 'publishable' as const,
  });
  const lexemes: CatalogLexemeCandidateV1[] = await Promise.all(draft.lexemes.map(async candidate => {
    const provenance = approveProvenance(candidate);
    const entity = {
      ...candidate.entity,
      provenance: {
        ...candidate.entity.provenance,
        source: provenance.sourceRef,
        license: provenance.licenseId,
        reviewer: REVIEWER_ID,
        editorialStatus: 'published' as const,
      },
    };
    return {
      entity,
      provenance,
      review: {
        status: 'reviewed', reviewerId: REVIEWER_ID, reviewedAt: REVIEWED_AT,
        contentDigest: await fingerprintCatalogReviewContent(entity),
      },
    };
  }));
  const memberships: CatalogMembershipCandidateV1[] = await Promise.all(draft.memberships.map(async candidate => {
    const provenance = approveProvenance(candidate);
    const entity = { ...candidate.entity, editorialStatus: 'published' as const };
    return {
      entity,
      provenance,
      review: {
        status: 'reviewed', reviewerId: REVIEWER_ID, reviewedAt: REVIEWED_AT,
        contentDigest: await fingerprintCatalogReviewContent(entity),
      },
    };
  }));
  const approved: CatalogSourceBundleV1 = {
    manifest: { ...draft.manifest, catalogId: 'english-core' },
    lexemes,
    memberships,
    unitDescriptors: draft.unitDescriptors,
  };
  const result = validateCatalogSourceBundle(approved);
  if (result.status !== 'accepted') {
    throw new TypeError(`Approved English Paths source is invalid: ${JSON.stringify(result.issues)}`);
  }

  await mkdir(APPROVED_SOURCE, { recursive: true });
  await Promise.all([
    writeFile(path.join(APPROVED_SOURCE, 'manifest.json'), `${JSON.stringify(approved.manifest, null, 2)}\n`),
    writeFile(path.join(APPROVED_SOURCE, 'lexemes.jsonl'), `${lexemes.map(item => JSON.stringify(item)).join('\n')}\n`),
    writeFile(path.join(APPROVED_SOURCE, 'memberships.jsonl'), `${memberships.map(item => JSON.stringify(item)).join('\n')}\n`),
    writeFile(path.join(APPROVED_SOURCE, 'unit-descriptors.json'), `${JSON.stringify(approved.unitDescriptors, null, 2)}\n`),
  ]);
  console.log(JSON.stringify({
    status: 'approved-source',
    catalogId: approved.manifest.catalogId,
    lexemes: lexemes.length,
    memberships: memberships.length,
    units: approved.unitDescriptors?.length,
    sourceDigest: await fingerprintCatalogSourceBundle(approved),
    releaseId: await deriveCatalogReleaseId(approved, {
      sequence: 1,
      previousReleaseId: null,
      reviewerAuthority: {
        reviewerId: REVIEWER_ID,
        approvedDigest: await fingerprintCatalogSourceBundle(approved),
        reviewedAt: REVIEWED_AT,
      },
    }),
  }));
}

await main();

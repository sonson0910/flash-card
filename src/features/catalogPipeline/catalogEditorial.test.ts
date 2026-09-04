import { describe, expect, it } from 'vitest';

import {
  CATALOG_TRUSTED_ARTIFACT_USE,
  decideAuditAppend,
  decideEditorialTransition,
  evaluateCatalogAssetRights,
  isLicensePublishable,
  type CatalogEditorialRecord,
  type CatalogEditorialStatus,
  type TrustedEditorialActor,
} from './catalogEditorial';
import type { CatalogSourceAssetRegistryV1 } from './catalogContracts';

const fingerprint = `sha256:${'0'.repeat(64)}`;
const reviewer: TrustedEditorialActor = { id: 'reviewer-1', roles: ['reviewer'] };
const publisher: TrustedEditorialActor = { id: 'publisher-1', roles: ['publisher'] };
const archiver: TrustedEditorialActor = { id: 'archiver-1', roles: ['archiver'] };

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

const record = (
  status: CatalogEditorialStatus,
  overrides: Partial<CatalogEditorialRecord> = {},
): CatalogEditorialRecord => ({
  entityKind: 'lexeme',
  entityId: 'lexeme-en-example',
  contentVersion: 1,
  contentFingerprint: fingerprint,
  status,
  provenance: {
    originKind: 'human-authored',
    authorId: 'author-1',
    source: 'editorial-team',
    licenseId: 'CC0-1.0',
    attribution: null,
    rightsEvidenceId: 'rights:editorial-2026',
    sourceUrl: null,
    generator: null,
  },
  reviewEvidence: status === 'draft' ? null : {
    reviewerId: 'reviewer-1',
    reviewedAt: '2026-08-03T05:00:00.000Z',
    contentFingerprint: fingerprint,
  },
  ...overrides,
});

const actorFor = (from: CatalogEditorialStatus, to: CatalogEditorialStatus): TrustedEditorialActor => {
  if (from === 'draft' && to === 'reviewed') return reviewer;
  if (from === 'reviewed' && to === 'published') return publisher;
  if (from === 'published' && to === 'archived') return archiver;
  return reviewer;
};

describe('catalog editorial policy', () => {
  it('requires a trusted registry record and accepts compatible evidence', () => {
    const compatible = evaluateCatalogAssetRights({
      source: 'editorial-team', sourceUrl: null, licenseId: 'CC0-1.0',
      rightsEvidenceId: 'rights:editorial-2026', attribution: null,
    }, rightsRegistry(), CATALOG_TRUSTED_ARTIFACT_USE, '2026-08-03T06:00:00.000Z');
    const missing = evaluateCatalogAssetRights({
      source: 'missing-source', sourceUrl: null, licenseId: 'CC0-1.0',
      rightsEvidenceId: null, attribution: null,
    }, rightsRegistry(), CATALOG_TRUSTED_ARTIFACT_USE, '2026-08-03T06:00:00.000Z');

    expect(compatible).toEqual({ status: 'accepted' });
    expect(missing).toMatchObject({ status: 'rejected', reason: 'rights-asset-not-found' });
  });

  it.each([
    ['unknown basis', { basis: 'unknown' as const }, {}, 'rights-basis-not-authoritative'],
    ['NOASSERTION license', { licenseId: 'NOASSERTION' }, { licenseId: 'NOASSERTION' }, 'rights-basis-not-authoritative'],
    ['NC commercial use', { commercialUse: 'prohibited' as const }, {}, 'rights-commercial-use-not-allowed'],
    ['ND derivatives', { derivatives: 'prohibited' as const }, {}, 'rights-derivatives-not-allowed'],
    ['no rehosting', { rehosting: 'prohibited' as const }, {}, 'rights-rehosting-not-allowed'],
    ['missing attribution', { attribution: { required: true, text: 'Credit' } }, { attribution: null }, 'rights-attribution-mismatch'],
    ['mismatched attribution', { attribution: { required: true, text: 'Credit' } }, { attribution: 'Other' }, 'rights-attribution-mismatch'],
    ['unresolved fragments', { thirdPartyFragments: 'unresolved' as const }, {}, 'rights-third-party-fragments-unresolved'],
    ['restricted territory', { territory: ['US'] as const }, {}, 'rights-territory-restricted'],
    ['missing source revision', { sourceRevision: null }, {}, 'rights-source-revision-missing'],
    ['missing source checksum', { sourceAssetSha256: null }, {}, 'rights-source-checksum-missing'],
    ['malformed source checksum', { sourceAssetSha256: 'A'.repeat(64) }, {}, 'rights-source-checksum-missing'],
    ['expired evidence', { expiresAt: '2026-08-03T06:00:00.000Z' }, {}, 'rights-expired'],
    ['revoked evidence', { revokedAt: '2026-08-03T05:00:00.000Z' }, {}, 'rights-revoked'],
  ] as const)('fails closed for %s asset rights', (_label, assetChange, claimChange, reason) => {
    const asset = { ...rightsRegistry().assets[0], ...assetChange };
    const claim = {
      source: 'editorial-team', sourceUrl: null, licenseId: 'CC0-1.0',
      rightsEvidenceId: 'rights:editorial-2026', attribution: null,
      ...claimChange,
    };
    expect(evaluateCatalogAssetRights(
      claim,
      { registryVersion: 1, assets: [asset] },
      CATALOG_TRUSTED_ARTIFACT_USE,
      '2026-08-03T06:00:00.000Z',
    )).toMatchObject({ status: 'rejected', reason });
  });

  it('rejects public-domain, contract, and owned claims without evidence', () => {
    for (const basis of ['public-domain', 'contract', 'owned'] as const) {
      const asset = {
        ...rightsRegistry().assets[0], basis, rightsEvidenceId: null,
        licenseId: basis,
      };
      expect(evaluateCatalogAssetRights({
        source: 'editorial-team', sourceUrl: null, licenseId: basis,
        rightsEvidenceId: null, attribution: null,
      }, { registryVersion: 1, assets: [asset] }, CATALOG_TRUSTED_ARTIFACT_USE, '2026-08-03T06:00:00.000Z'))
        .toMatchObject({ status: 'rejected', reason: 'rights-evidence-missing' });
    }
  });

  it('does not authorize publication from a missing trusted registry record', () => {
    const decision = decideEditorialTransition({
      current: record('reviewed'),
      to: 'published',
      actor: publisher,
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: 'missing-rights',
      reason: 'publish',
      trustedAssetRegistry: { registryVersion: 1, assets: [] },
    });
    expect(decision).toMatchObject({ status: 'rejected', reason: 'rights-asset-not-found' });
  });

  it.each([
    ['missing registry', undefined],
    ['wrong registry version', { ...rightsRegistry(), registryVersion: 2 }],
    ['unknown registry field', { ...rightsRegistry(), unexpected: true }],
    ['duplicate registry asset', {
      ...rightsRegistry(), assets: [rightsRegistry().assets[0], rightsRegistry().assets[0]],
    }],
  ] as const)('rejects %s before rights evaluation', (_label, trustedAssetRegistry) => {
    const decision = decideEditorialTransition({
      current: record('reviewed'),
      to: 'published',
      actor: publisher,
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: 'invalid-rights-registry',
      reason: 'publish',
      trustedAssetRegistry: trustedAssetRegistry as CatalogSourceAssetRegistryV1 | undefined,
    });
    expect(decision).toMatchObject({ status: 'rejected', reason: 'invalid-rights-registry' });
  });

  it.each([
    ['CC0-1.0', null, null, true],
    ['CC-BY-4.0', 'Dictionary contributors', null, true],
    ['CC-BY-4.0', null, null, false],
    ['CC-BY-SA-4.0', 'Dictionary contributors', null, true],
    ['project-authored', null, 'rights:editorial-contract', true],
    ['project-authored', null, null, false],
    ['non-publishable', null, null, false],
    ['NOASSERTION', null, null, false],
    ['unknown-license', 'Someone', null, false],
  ])('evaluates license %s with attribution %s', (licenseId, attribution, rightsEvidenceId, expected) => {
    expect(isLicensePublishable({ licenseId, attribution, rightsEvidenceId })).toBe(expected);
  });

  it.each([
    ['draft', 'draft', false],
    ['draft', 'reviewed', true],
    ['draft', 'published', false],
    ['draft', 'archived', false],
    ['reviewed', 'draft', true],
    ['reviewed', 'reviewed', false],
    ['reviewed', 'published', true],
    ['reviewed', 'archived', false],
    ['published', 'draft', false],
    ['published', 'reviewed', false],
    ['published', 'published', false],
    ['published', 'archived', true],
    ['archived', 'draft', false],
    ['archived', 'reviewed', false],
    ['archived', 'published', false],
    ['archived', 'archived', false],
  ] as const)('enforces transition %s -> %s', (from, to, accepted) => {
    const decision = decideEditorialTransition({
      current: record(from),
      to,
      actor: actorFor(from, to),
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: `transition-${from}-${to}`,
      reason: 'editorial-review',
      ...(to === 'published' ? { trustedAssetRegistry: rightsRegistry() } : {}),
    });

    expect(decision.status === 'accepted').toBe(accepted);
  });

  it('binds trusted reviewer identity and content fingerprint to review evidence and audit', () => {
    const decision = decideEditorialTransition({
      current: record('draft'),
      to: 'reviewed',
      actor: reviewer,
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: 'review-1',
      reason: 'human-review-complete',
    });

    expect(decision).toMatchObject({
      status: 'accepted',
      next: {
        status: 'reviewed',
        reviewEvidence: { reviewerId: 'reviewer-1', contentFingerprint: fingerprint },
      },
      auditEvent: {
        eventId: 'review-1',
        actorId: 'reviewer-1',
        from: 'draft',
        to: 'reviewed',
        contentFingerprint: fingerprint,
      },
    });
  });

  it('rejects actor role spoofing and reviewer evidence supplied by untrusted content', () => {
    const noRole = decideEditorialTransition({
      current: record('draft'),
      to: 'reviewed',
      actor: { id: 'attacker', roles: [] },
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: 'spoof-1',
      reason: 'spoof',
    });
    const spoofedPublished = decideEditorialTransition({
      current: record('reviewed', {
        reviewEvidence: {
          reviewerId: 'unreviewed',
          reviewedAt: '2026-08-03T05:00:00.000Z',
          contentFingerprint: fingerprint,
        },
      }),
      to: 'published',
      actor: publisher,
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: 'spoof-2',
      reason: 'spoof',
      trustedAssetRegistry: rightsRegistry(),
    });

    expect(noRole).toMatchObject({ status: 'rejected', reason: 'actor-not-authorized' });
    expect(spoofedPublished).toMatchObject({ status: 'rejected', reason: 'invalid-review-evidence' });
  });

  it.each([
    ['reviewed', 'draft', reviewer],
    ['published', 'archived', archiver],
  ] as const)('rejects %s historical state without content-bound review evidence', (from, to, actor) => {
    const decision = decideEditorialTransition({
      current: record(from, { reviewEvidence: null }),
      to,
      actor,
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: `invalid-history-${from}`,
      reason: 'invalid-history',
    });

    expect(decision).toMatchObject({ status: 'rejected', reason: 'invalid-review-evidence' });
  });

  it('rejects self-review even when the author has a trusted reviewer role', () => {
    const decision = decideEditorialTransition({
      current: record('draft'),
      to: 'reviewed',
      actor: { id: 'author-1', roles: ['reviewer'] },
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: 'self-review',
      reason: 'self-review',
    });

    expect(decision).toMatchObject({ status: 'rejected', reason: 'reviewer-is-author' });
  });

  it.each([
    'sha256:short',
    `sha256:${'A'.repeat(64)}`,
    `sha256:${'g'.repeat(64)}`,
  ])('rejects non-canonical content fingerprint %s', badFingerprint => {
    const decision = decideEditorialTransition({
      current: record('draft', { contentFingerprint: badFingerprint }),
      to: 'reviewed',
      actor: reviewer,
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: 'bad-fingerprint',
      reason: 'review',
    });

    expect(decision).toMatchObject({ status: 'rejected', reason: 'invalid-record' });
  });

  it.each(['non-publishable', 'NOASSERTION', 'unknown-license']) (
    'never publishes license %s',
    licenseId => {
      const decision = decideEditorialTransition({
        current: record('reviewed', {
          provenance: { ...record('reviewed').provenance, licenseId },
        }),
        to: 'published',
        actor: publisher,
        occurredAt: '2026-08-03T06:00:00.000Z',
        correlationId: `publish-${licenseId}`,
        reason: 'publish',
        trustedAssetRegistry: rightsRegistry(),
      });

      expect(decision).toMatchObject({ status: 'rejected', reason: 'rights-license-mismatch' });
    },
  );

  it('never publishes generated, unreviewed pilot content', () => {
    const decision = decideEditorialTransition({
      current: record('reviewed', {
        provenance: {
          originKind: 'ai-assisted',
          authorId: 'generator-owner',
          source: 'generated-pilot',
          licenseId: 'non-publishable',
          attribution: null,
          rightsEvidenceId: null,
          generator: { provider: 'synthetic', model: 'pilot-generator-v1' },
        },
        reviewEvidence: null,
      }),
      to: 'published',
      actor: publisher,
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: 'pilot-publish',
      reason: 'publish',
      trustedAssetRegistry: rightsRegistry(),
    });

    expect(decision.status).toBe('rejected');
  });

  it('resets review evidence when a reviewed candidate returns to draft', () => {
    const decision = decideEditorialTransition({
      current: record('reviewed'),
      to: 'draft',
      actor: reviewer,
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: 'return-draft',
      reason: 'correction-required',
    });

    expect(decision).toMatchObject({ status: 'accepted', next: { status: 'draft', reviewEvidence: null } });
  });

  it('makes audit append retries idempotent and rejects event-id tampering', () => {
    const transition = decideEditorialTransition({
      current: record('draft'),
      to: 'reviewed',
      actor: reviewer,
      occurredAt: '2026-08-03T06:00:00.000Z',
      correlationId: 'review-append',
      reason: 'review-complete',
    });
    if (transition.status !== 'accepted') throw new Error('expected accepted transition');

    expect(decideAuditAppend(null, transition.auditEvent)).toEqual({ status: 'append' });
    expect(decideAuditAppend(transition.auditEvent, transition.auditEvent)).toEqual({ status: 'unchanged' });
    expect(decideAuditAppend(transition.auditEvent, {
      ...transition.auditEvent,
      actorId: 'spoofed-reviewer',
    })).toEqual({ status: 'conflict', reason: 'event-id-collision' });
  });
});

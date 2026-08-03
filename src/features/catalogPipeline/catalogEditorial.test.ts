import { describe, expect, it } from 'vitest';

import {
  decideAuditAppend,
  decideEditorialTransition,
  isLicensePublishable,
  type CatalogEditorialRecord,
  type CatalogEditorialStatus,
  type TrustedEditorialActor,
} from './catalogEditorial';

const fingerprint = `sha256:${'0'.repeat(64)}`;
const reviewer: TrustedEditorialActor = { id: 'reviewer-1', roles: ['reviewer'] };
const publisher: TrustedEditorialActor = { id: 'publisher-1', roles: ['publisher'] };
const archiver: TrustedEditorialActor = { id: 'archiver-1', roles: ['archiver'] };

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
    source: 'LingoFlash editorial team',
    licenseId: 'CC0-1.0',
    attribution: null,
    rightsEvidenceId: null,
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
      });

      expect(decision).toMatchObject({ status: 'rejected', reason: 'license-not-publishable' });
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

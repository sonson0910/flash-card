import { describe, expect, it } from 'vitest';

import { decideCatalogVersion } from './catalogVersioning';

const fingerprint = (hex: string): string => `sha256:${hex.repeat(64)}`;

describe('catalog content versioning', () => {
  it('accepts version one as the first immutable snapshot', () => {
    expect(decideCatalogVersion(null, { contentVersion: 1, contentFingerprint: fingerprint('1') }))
      .toEqual({ status: 'create' });
  });

  it('treats an identical version and fingerprint retry as idempotent', () => {
    expect(decideCatalogVersion(
      { contentVersion: 2, contentFingerprint: fingerprint('2') },
      { contentVersion: 2, contentFingerprint: fingerprint('2') },
    )).toEqual({ status: 'unchanged' });
  });

  it('rejects mutation of an existing immutable version', () => {
    expect(decideCatalogVersion(
      { contentVersion: 2, contentFingerprint: fingerprint('2') },
      { contentVersion: 2, contentFingerprint: fingerprint('3') },
    )).toEqual({ status: 'conflict', reason: 'immutable-version-mismatch' });
  });

  it('accepts exactly the next version with different content', () => {
    expect(decideCatalogVersion(
      { contentVersion: 2, contentFingerprint: fingerprint('2') },
      { contentVersion: 3, contentFingerprint: fingerprint('3') },
    )).toEqual({ status: 'advance' });
  });

  it.each([
    [3, 2, 'stale-version'],
    [3, 5, 'version-gap'],
    [0, 1, 'invalid-current-version'],
    [1, 0, 'invalid-incoming-version'],
    [1.5, 2, 'invalid-current-version'],
    [1, 2.5, 'invalid-incoming-version'],
  ] as const)('rejects current=%s incoming=%s as %s', (currentVersion, incomingVersion, reason) => {
    expect(decideCatalogVersion(
      { contentVersion: currentVersion, contentFingerprint: fingerprint('2') },
      { contentVersion: incomingVersion, contentFingerprint: fingerprint('3') },
    )).toEqual({ status: 'conflict', reason });
  });

  it('rejects an initial snapshot that does not start at version one', () => {
    expect(decideCatalogVersion(null, { contentVersion: 2, contentFingerprint: fingerprint('3') }))
      .toEqual({ status: 'conflict', reason: 'initial-version-must-be-one' });
  });

  it('rejects a version bump that reuses the prior content fingerprint', () => {
    expect(decideCatalogVersion(
      { contentVersion: 2, contentFingerprint: fingerprint('2') },
      { contentVersion: 3, contentFingerprint: fingerprint('2') },
    )).toEqual({ status: 'conflict', reason: 'empty-version-bump' });
  });

  it.each([
    ['', fingerprint('3'), 'invalid-current-fingerprint'],
    [fingerprint('2'), 'not-a-sha256-fingerprint', 'invalid-incoming-fingerprint'],
    [`sha256:${'A'.repeat(64)}`, fingerprint('3'), 'invalid-current-fingerprint'],
    [fingerprint('2'), `sha256:${'g'.repeat(64)}`, 'invalid-incoming-fingerprint'],
  ] as const)('rejects invalid fingerprints', (currentFingerprint, incomingFingerprint, reason) => {
    expect(decideCatalogVersion(
      { contentVersion: 1, contentFingerprint: currentFingerprint },
      { contentVersion: 2, contentFingerprint: incomingFingerprint },
    )).toEqual({ status: 'conflict', reason });
  });
});

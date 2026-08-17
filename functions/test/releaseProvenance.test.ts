import { describe, expect, it } from 'vitest';
import {
  createReleaseProvenanceLabels,
  RELEASE_PROVENANCE_LABEL_KEYS,
} from '../src/releaseProvenance.js';

const candidateSha256 = 'b'.repeat(64);

describe('release provenance labels', () => {
  it('omits labels outside a sealed release deployment', () => {
    expect(createReleaseProvenanceLabels(undefined, undefined)).toBeUndefined();
  });

  it('splits immutable identifiers into valid Google Cloud label values', () => {
    const revision = 'a'.repeat(40);

    expect(createReleaseProvenanceLabels(revision, candidateSha256)).toEqual({
      [RELEASE_PROVENANCE_LABEL_KEYS.schema]: 'v1',
      [RELEASE_PROVENANCE_LABEL_KEYS.revisionFirst]: 'a'.repeat(32),
      [RELEASE_PROVENANCE_LABEL_KEYS.revisionSecond]: 'a'.repeat(8),
      [RELEASE_PROVENANCE_LABEL_KEYS.candidateFirst]: 'b'.repeat(32),
      [RELEASE_PROVENANCE_LABEL_KEYS.candidateSecond]: 'b'.repeat(32),
    });
  });

  it('preserves a 64-character revision without truncation', () => {
    const revision = 'c'.repeat(64);
    const labels = createReleaseProvenanceLabels(revision, candidateSha256)!;

    expect(
      labels[RELEASE_PROVENANCE_LABEL_KEYS.revisionFirst]
      + labels[RELEASE_PROVENANCE_LABEL_KEYS.revisionSecond]
    ).toBe(revision);
  });

  it.each([
    [undefined, candidateSha256],
    ['a'.repeat(40), undefined],
    ['A'.repeat(40), candidateSha256],
    ['a'.repeat(40), 'b'.repeat(63)],
  ])('rejects incomplete or malformed release identifiers', (revision, candidate) => {
    expect(() => createReleaseProvenanceLabels(revision, candidate)).toThrow(
      'Release provenance labels require a valid revision and candidate SHA-256.',
    );
  });
});

const REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const RELEASE_PROVENANCE_LABEL_KEYS = Object.freeze({
  schema: 'sonflash-provenance',
  revisionFirst: 'sonflash-revision-1',
  revisionSecond: 'sonflash-revision-2',
  candidateFirst: 'sonflash-candidate-1',
  candidateSecond: 'sonflash-candidate-2',
});

export function createReleaseProvenanceLabels(
  revision: string | undefined,
  candidateSha256: string | undefined,
): Record<string, string> | undefined {
  if (revision === undefined && candidateSha256 === undefined) return undefined;
  if (!revision || !REVISION_PATTERN.test(revision) || !candidateSha256 || !SHA256_PATTERN.test(candidateSha256)) {
    throw new Error('Release provenance labels require a valid revision and candidate SHA-256.');
  }
  return {
    [RELEASE_PROVENANCE_LABEL_KEYS.schema]: 'v1',
    [RELEASE_PROVENANCE_LABEL_KEYS.revisionFirst]: revision.slice(0, 32),
    [RELEASE_PROVENANCE_LABEL_KEYS.revisionSecond]: revision.slice(32),
    [RELEASE_PROVENANCE_LABEL_KEYS.candidateFirst]: candidateSha256.slice(0, 32),
    [RELEASE_PROVENANCE_LABEL_KEYS.candidateSecond]: candidateSha256.slice(32),
  };
}

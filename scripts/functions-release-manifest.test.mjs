import { describe, expect, it } from 'vitest';
import {
  createExpectedReleaseLabels,
  validateReleaseManifestInputs,
  verifyLiteralFunctionsManifest,
} from './functions-release-manifest.mjs';

const revision = 'a'.repeat(40);
const candidateSha256 = 'b'.repeat(64);
const functionIds = [
  'generateVocabulary',
  'findVocabularyImage',
  'createSharedDeck',
  'loadSharedDeck',
  'revokeSharedDeck',
  'migrateLegacyLibrary',
];
const labelKeys = {
  schema: 'sonflash-provenance',
  revisionFirst: 'sonflash-revision-1',
  revisionSecond: 'sonflash-revision-2',
  candidateFirst: 'sonflash-candidate-1',
  candidateSecond: 'sonflash-candidate-2',
};
const labels = createExpectedReleaseLabels(
  labelKeys,
  revision,
  candidateSha256,
);
const createManifest = () => ({
  specVersion: 'v1alpha1',
  endpoints: Object.fromEntries(
    functionIds.map(functionId => [functionId, { labels: { ...labels } }]),
  ),
});

describe('literal Functions release manifest', () => {
  it('binds every promoted endpoint to exact immutable identifiers', () => {
    expect(labels).toEqual({
      'sonflash-provenance': 'v1',
      'sonflash-revision-1': 'a'.repeat(32),
      'sonflash-revision-2': 'a'.repeat(8),
      'sonflash-candidate-1': 'b'.repeat(32),
      'sonflash-candidate-2': 'b'.repeat(32),
    });
    expect(() => verifyLiteralFunctionsManifest({
      manifest: createManifest(),
      functionIds,
      labels,
    })).not.toThrow();
  });

  it('rejects parameter expressions instead of treating them as provider labels', () => {
    const manifest = createManifest();
    manifest.endpoints.createSharedDeck.labels['sonflash-revision-1'] =
      '{{ params.SONFLASH_RELEASE_REVISION_FIRST }}';

    expect(() => verifyLiteralFunctionsManifest({
      manifest,
      functionIds,
      labels,
    })).toThrow('Compiled Cloud Function createSharedDeck has invalid release provenance labels.');
  });

  it('rejects missing or unexpected promoted endpoints', () => {
    const manifest = createManifest();
    delete manifest.endpoints.loadSharedDeck;

    expect(() => verifyLiteralFunctionsManifest({
      manifest,
      functionIds,
      labels,
    })).toThrow('Compiled Functions manifest endpoint set is invalid.');
  });

  it.each([
    [['generateVocabulary', 'generateVocabulary'], revision, candidateSha256],
    [functionIds, 'A'.repeat(40), candidateSha256],
    [functionIds, revision, 'b'.repeat(63)],
  ])('rejects malformed release manifest inputs', (ids, releaseRevision, candidate) => {
    expect(() => validateReleaseManifestInputs({
      functionIds: ids,
      revision: releaseRevision,
      candidateSha256: candidate,
    })).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { createLexemeId, createTrackMembershipId } from '../multilingual/lexemeIdentity';
import type { LexemeV3, TrackMembershipV3 } from '../multilingual/schemaV3';
import { buildCatalogRelease, fingerprintCatalogEntity, sha256Hex } from './catalogBuilder';
import {
  planCatalogImport,
  type CurrentCatalogImportState,
} from './catalogImportPlan';
import type { CatalogSourceBundleV1 } from './catalogContracts';

const now = '2026-08-03T10:00:00.000Z';
const priorManifestFingerprint = `sha256:${'1'.repeat(64)}`;

const entity = (kind: 'lexeme' | 'membership', key: string, version = 1) => (
  kind === 'lexeme'
    ? (() => {
        const id = createLexemeId({
          language: 'en', normalizedLemma: key, partOfSpeech: 'noun', senseKey: 'primary',
        });
        return {
        schemaVersion: 3, id, language: 'en', lemma: key, normalizedLemma: key,
        partOfSpeech: 'noun', senseKey: 'primary', definitions: [{ language: 'vi', text: id }],
        phonetics: [], examples: [], collocations: [], wordFamily: [],
        media: { audioUrl: null, imageUrl: null },
        compatibility: {
          legacyPartOfSpeech: 'noun', translation: id, explanation: '', explanationTranslation: '',
          emoji: '', exampleSentence: '', exampleTranslation: '', synonyms: [], antonyms: [],
          register: '', commonMistake: '',
        },
        provenance: {
          source: 'team', license: 'CC0-1.0', reviewer: 'reviewer-1', editorialStatus: 'published',
        },
        contentVersion: version, createdAt: now, updatedAt: now,
      } as LexemeV3;
      })()
    : (() => {
        const lexemeId = createLexemeId({
          language: 'en', normalizedLemma: key, partOfSpeech: 'noun', senseKey: 'primary',
        });
        return {
        schemaVersion: 3,
        id: createTrackMembershipId({ trackId: 'general', lexemeId }),
        lexemeId, trackId: 'general', tier: 'foundation',
        cefrLevel: 'A1', topic: 'basics', legacyCategory: 'General', skills: ['reading'], rank: 0,
        lessonGroup: 'pilot', editorialStatus: 'published', contentVersion: version,
      } as TrackMembershipV3;
      })()
);

async function artifactFor(
  lexemes: readonly LexemeV3[],
  memberships: readonly TrackMembershipV3[],
  sequence = 1,
  previousReleaseId: string | null = null,
) {
  const effectiveMemberships = memberships.length > 0
    ? memberships
    : lexemes.map(item => entity('membership', item.normalizedLemma) as TrackMembershipV3);
  const source: CatalogSourceBundleV1 = {
    manifest: {
      manifestVersion: 1, catalogId: 'english-pilot', contentLanguage: 'en', supportLanguages: ['vi'],
      lexemeFiles: ['lexemes.jsonl'], membershipFiles: ['memberships.jsonl'],
    },
    lexemes: await Promise.all(lexemes.map(async item => ({
      entity: item,
      provenance: {
        schemaVersion: 1, sourceRef: 'team', sourceUrl: null, licenseId: 'CC0-1.0',
        attribution: 'team', authorId: 'author-1', origin: 'human-authored' as const,
        publishability: 'publishable' as const,
      },
      review: {
        status: 'reviewed' as const, reviewerId: 'reviewer-1', reviewedAt: now,
        contentDigest: await fingerprintCatalogEntity(item),
      },
    }))),
    memberships: await Promise.all(effectiveMemberships.map(async item => ({
      entity: item,
      provenance: {
        schemaVersion: 1, sourceRef: 'team', sourceUrl: null, licenseId: 'CC0-1.0',
        attribution: 'team', authorId: 'author-1', origin: 'human-authored' as const,
        publishability: 'publishable' as const,
      },
      review: {
        status: 'reviewed' as const, reviewerId: 'reviewer-1', reviewedAt: now,
        contentDigest: await fingerprintCatalogEntity(item),
      },
    }))),
  };
  const result = await buildCatalogRelease(source, {
    releaseId: `english-pilot-${String(sequence).padStart(4, '0')}`,
    sequence, previousReleaseId, createdAt: now,
  });
  if (result.status !== 'built') throw new Error(`build rejected: ${result.reason}`);
  return result.artifact;
}

const emptyState: CurrentCatalogImportState = {
  activeRelease: null,
  entities: [],
};

describe('planCatalogImport', () => {
  it('defaults to a dry-run create plan without performing writes', async () => {
    const incoming = entity('lexeme', 'lexeme-a') as LexemeV3;
    const plan = await planCatalogImport(emptyState, await artifactFor([incoming], []));
    expect(plan).toMatchObject({ status: 'planned', mode: 'dry-run' });
    if (plan.status !== 'planned') return;
    expect(plan.operations).toContainEqual(expect.objectContaining({
      action: 'create', entityKind: 'lexeme', entityId: incoming.id,
    }));
  });

  it('plans update, unchanged and archive operations with stable ordering', async () => {
    const unchanged = entity('lexeme', 'lexeme-a') as LexemeV3;
    const updated = { ...entity('lexeme', 'lexeme-b', 2), lemma: 'updated' } as LexemeV3;
    const removed = entity('lexeme', 'lexeme-c') as LexemeV3;
    const state: CurrentCatalogImportState = {
      activeRelease: {
        catalogId: 'english-pilot', releaseId: 'english-pilot-0001', sequence: 1,
        manifestFingerprint: priorManifestFingerprint,
      },
      entities: await Promise.all([
        unchanged,
        entity('lexeme', 'lexeme-b') as LexemeV3,
        removed,
      ].map(async value => ({
        entityKind: 'lexeme' as const,
        entityId: value.id,
        value,
        contentVersion: value.contentVersion,
        contentFingerprint: `sha256:${await fingerprintCatalogEntity(value)}`,
      }))),
    };
    const artifact = await artifactFor([unchanged, updated], [], 2, 'english-pilot-0001');
    const plan = await planCatalogImport(state, artifact);
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    expect(plan.operations
      .filter(operation => operation.entityKind === 'lexeme')
      .map(operation => [operation.entityId, operation.action])).toEqual([
      [unchanged.id, 'unchanged'],
      [updated.id, 'update'],
      [removed.id, 'archive'],
    ]);
    const archive = plan.operations.find(operation => operation.action === 'archive');
    expect(archive).toMatchObject({ contentVersion: 2, value: { contentVersion: 2 } });
    if (archive?.entityKind === 'lexeme') {
      expect((archive.value as LexemeV3).provenance.editorialStatus).toBe('archived');
    }
  });

  it.each([
    ['sequence gap', { sequence: 3, previous: 'english-pilot-0001' }],
    ['previous mismatch', { sequence: 2, previous: 'other-release' }],
  ])('rejects release CAS conflict: %s', async (_label, next) => {
    const state: CurrentCatalogImportState = {
      activeRelease: {
        catalogId: 'english-pilot', releaseId: 'english-pilot-0001', sequence: 1,
        manifestFingerprint: priorManifestFingerprint,
      },
      entities: [],
    };
    const artifact = await artifactFor(
      [entity('lexeme', 'lexeme-a') as LexemeV3], [], next.sequence, next.previous,
    );
    expect(await planCatalogImport(state, artifact)).toMatchObject({ status: 'conflict' });
  });

  it('rejects immutable entity version conflicts via decideCatalogVersion', async () => {
    const current = entity('lexeme', 'lexeme-a') as LexemeV3;
    const changedWithoutVersion = { ...current, lemma: 'changed' } as LexemeV3;
    const state: CurrentCatalogImportState = {
      activeRelease: {
        catalogId: 'english-pilot', releaseId: 'english-pilot-0001', sequence: 1,
        manifestFingerprint: priorManifestFingerprint,
      },
      entities: [{
        entityKind: 'lexeme', entityId: current.id, value: current,
        contentVersion: 1, contentFingerprint: `sha256:${await fingerprintCatalogEntity(current)}`,
      }],
    };
    const artifact = await artifactFor([changedWithoutVersion], [], 2, 'english-pilot-0001');
    expect(await planCatalogImport(state, artifact)).toMatchObject({
      status: 'conflict', reason: 'entity-version-conflict',
    });
  });

  it('treats a retry of the already active immutable release as unchanged', async () => {
    const artifact = await artifactFor([entity('lexeme', 'lexeme-a') as LexemeV3], []);
    const manifestFingerprint = `sha256:${await sha256Hex(artifact.manifestBytes)}`;
    const state: CurrentCatalogImportState = {
      activeRelease: {
        catalogId: 'english-pilot', releaseId: 'english-pilot-0001', sequence: 1,
        manifestFingerprint,
      },
      entities: [],
    };
    expect(await planCatalogImport(state, artifact)).toEqual({ status: 'unchanged' });
    expect(await planCatalogImport({
      ...state,
      activeRelease: { ...state.activeRelease!, manifestFingerprint: `sha256:${'0'.repeat(64)}` },
    }, artifact)).toMatchObject({ status: 'conflict', reason: 'release-collision' });
  });
});

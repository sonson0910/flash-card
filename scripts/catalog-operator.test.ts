import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createLexemeId, createTrackMembershipId } from '../src/features/multilingual/lexemeIdentity';
import type { LexemeV3, TrackMembershipV3 } from '../src/features/multilingual/schemaV3';
import type {
  CatalogCandidateProvenanceV1,
  CatalogReviewerAuthorityV1,
  CatalogSourceBundleV1,
} from '../src/features/catalogPipeline/catalogContracts';
import {
  buildCatalogRelease,
  fingerprintCatalogReviewContent,
  fingerprintCatalogSourceBundle,
  sha256Hex,
} from '../src/features/catalogPipeline/catalogBuilder';
import { createEnglishPilotCatalog } from '../src/features/catalogPipeline/pilotCatalog';
import {
  buildCatalogFiles,
  loadCatalogSource,
  validateCatalogFiles,
  verifyCatalogFiles,
  writeBuiltReleaseAtomic,
} from './catalog-operator';

const temporaryDirectories: string[] = [];
const now = new Date().toISOString();
const provenance: CatalogCandidateProvenanceV1 = {
  schemaVersion: 1,
  sourceRef: 'editorial-team',
  sourceUrl: null,
  licenseId: 'CC0-1.0',
  rightsEvidenceId: null,
  attribution: 'LingoFlash editorial team',
  authorId: 'author-1',
  origin: 'human-authored',
  publishability: 'publishable',
};

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lingoflash-catalog-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const writeSource = async (root: string, source: CatalogSourceBundleV1): Promise<string> => {
  const lexemePath = path.join(root, source.manifest.lexemeFiles[0]);
  const membershipPath = path.join(root, source.manifest.membershipFiles[0]);
  await mkdir(path.dirname(lexemePath), { recursive: true });
  await mkdir(path.dirname(membershipPath), { recursive: true });
  const manifestPath = path.join(root, 'source-manifest.json');
  await writeFile(manifestPath, JSON.stringify(source.manifest));
  await writeFile(
    lexemePath,
    `${source.lexemes.map(value => JSON.stringify(value)).join('\n')}\n`,
  );
  await writeFile(
    membershipPath,
    `${source.memberships.map(value => JSON.stringify(value)).join('\n')}\n`,
  );
  return manifestPath;
};

const publishedSource = async (): Promise<CatalogSourceBundleV1> => {
  const identity = { language: 'en', normalizedLemma: 'hello', partOfSpeech: 'noun', senseKey: 'primary' };
  const lexeme: LexemeV3 = {
    schemaVersion: 3,
    id: createLexemeId(identity),
    ...identity,
    lemma: 'Hello',
    definitions: [{ language: 'vi', text: 'Xin chao' }],
    phonetics: [], examples: [], collocations: [], wordFamily: [],
    media: { audioUrl: null, imageUrl: null },
    compatibility: {
      legacyPartOfSpeech: 'noun', translation: 'Xin chao', explanation: '',
      explanationTranslation: '', emoji: '', exampleSentence: '', exampleTranslation: '',
      synonyms: [], antonyms: [], register: '', commonMistake: '',
    },
    provenance: {
      source: provenance.sourceRef,
      license: provenance.licenseId,
      reviewer: 'fixture-reviewer',
      editorialStatus: 'published',
    },
    contentVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  const membership: TrackMembershipV3 = {
    schemaVersion: 3,
    id: createTrackMembershipId({ trackId: 'general', lexemeId: lexeme.id }),
    lexemeId: lexeme.id,
    trackId: 'general',
    tier: 'foundation',
    cefrLevel: 'A1',
    topic: 'basics',
    legacyCategory: 'General',
    skills: ['reading'],
    rank: 0,
    lessonGroup: 'pilot',
    editorialStatus: 'published',
    contentVersion: 1,
  };
  return {
    manifest: {
      manifestVersion: 1,
      catalogId: 'english-cli-test',
      contentLanguage: 'en',
      supportLanguages: ['vi'],
      lexemeFiles: ['lexemes/core.jsonl'],
      membershipFiles: ['memberships/general.jsonl'],
    },
    lexemes: [{
      entity: lexeme,
      provenance,
      review: {
        status: 'reviewed', reviewerId: 'fixture-reviewer', reviewedAt: now,
        contentDigest: await fingerprintCatalogReviewContent({
          ...lexeme,
          provenance: { ...lexeme.provenance, editorialStatus: 'reviewed' },
        }),
      },
    }],
    memberships: [{
      entity: membership,
      provenance,
      review: {
        status: 'reviewed', reviewerId: 'fixture-reviewer', reviewedAt: now,
        contentDigest: await fingerprintCatalogReviewContent({ ...membership, editorialStatus: 'reviewed' }),
      },
    }],
  };
};

const authorityFor = async (
  source: CatalogSourceBundleV1,
  reviewedAt = now,
  reviewerId = 'fixture-reviewer',
): Promise<CatalogReviewerAuthorityV1> => ({
  reviewerId,
  approvedDigest: await fingerprintCatalogSourceBundle(source),
  reviewedAt,
});

describe('catalog filesystem operator', () => {
  it('runs the real validate CLI against explicit bounded JSONL files', async () => {
    const root = await temporaryDirectory();
    const source = createEnglishPilotCatalog();
    const manifestPath = await writeSource(root, source);
    const result = spawnSync(process.execPath, [
      'scripts/catalog-gate.mjs', 'validate', '--input', manifestPath,
    ], { cwd: path.resolve('.'), encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'accepted',
      catalogId: 'english-phase3-pilot',
      lexemes: 300,
      memberships: 900,
      sourceDigest: await fingerprintCatalogSourceBundle(source),
    });
  });

  it('rejects traversal, symlink, and oversized manifest inputs', async () => {
    const traversalRoot = await temporaryDirectory();
    const traversalManifest = path.join(traversalRoot, 'source-manifest.json');
    await writeFile(traversalManifest, JSON.stringify({
      ...createEnglishPilotCatalog().manifest,
      lexemeFiles: ['../outside.jsonl'],
    }));
    await expect(loadCatalogSource(traversalManifest)).rejects.toThrow(/relative path/i);

    const symlinkRoot = await temporaryDirectory();
    const realManifest = await writeSource(symlinkRoot, createEnglishPilotCatalog());
    const linkedManifest = path.join(symlinkRoot, 'linked-manifest.json');
    await symlink(realManifest, linkedManifest);
    await expect(loadCatalogSource(linkedManifest)).rejects.toThrow(/symbolic link/i);

    const oversizedRoot = await temporaryDirectory();
    const oversizedManifest = path.join(oversizedRoot, 'source-manifest.json');
    await writeFile(oversizedManifest, ' '.repeat(64 * 1024 + 1));
    await expect(loadCatalogSource(oversizedManifest)).rejects.toThrow(/exceeds/i);
  });

  it('rejects the draft pilot build without creating its output directory', async () => {
    const root = await temporaryDirectory();
    const source = createEnglishPilotCatalog();
    const manifestPath = await writeSource(root, source);
    const output = path.join(root, 'release');

    await expect(buildCatalogFiles(manifestPath, output, await authorityFor(source, now, 'fixture-reviewer'))).resolves.toMatchObject({
      status: 'rejected', reason: 'entity-not-published',
    });
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not let reviewer ids embedded in source authorize an operator build', async () => {
    const root = await temporaryDirectory();
    const source = await publishedSource();
    const manifestPath = await writeSource(root, source);
    const output = path.join(root, 'release');

    await expect(buildCatalogFiles(manifestPath, output, await authorityFor(
      source, now, 'different-fixture-reviewer',
    ))).resolves.toMatchObject({
      status: 'rejected', reason: 'reviewer-not-trusted',
    });
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a stale protected approval before creating any output', async () => {
    const root = await temporaryDirectory();
    const source = await publishedSource();
    const manifestPath = await writeSource(root, source);
    const output = path.join(root, 'release');

    await expect(buildCatalogFiles(
      manifestPath,
      output,
      await authorityFor(source, '2020-01-01T00:00:00.000Z'),
    )).resolves.toMatchObject({ status: 'rejected', reason: 'approval-stale' });
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails the CLI build closed when protected reviewer authority is absent', async () => {
    const root = await temporaryDirectory();
    const manifestPath = await writeSource(root, await publishedSource());
    const output = path.join(root, 'release');
    const environment = { ...process.env };
    environment.CATALOG_TRUSTED_REVIEWER_IDS = 'fixture-reviewer';
    delete environment.CATALOG_REVIEWER_ID;
    delete environment.CATALOG_APPROVED_DIGEST;
    delete environment.CATALOG_REVIEWED_AT;

    const result = spawnSync(process.execPath, [
      'scripts/catalog-gate.mjs', 'build', '--input', manifestPath, '--out', output,
    ], { cwd: path.resolve('.'), encoding: 'utf8', env: environment });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      status: 'error', message: expect.stringContaining('CATALOG_REVIEWER_ID'),
    });
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects non-canonical protected authority values at the CLI boundary', async () => {
    const root = await temporaryDirectory();
    const source = await publishedSource();
    const manifestPath = await writeSource(root, source);
    const output = path.join(root, 'release');

    const result = spawnSync(process.execPath, [
      'scripts/catalog-gate.mjs', 'build', '--input', manifestPath, '--out', output,
    ], {
      cwd: path.resolve('.'), encoding: 'utf8',
      env: {
        ...process.env,
        CATALOG_REVIEWER_ID: 'fixture-reviewer',
        CATALOG_APPROVED_DIGEST: 'A'.repeat(64),
        CATALOG_REVIEWED_AT: now,
      },
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      status: 'error', message: expect.stringContaining('CATALOG_APPROVED_DIGEST'),
    });
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes a partial sibling temp directory when artifact writing fails', async () => {
    const root = await temporaryDirectory();
    const source = await publishedSource();
    const build = await buildCatalogRelease(source, {
      sequence: 1, previousReleaseId: null,
      reviewerAuthority: await authorityFor(source),
    });
    expect(build.status).toBe('built');
    if (build.status !== 'built') throw new Error('Expected publishable fixture to build.');

    await expect(writeBuiltReleaseAtomic(build.artifact, path.join(root, 'release'), {
      beforeWrite: async (_relativePath, ordinal) => {
        if (ordinal === 1) throw new Error('injected write failure');
      },
    })).rejects.toThrow('injected write failure');

    expect((await readdir(root)).filter(name => name.includes('.release.tmp-'))).toEqual([]);
    await expect(readdir(path.join(root, 'release'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('builds deterministically and verifies every artifact without writes', async () => {
    const firstRoot = await temporaryDirectory();
    const secondRoot = await temporaryDirectory();
    const source = await publishedSource();
    const firstManifest = await writeSource(firstRoot, source);
    const secondManifest = await writeSource(secondRoot, source);

    const authority = await authorityFor(source);
    const first = await buildCatalogFiles(firstManifest, path.join(firstRoot, 'release'), authority);
    const second = await buildCatalogFiles(secondManifest, path.join(secondRoot, 'release'), authority);
    expect(second).toEqual(first);
    const firstManifestBytes = await readFile(path.join(firstRoot, 'release/release-manifest.json'));
    const secondManifestBytes = await readFile(path.join(secondRoot, 'release/release-manifest.json'));
    expect(secondManifestBytes.equals(firstManifestBytes)).toBe(true);
    const deterministicManifest = JSON.parse(firstManifestBytes.toString('utf8')) as {
      releaseId: string;
      chunks: readonly { path: string; sha256: string }[];
    };
    expect(deterministicManifest.releaseId).toMatch(/^r-[a-f0-9]{24}$/);
    for (const chunk of deterministicManifest.chunks) {
      const firstChunk = await readFile(path.join(firstRoot, 'release', chunk.path));
      const secondChunk = await readFile(path.join(secondRoot, 'release', chunk.path));
      expect(secondChunk.equals(firstChunk)).toBe(true);
      expect(await sha256Hex(firstChunk)).toBe(chunk.sha256);
    }
    await expect(verifyCatalogFiles(path.join(firstRoot, 'release/release-manifest.json')))
      .resolves.toMatchObject({
        status: 'verified', catalogId: 'english-cli-test', memberships: 1, chunks: 1,
      });
    await expect(validateCatalogFiles(firstManifest)).resolves.toMatchObject({ status: 'accepted' });

    const cliOutput = path.join(firstRoot, 'cli-release');
    const buildCli = spawnSync(process.execPath, [
      'scripts/catalog-gate.mjs', 'build', '--input', firstManifest, '--out', cliOutput,
    ], {
      cwd: path.resolve('.'), encoding: 'utf8',
      env: {
        ...process.env,
        CATALOG_REVIEWER_ID: authority.reviewerId,
        CATALOG_APPROVED_DIGEST: authority.approvedDigest,
        CATALOG_REVIEWED_AT: authority.reviewedAt,
      },
    });
    expect(buildCli.status).toBe(0);
    expect(JSON.parse(buildCli.stdout)).toMatchObject({ status: 'built', memberships: 1 });
    const verifyCli = spawnSync(process.execPath, [
      'scripts/catalog-gate.mjs', 'verify', '--manifest', path.join(cliOutput, 'release-manifest.json'),
    ], { cwd: path.resolve('.'), encoding: 'utf8' });
    expect(verifyCli.status).toBe(0);
    expect(JSON.parse(verifyCli.stdout)).toMatchObject({ status: 'verified', memberships: 1 });
  });

  it('rejects a tampered chunk hash and leaves the artifact tree unchanged', async () => {
    const root = await temporaryDirectory();
    const source = await publishedSource();
    const manifestPath = await writeSource(root, source);
    const output = path.join(root, 'release');
    await buildCatalogFiles(manifestPath, output, await authorityFor(source));
    const releaseManifestPath = path.join(output, 'release-manifest.json');
    const releaseManifest = JSON.parse(await readFile(releaseManifestPath, 'utf8')) as {
      chunks: readonly { path: string }[];
    };
    const chunkPath = path.join(output, releaseManifest.chunks[0].path);
    const bytes = new Uint8Array(await readFile(chunkPath));
    bytes[bytes.length - 1] ^= 1;
    await writeFile(chunkPath, bytes);
    const before = await readdir(output, { recursive: true });

    await expect(verifyCatalogFiles(releaseManifestPath)).rejects.toThrow(/SHA-256/i);
    expect(await readdir(output, { recursive: true })).toEqual(before);
  });
});

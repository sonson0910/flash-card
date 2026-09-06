import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LISTEN_MVP_PILOT_UNAVAILABLE,
  buildListenMvpPilotManifest,
  buildListenMvpPilotPackage,
  assertListenMvpPilotDeployOutput,
  verifyListenMvpPilotPackage,
  writeListenMvpPilotPackage,
} from './listen-pilot-package';
import {
  LISTEN_MVP_PILOT_LESSONS,
  LISTEN_MVP_PILOT_REGISTRY,
} from '../src/features/listenMvp/listenMvpPilotCandidates';
import { LISTEN_MVP_PILOT_PUBLICATION } from '../src/features/listenMvp/listenMvpPilot';
import {
  assertOfflineMediaPackInstallable,
  parseOfflineMediaPackManifestV1,
  type OfflineMediaPackPublicationContext,
} from '../src/features/offlineMedia/offlineMediaPack';
import type { CatalogSourceAssetRegistryV1 } from '../src/features/catalogPipeline/catalogContracts';

const SOURCE_ROOT = path.resolve('content/review');
const CATALOG_ID = 'english-core';
const RELEASE_ID = 'listen-pilot-fixture-2026-09-06';
const REVIEWED_AT = '2026-09-06T00:00:00.000Z';
const APPROVED_FIXTURE_REGISTRY: CatalogSourceAssetRegistryV1 = {
  ...LISTEN_MVP_PILOT_REGISTRY,
  assets: LISTEN_MVP_PILOT_REGISTRY.assets.map(asset => ({
    ...asset,
    rightsEvidenceId: 'fixture-rights-evidence',
    basis: 'public-domain',
    commercialUse: 'allowed',
    derivatives: 'allowed',
    rehosting: 'allowed',
    thirdPartyFragments: 'none',
    territory: 'worldwide',
  })),
};

const digestManifest = async (manifest: unknown): Promise<string> => {
  const parsed = parseOfflineMediaPackManifestV1(manifest);
  const bytes = new TextEncoder().encode(JSON.stringify(parsed));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

type FixturePublication = OfflineMediaPackPublicationContext & {
  readonly status: 'published';
  readonly review: 'reviewed';
  readonly reviewerId: string;
  readonly publisherId: string;
  readonly reviewedAt: string;
  readonly publishedAt: string;
  readonly rightsPolicyUrl: string;
  readonly operatorAttestation: string;
};

const approvedFixture = async (options: {
  readonly sourceDirectory?: string;
  readonly registry?: CatalogSourceAssetRegistryV1;
  readonly lessons?: typeof LISTEN_MVP_PILOT_LESSONS;
} = {}) => {
  const manifest = await buildListenMvpPilotManifest({
    sourceDirectory: options.sourceDirectory ?? SOURCE_ROOT,
    registry: options.registry ?? APPROVED_FIXTURE_REGISTRY,
    lessons: options.lessons ?? LISTEN_MVP_PILOT_LESSONS,
    catalogId: CATALOG_ID,
    releaseId: RELEASE_ID,
    createdAt: REVIEWED_AT,
  });
  const publication: FixturePublication = {
    status: 'published' as const,
    review: 'reviewed' as const,
    catalogId: CATALOG_ID,
    releaseId: RELEASE_ID,
    manifestSha256: await digestManifest(manifest),
    reviewerId: 'fixture-reviewer',
    publisherId: 'fixture-publisher',
    reviewedAt: REVIEWED_AT,
    publishedAt: REVIEWED_AT,
    rightsPolicyUrl: 'https://learningenglish.voanews.com/p/6861.html',
    operatorAttestation: 'Operator attestation fixture for tests.',
  };
  return { manifest, publication };
};

const copyPilotMedia = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'listen-pilot-package-'));
  const mediaRoot = path.join(root, 'media', 'listen-mvp');
  await mkdir(mediaRoot, { recursive: true });
  for (const lesson of LISTEN_MVP_PILOT_LESSONS) {
    const source = path.join(SOURCE_ROOT, lesson.clip.path);
    await writeFile(path.join(root, lesson.clip.path), await readFile(source));
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
};

describe('listen pilot package publication gate', () => {
  it('returns an unavailable state without trusted review/publication approval', async () => {
    const result = await buildListenMvpPilotPackage({ sourceDirectory: SOURCE_ROOT, publication: null });

    expect(result.status).toBe('unavailable');
    expect(result).toMatchObject({
      ...LISTEN_MVP_PILOT_UNAVAILABLE,
      assetChecks: expect.arrayContaining([
        expect.objectContaining({ clipId: 'break-the-news', bytes: 733_106 }),
      ]),
    });
  });

  it('accepts only the three published media files and the manifest in deploy output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'listen-pilot-deploy-'));
    try {
      const mediaRoot = path.join(root, 'media', 'listen-mvp');
      await mkdir(mediaRoot, { recursive: true });
      await writeFile(path.join(mediaRoot, 'offline-pack.json'), '{}');
      for (const lesson of LISTEN_MVP_PILOT_LESSONS) {
        await writeFile(path.join(root, lesson.clip.path), Buffer.from('published audio'));
      }
      await expect(assertListenMvpPilotDeployOutput(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects renamed or unexpected media files in deploy output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'listen-pilot-deploy-'));
    try {
      const mediaRoot = path.join(root, 'media', 'listen-mvp');
      await mkdir(mediaRoot, { recursive: true });
      await writeFile(path.join(mediaRoot, 'renamed.m4a'), Buffer.from('candidate audio'));
      await expect(assertListenMvpPilotDeployOutput(root)).rejects.toMatchObject({
        code: 'listen-pilot-deployable-candidate',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('builds a deterministic manifest from actual derivative bytes for a trusted fixture approval', async () => {
    const first = await approvedFixture();
    const second = await approvedFixture();

    expect(second).toEqual(first);
    expect(first.manifest.assets).toHaveLength(3);
    expect(first.manifest.totalBytes).toBe(2_199_251);
    expect(first.manifest.assets.map(asset => asset.attribution)).toEqual([
      'Voice of America Learning English',
      'Voice of America Learning English',
      'Voice of America Learning English',
    ]);
  });

  it('writes an unavailable state only when publication approval is absent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'listen-pilot-output-'));
    try {
      const output = path.join(root, 'offline-pack.json');
      const result = await buildListenMvpPilotPackage({ sourceDirectory: SOURCE_ROOT, publication: null });
      await writeListenMvpPilotPackage(result, output);
      const written = JSON.parse(await readFile(output, 'utf8')) as unknown;

      expect(written).toEqual(result);
      expect(() => parseOfflineMediaPackManifestV1(written)).toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('verifies the checked-in published artifact byte-for-byte', async () => {
    const fixture = await copyPilotMedia();
    try {
      const output = path.join(fixture.root, 'offline-pack.json');
      const checkedIn = path.resolve('public', 'media/listen-mvp/offline-pack.json');
      await writeFile(output, await readFile(checkedIn));
      await expect(verifyListenMvpPilotPackage(output, fixture.root)).resolves.toBeUndefined();
      await writeFile(output, `${await readFile(output, 'utf8')}\n`);
      await expect(verifyListenMvpPilotPackage(output, fixture.root)).rejects.toMatchObject({
        code: 'listen-pilot-output-drift',
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('builds the approved package with identity and a canonical publication digest', async () => {
    const result = await buildListenMvpPilotPackage();

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected a ready publication');
    expect(result.manifest).toMatchObject({
      id: 'listen-mvp',
      catalogId: LISTEN_MVP_PILOT_PUBLICATION.catalogId,
      releaseId: LISTEN_MVP_PILOT_PUBLICATION.releaseId,
      assets: expect.arrayContaining([
        expect.objectContaining({
          clip: expect.objectContaining({ id: 'break-the-news' }),
          attribution: 'Voice of America Learning English',
        }),
      ]),
    });
    expect(result.publication).toMatchObject({
      reviewerId: 'operator-user',
      publisherId: 'operator-user',
      manifestSha256: await digestManifest(result.manifest),
    });
  });

  it('rejects a missing or incorrect publication digest before any installable result', async () => {
    const { manifest, publication } = await approvedFixture();
    await expect(assertOfflineMediaPackInstallable(manifest, APPROVED_FIXTURE_REGISTRY, {
      publication: { ...publication, manifestSha256: '0'.repeat(64) },
    })).rejects.toMatchObject({ code: 'offline-pack-publication-digest-mismatch' });
  });

  it('rejects tampered derivative bytes closed', async () => {
    const fixture = await copyPilotMedia();
    try {
      const target = path.join(fixture.root, LISTEN_MVP_PILOT_LESSONS[0].clip.path);
      const tampered = await readFile(target);
      tampered[0] = tampered[0] ^ 0xff;
      await writeFile(target, tampered);
      const { manifest, publication } = await approvedFixture();
      const tamperedManifest = await buildListenMvpPilotManifest({
        sourceDirectory: fixture.root,
        registry: APPROVED_FIXTURE_REGISTRY,
        lessons: LISTEN_MVP_PILOT_LESSONS,
        catalogId: CATALOG_ID,
        releaseId: RELEASE_ID,
        createdAt: REVIEWED_AT,
      });
      expect(tamperedManifest.assets[0]?.sha256).not.toBe(manifest.assets[0]?.sha256);
      await expect(assertOfflineMediaPackInstallable(
        tamperedManifest,
        APPROVED_FIXTURE_REGISTRY,
        { publication },
      )).rejects.toMatchObject({ code: 'offline-pack-publication-digest-mismatch' });
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    ['expired', { expiresAt: '2026-01-01T00:00:00.000Z' }],
    ['revoked', { revokedAt: '2026-01-01T00:00:00.000Z' }],
  ])('rejects a %s rights record through the existing evaluator', async (_label, rights) => {
    const { manifest, publication } = await approvedFixture();
    const registry: CatalogSourceAssetRegistryV1 = {
      ...APPROVED_FIXTURE_REGISTRY,
      assets: APPROVED_FIXTURE_REGISTRY.assets.map(asset => ({ ...asset, ...rights })),
    };
    await expect(assertOfflineMediaPackInstallable(manifest, registry, { publication }))
      .rejects.toMatchObject({ code: expect.stringMatching(/^rights-(expired|revoked)$/) });
  });

  it('rejects malformed transcript data before creating a package', async () => {
    const first = LISTEN_MVP_PILOT_LESSONS[0];
    const lessons = [
      {
        ...first,
        clip: {
          ...first.clip,
          transcriptCues: [{ ...first.clip.transcriptCues[0], endMs: 0 }],
        },
      },
      ...LISTEN_MVP_PILOT_LESSONS.slice(1),
    ];
    await expect(buildListenMvpPilotManifest({
      sourceDirectory: SOURCE_ROOT,
      lessons,
      catalogId: CATALOG_ID,
      releaseId: RELEASE_ID,
      createdAt: REVIEWED_AT,
    })).rejects.toThrow(/transcript|endMs/i);
  });
});

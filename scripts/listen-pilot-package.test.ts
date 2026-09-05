import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LISTEN_MVP_PILOT_UNAVAILABLE,
  buildListenMvpPilotManifest,
  buildListenMvpPilotPackage,
  writeListenMvpPilotPackage,
} from './listen-pilot-package';
import {
  LISTEN_MVP_PILOT_LESSONS,
  LISTEN_MVP_PILOT_REGISTRY,
} from '../src/features/listenMvp/listenMvpPilot';
import { parseOfflineMediaPackManifestV1 } from '../src/features/offlineMedia/offlineMediaPack';
import type { CatalogSourceAssetRegistryV1 } from '../src/features/catalogPipeline/catalogContracts';

const PUBLIC_ROOT = path.resolve('public');
const CATALOG_ID = 'english-core';
const RELEASE_ID = 'listen-pilot-2026-09-05';
const REVIEWED_AT = '2026-09-05T00:00:00.000Z';

const digestManifest = async (manifest: unknown): Promise<string> => {
  const parsed = parseOfflineMediaPackManifestV1(manifest);
  const bytes = new TextEncoder().encode(JSON.stringify(parsed));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const approvedPublication = async () => {
  const manifest = await buildListenMvpPilotManifest({
    publicDirectory: PUBLIC_ROOT,
    registry: LISTEN_MVP_PILOT_REGISTRY,
    lessons: LISTEN_MVP_PILOT_LESSONS,
    catalogId: CATALOG_ID,
    releaseId: RELEASE_ID,
    createdAt: REVIEWED_AT,
  });
  return {
    status: 'published' as const,
    review: 'reviewed' as const,
    catalogId: CATALOG_ID,
    releaseId: RELEASE_ID,
    manifestSha256: await digestManifest(manifest),
    reviewerId: 'fixture-reviewer',
    reviewedAt: REVIEWED_AT,
  };
};

const copyPilotMedia = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'listen-pilot-package-'));
  const mediaRoot = path.join(root, 'media', 'listen-mvp');
  await mkdir(mediaRoot, { recursive: true });
  for (const lesson of LISTEN_MVP_PILOT_LESSONS) {
    const source = path.join(PUBLIC_ROOT, lesson.clip.path);
    await writeFile(path.join(root, lesson.clip.path), await readFile(source));
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
};

describe('listen pilot package publication gate', () => {
  it('returns an unavailable state without trusted review/publication approval', async () => {
    const result = await buildListenMvpPilotPackage({ publicDirectory: PUBLIC_ROOT });

    expect(result.status).toBe('unavailable');
    expect(result).toMatchObject({
      ...LISTEN_MVP_PILOT_UNAVAILABLE,
      assetChecks: expect.arrayContaining([
        expect.objectContaining({ clipId: 'break-the-news', bytes: 733_106 }),
      ]),
    });
  });

  it('builds a deterministic manifest from actual derivative bytes for a trusted fixture approval', async () => {
    const publication = await approvedPublication();
    const first = await buildListenMvpPilotPackage({ publicDirectory: PUBLIC_ROOT, publication });
    const second = await buildListenMvpPilotPackage({ publicDirectory: PUBLIC_ROOT, publication });

    expect(first.status).toBe('ready');
    expect(second).toEqual(first);
    if (first.status !== 'ready') return;
    expect(first.manifest.assets).toHaveLength(3);
    expect(first.manifest.totalBytes).toBe(2_199_251);
    expect(first.manifest.assets.map(asset => asset.attribution)).toEqual([
      'Voice of America Learning English',
      'Voice of America Learning English',
      'Voice of America Learning English',
    ]);
  });

  it('writes an unavailable public state that is not an installable media manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'listen-pilot-output-'));
    try {
      const output = path.join(root, 'offline-pack.json');
      const result = await buildListenMvpPilotPackage({ publicDirectory: PUBLIC_ROOT });
      await writeListenMvpPilotPackage(result, output);
      const written = JSON.parse(await readFile(output, 'utf8')) as unknown;

      expect(written).toEqual(result);
      expect(() => parseOfflineMediaPackManifestV1(written)).toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a missing or incorrect publication digest before any installable result', async () => {
    const publication = await approvedPublication();
    await expect(buildListenMvpPilotPackage({
      publicDirectory: PUBLIC_ROOT,
      publication: { ...publication, manifestSha256: '0'.repeat(64) },
    })).rejects.toMatchObject({ code: 'offline-pack-publication-digest-mismatch' });
  });

  it('rejects tampered derivative bytes closed', async () => {
    const fixture = await copyPilotMedia();
    try {
      const target = path.join(fixture.root, LISTEN_MVP_PILOT_LESSONS[0].clip.path);
      await writeFile(target, Buffer.concat([await readFile(target), Buffer.from([0])]));
      const publication = await approvedPublication();
      await expect(buildListenMvpPilotPackage({
        publicDirectory: fixture.root,
        publication,
      })).rejects.toMatchObject({ code: 'offline-pack-asset-integrity-mismatch' });
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    ['expired', { expiresAt: '2026-01-01T00:00:00.000Z' }],
    ['revoked', { revokedAt: '2026-01-01T00:00:00.000Z' }],
  ])('rejects a %s rights record through the existing evaluator', async (_label, rights) => {
    const publication = await approvedPublication();
    const registry: CatalogSourceAssetRegistryV1 = {
      ...LISTEN_MVP_PILOT_REGISTRY,
      assets: LISTEN_MVP_PILOT_REGISTRY.assets.map(asset => ({ ...asset, ...rights })),
    };
    await expect(buildListenMvpPilotPackage({
      publicDirectory: PUBLIC_ROOT,
      registry,
      publication,
    })).rejects.toMatchObject({ code: expect.stringMatching(/^rights-(expired|revoked)$/) });
  });

  it('rejects malformed transcript data before creating a package', async () => {
    const publication = await approvedPublication();
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
    await expect(buildListenMvpPilotPackage({
      publicDirectory: PUBLIC_ROOT,
      lessons,
      publication,
    })).rejects.toThrow(/transcript|endMs/i);
  });
});

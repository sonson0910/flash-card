import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type {
  CatalogSourceAssetRegistryV1,
} from '../src/features/catalogPipeline/catalogContracts';
import {
  assertCatalogContentReferences,
  parseCatalogSourceAssetRegistryV1,
} from '../src/features/catalogPipeline/catalogValidation';
import {
  parseOfflineMediaPackManifestV1,
  type OfflineMediaPackManifestV1,
} from '../src/features/offlineMedia/offlineMediaPack';
import {
  LISTEN_MVP_PILOT_LESSONS,
  LISTEN_MVP_PILOT_REGISTRY,
} from '../src/features/listenMvp/listenMvpPilotCandidates';
import {
  parseListenMvpLessonV1,
  type ListenMvpLessonV1,
} from '../src/features/listenMvp/listenMvpContract';

export const LISTEN_MVP_PILOT_PACKAGE_PATH = 'media/listen-mvp/offline-pack.json';
const DEFAULT_PUBLIC_DIRECTORY = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const EXPECTED_CLIP_IDS = ['break-the-news', 'on-the-ball', 'fair-and-square'] as const;

export const LISTEN_MVP_PILOT_UNAVAILABLE = Object.freeze({
  status: 'unavailable' as const,
  reason: 'publication-evidence-missing' as const,
  message: 'Offline audio is unavailable until a reviewed, published release is approved.',
  clipIds: EXPECTED_CLIP_IDS,
});

export interface ListenMvpPilotAssetCheck {
  readonly clipId: string;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly sourceAssetSha256: string;
}

export type ListenMvpPilotPackageResult = typeof LISTEN_MVP_PILOT_UNAVAILABLE & {
  readonly assetChecks: readonly ListenMvpPilotAssetCheck[];
};

export interface ListenMvpPilotPackageOptions {
  readonly publicDirectory?: string;
  readonly registry?: CatalogSourceAssetRegistryV1;
  readonly lessons?: readonly ListenMvpLessonV1[];
}

export interface ListenMvpPilotManifestOptions {
  readonly publicDirectory?: string;
  readonly registry?: CatalogSourceAssetRegistryV1;
  readonly lessons?: readonly ListenMvpLessonV1[];
  readonly catalogId: string;
  readonly releaseId: string;
  readonly createdAt: string;
}

export class ListenMvpPilotPackageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ListenMvpPilotPackageError';
  }
}

const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

const within = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
};

const preparePilotAssets = async (options: ListenMvpPilotPackageOptions = {}) => {
  const registry = parseCatalogSourceAssetRegistryV1(options.registry ?? LISTEN_MVP_PILOT_REGISTRY);
  const lessonsInput = options.lessons ?? LISTEN_MVP_PILOT_LESSONS;
  const knownLexemeIds = new Set(LISTEN_MVP_PILOT_LESSONS.flatMap(lesson => lesson.chunk.lexemeIds));
  const lessons = lessonsInput.map(lesson => parseListenMvpLessonV1({
    clip: lesson.clip,
    chunk: lesson.chunk,
    comprehension: lesson.comprehension,
  }, registry, knownLexemeIds));
  const expectedIds = [...EXPECTED_CLIP_IDS].sort().join('\0');
  const actualIds = lessons.map(lesson => lesson.clip.id).sort().join('\0');
  if (lessons.length !== EXPECTED_CLIP_IDS.length || actualIds !== expectedIds) {
    throw new ListenMvpPilotPackageError('listen-pilot-count-invalid', 'The pilot package requires exactly three known clips.');
  }
  for (const lesson of lessons) {
    assertCatalogContentReferences(lesson.clip, registry);
    assertCatalogContentReferences(lesson.chunk, registry, knownLexemeIds);
  }

  const publicDirectory = path.resolve(options.publicDirectory ?? DEFAULT_PUBLIC_DIRECTORY);
  const assetChecks: ListenMvpPilotAssetCheck[] = [];
  for (const lesson of lessons) {
    const trustedAsset = registry.assets.find(asset => asset.sourceRef === lesson.clip.contentRights.sourceRef);
    if (trustedAsset === undefined || trustedAsset.sourceAssetSha256 === null) {
      throw new ListenMvpPilotPackageError(
        'listen-pilot-source-registry-invalid',
        `No trusted source checksum exists for ${lesson.clip.id}.`,
      );
    }
    const assetPath = path.resolve(publicDirectory, lesson.clip.path);
    if (!within(publicDirectory, assetPath)) {
      throw new ListenMvpPilotPackageError('listen-pilot-path-invalid', `Asset path escapes public/: ${lesson.clip.path}`);
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(assetPath);
    } catch {
      throw new ListenMvpPilotPackageError('offline-pack-asset-missing', `Pilot asset is missing: ${lesson.clip.path}`);
    }
    const actualDigest = digest(bytes);
    if (bytes.byteLength !== lesson.clip.byteLength) {
      throw new ListenMvpPilotPackageError(
        'offline-pack-asset-integrity-mismatch',
        `Pilot asset byte length does not match ${lesson.clip.id}.`,
      );
    }
    assetChecks.push({
      clipId: lesson.clip.id,
      path: lesson.clip.path,
      bytes: bytes.byteLength,
      sha256: actualDigest,
      sourceAssetSha256: trustedAsset.sourceAssetSha256,
    });
  }
  assetChecks.sort((left, right) => left.clipId.localeCompare(right.clipId));
  return { registry, lessons, assetChecks };
};

const manifestFromPrepared = (
  prepared: Awaited<ReturnType<typeof preparePilotAssets>>,
  catalogId: string,
  releaseId: string,
  createdAt: string,
): OfflineMediaPackManifestV1 => parseOfflineMediaPackManifestV1({
  manifestVersion: 1,
  id: 'listen-mvp',
  catalogId,
  releaseId,
  title: 'SonFlash Listen MVP pilot',
  createdAt,
  assets: prepared.assetChecks.map(check => {
    const lesson = prepared.lessons.find(candidate => candidate.clip.id === check.clipId);
    if (lesson === undefined) throw new ListenMvpPilotPackageError('listen-pilot-lesson-missing', check.clipId);
    const source = prepared.registry.assets.find(asset => asset.sourceRef === lesson.clip.contentRights.sourceRef);
    if (source === undefined) throw new ListenMvpPilotPackageError('listen-pilot-source-missing', check.clipId);
    return {
      clip: lesson.clip,
      sha256: check.sha256,
      attribution: source.attribution.text,
    };
  }),
  totalBytes: prepared.assetChecks.reduce((total, asset) => total + asset.bytes, 0),
});

export async function buildListenMvpPilotManifest(
  options: ListenMvpPilotManifestOptions,
): Promise<OfflineMediaPackManifestV1> {
  const prepared = await preparePilotAssets(options);
  return manifestFromPrepared(prepared, options.catalogId, options.releaseId, options.createdAt);
}

export async function buildListenMvpPilotPackage(
  options: ListenMvpPilotPackageOptions = {},
): Promise<ListenMvpPilotPackageResult> {
  const prepared = await preparePilotAssets(options);
  return { ...LISTEN_MVP_PILOT_UNAVAILABLE, assetChecks: prepared.assetChecks };
}

export async function writeListenMvpPilotPackage(
  result: ListenMvpPilotPackageResult,
  outputPath = path.resolve(DEFAULT_PUBLIC_DIRECTORY, LISTEN_MVP_PILOT_PACKAGE_PATH),
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

export async function verifyListenMvpPilotPackage(
  outputPath = path.resolve(DEFAULT_PUBLIC_DIRECTORY, LISTEN_MVP_PILOT_PACKAGE_PATH),
): Promise<void> {
  const result = await buildListenMvpPilotPackage();
  const expected = `${JSON.stringify(result, null, 2)}\n`;
  let actual: string;
  try {
    actual = await readFile(outputPath, 'utf8');
  } catch {
    throw new ListenMvpPilotPackageError('listen-pilot-output-missing', `Generated package is missing: ${outputPath}`);
  }
  if (actual !== expected) {
    throw new ListenMvpPilotPackageError(
      'listen-pilot-output-drift',
      `Checked-in package differs from the deterministic generator: ${outputPath}`,
    );
  }
}

const isMainModule = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (process.argv.includes('--check')) {
    await verifyListenMvpPilotPackage();
    console.log(JSON.stringify({ status: 'verified', path: LISTEN_MVP_PILOT_PACKAGE_PATH }));
  } else {
    const result = await buildListenMvpPilotPackage();
    await writeListenMvpPilotPackage(result);
    console.log(JSON.stringify({ status: result.status, path: LISTEN_MVP_PILOT_PACKAGE_PATH }));
  }
}

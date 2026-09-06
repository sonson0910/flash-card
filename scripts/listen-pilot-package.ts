import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
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
  assertOfflineMediaPackInstallable,
  type OfflineMediaPackManifestV1,
  type OfflineMediaPackPublicationContext,
} from '../src/features/offlineMedia/offlineMediaPack';
import {
  LISTEN_MVP_PILOT_LESSONS,
  LISTEN_MVP_PILOT_PUBLICATION,
  LISTEN_MVP_PILOT_REGISTRY,
} from '../src/features/listenMvp/listenMvpPilot';
import {
  parseListenMvpLessonV1,
  type ListenMvpLessonV1,
} from '../src/features/listenMvp/listenMvpContract';

export const LISTEN_MVP_PILOT_PACKAGE_PATH = 'media/listen-mvp/offline-pack.json';
const DEFAULT_PUBLIC_DIRECTORY = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const DEFAULT_SOURCE_DIRECTORY = DEFAULT_PUBLIC_DIRECTORY;
const DEFAULT_DEPLOY_DIRECTORY = path.resolve('dist');
const EXPECTED_CLIP_IDS = ['break-the-news', 'on-the-ball', 'fair-and-square'] as const;

export const LISTEN_MVP_PILOT_UNAVAILABLE = Object.freeze({
  status: 'unavailable' as const,
  reason: 'publication-evidence-missing' as const,
  message: 'Offline audio is unavailable until a reviewed, published release is approved.',
  clipIds: EXPECTED_CLIP_IDS,
});

export interface ListenMvpPilotPublicationBinding extends OfflineMediaPackPublicationContext {
  readonly status: 'published';
  readonly review: 'reviewed';
  readonly reviewerId: string;
  readonly publisherId: string;
  readonly reviewedAt: string;
  readonly publishedAt: string;
  readonly rightsPolicyUrl: string;
  readonly operatorAttestation: string;
}

export interface ListenMvpPilotAssetCheck {
  readonly clipId: string;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly sourceAssetSha256: string;
}

export type ListenMvpPilotPackageResult = typeof LISTEN_MVP_PILOT_UNAVAILABLE & {
  readonly assetChecks: readonly ListenMvpPilotAssetCheck[];
} | {
  readonly status: 'ready';
  readonly manifest: OfflineMediaPackManifestV1;
  readonly publication: ListenMvpPilotPublicationBinding;
  readonly assetChecks: readonly ListenMvpPilotAssetCheck[];
};

type ReadyListenMvpPilotPackage = Extract<ListenMvpPilotPackageResult, { readonly status: 'ready' }>;

export interface ListenMvpPilotPackageOptions {
  readonly sourceDirectory?: string;
  readonly registry?: CatalogSourceAssetRegistryV1;
  readonly lessons?: readonly ListenMvpLessonV1[];
  readonly publication?: ListenMvpPilotPublicationBinding | null;
}

export interface ListenMvpPilotManifestOptions {
  readonly sourceDirectory?: string;
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
const manifestDigest = (manifest: OfflineMediaPackManifestV1): string => digest(
  new TextEncoder().encode(JSON.stringify(parseOfflineMediaPackManifestV1(manifest))),
);

const canonicalReviewedAt = (value: unknown): string => {
  let canonical: string | undefined;
  try {
    canonical = typeof value === 'string' ? new Date(value).toISOString() : undefined;
  } catch {
    canonical = undefined;
  }
  if (typeof value !== 'string' || canonical !== value) {
    throw new ListenMvpPilotPackageError(
      'listen-pilot-approval-invalid',
      'Publication timestamps must be canonical UTC ISO-8601.',
    );
  }
  return value;
};

const validatePublication = (
  publication: ListenMvpPilotPublicationBinding,
): ListenMvpPilotPublicationBinding => {
  if (publication === null || typeof publication !== 'object'
    || publication.status !== 'published'
    || publication.review !== 'reviewed'
    || typeof publication.catalogId !== 'string'
    || typeof publication.releaseId !== 'string'
    || typeof publication.reviewerId !== 'string'
    || publication.reviewerId.length === 0
    || publication.reviewerId === 'unreviewed'
    || typeof publication.publisherId !== 'string'
    || publication.publisherId.length === 0
    || typeof publication.rightsPolicyUrl !== 'string'
    || publication.rightsPolicyUrl !== 'https://learningenglish.voanews.com/p/6861.html'
    || typeof publication.operatorAttestation !== 'string'
    || publication.operatorAttestation.length === 0
    || !/^[a-f0-9]{64}$/.test(publication.manifestSha256)) {
    throw new ListenMvpPilotPackageError(
      'listen-pilot-approval-invalid',
      'A trusted published/reviewed binding with reviewer, publisher, and manifest digest is required.',
    );
  }
  canonicalReviewedAt(publication.reviewedAt);
  canonicalReviewedAt(publication.publishedAt);
  return publication;
};

const within = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
};

const preparePilotAssets = async (options: ListenMvpPilotPackageOptions = {}) => {
  const registry = parseCatalogSourceAssetRegistryV1(options.registry ?? LISTEN_MVP_PILOT_REGISTRY);
  const lessonsInput = options.lessons ?? LISTEN_MVP_PILOT_LESSONS;
  const knownLexemeIds = new Set(lessonsInput.flatMap(lesson => lesson.chunk.lexemeIds));
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

  const sourceDirectory = path.resolve(options.sourceDirectory ?? DEFAULT_SOURCE_DIRECTORY);
  const assetChecks: ListenMvpPilotAssetCheck[] = [];
  for (const lesson of lessons) {
    const trustedAsset = registry.assets.find(asset => asset.sourceRef === lesson.clip.contentRights.sourceRef);
    if (trustedAsset === undefined || trustedAsset.sourceAssetSha256 === null) {
      throw new ListenMvpPilotPackageError(
        'listen-pilot-source-registry-invalid',
        `No trusted source checksum exists for ${lesson.clip.id}.`,
      );
    }
    const assetPath = path.resolve(sourceDirectory, lesson.clip.path);
    if (!within(sourceDirectory, assetPath)) {
      throw new ListenMvpPilotPackageError('listen-pilot-path-invalid', `Asset path escapes source/: ${lesson.clip.path}`);
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
  const publicationInput = options.publication === undefined
    ? LISTEN_MVP_PILOT_PUBLICATION
    : options.publication;
  if (publicationInput === null) {
    return { ...LISTEN_MVP_PILOT_UNAVAILABLE, assetChecks: prepared.assetChecks };
  }
  const publication = validatePublication(publicationInput);
  const manifest = manifestFromPrepared(
    prepared,
    publication.catalogId,
    publication.releaseId,
    publication.reviewedAt,
  );
  const canonicalDigest = manifestDigest(manifest);
  if (publication.manifestSha256 !== canonicalDigest) {
    throw new ListenMvpPilotPackageError(
      'listen-pilot-approval-digest-mismatch',
      'Publication approval does not match the canonical manifest digest.',
    );
  }
  await assertOfflineMediaPackInstallable(manifest, prepared.registry, { publication });
  return { status: 'ready', manifest, publication, assetChecks: prepared.assetChecks };
}

export async function writeListenMvpPilotPackage(
  result: ListenMvpPilotPackageResult,
  outputPath = path.resolve(DEFAULT_PUBLIC_DIRECTORY, LISTEN_MVP_PILOT_PACKAGE_PATH),
): Promise<void> {
  const payload = result.status === 'ready' ? result.manifest : result;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function verifyListenMvpPilotPackage(
  outputPath = path.resolve(DEFAULT_PUBLIC_DIRECTORY, LISTEN_MVP_PILOT_PACKAGE_PATH),
  deployDirectory = DEFAULT_DEPLOY_DIRECTORY,
): Promise<void> {
  const result = await buildListenMvpPilotPackage();
  if (result.status !== 'ready') {
    throw new ListenMvpPilotPackageError(
      'listen-pilot-deployable-manifest-missing',
      'A published Listen pilot manifest is required in deploy output.',
    );
  }
  await assertListenMvpPilotDeployOutputAgainst(deployDirectory, result);
  const expectedPayload = result.status === 'ready' ? result.manifest : result;
  const expected = `${JSON.stringify(expectedPayload, null, 2)}\n`;
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

const assertListenMvpPilotDeployOutputAgainst = async (
  deployDirectory: string,
  approved: ReadyListenMvpPilotPackage,
): Promise<void> => {
  const resolvedDeployDirectory = path.resolve(deployDirectory);
  const mediaDirectory = path.resolve(resolvedDeployDirectory, path.dirname(LISTEN_MVP_PILOT_PACKAGE_PATH));
  const manifestPath = path.resolve(resolvedDeployDirectory, LISTEN_MVP_PILOT_PACKAGE_PATH);
  let entries;
  try {
    entries = await readdir(mediaDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ListenMvpPilotPackageError(
        'listen-pilot-deployable-manifest-missing',
        `Published manifest is missing from deploy output: ${path.relative(resolvedDeployDirectory, manifestPath)}`,
      );
    }
    throw error;
  }
  const allowedPackageName = path.basename(LISTEN_MVP_PILOT_PACKAGE_PATH);
  const allowedNames = new Set([
    allowedPackageName,
    ...EXPECTED_CLIP_IDS.map(clipId => `${clipId}.m4a`),
  ]);
  for (const entry of entries) {
    if (entry.isFile() && allowedNames.has(entry.name)) continue;
    throw new ListenMvpPilotPackageError(
      'listen-pilot-deployable-candidate',
      `Unexpected unpublished media is present in deploy output: ${path.relative(resolvedDeployDirectory, path.join(mediaDirectory, entry.name))}`,
    );
  }

  let deployedManifestBytes: Buffer;
  try {
    deployedManifestBytes = await readFile(manifestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ListenMvpPilotPackageError(
        'listen-pilot-deployable-manifest-missing',
        `Published manifest is missing from deploy output: ${path.relative(resolvedDeployDirectory, manifestPath)}`,
      );
    }
    throw error;
  }
  const expectedManifestBytes = Buffer.from(`${JSON.stringify(approved.manifest, null, 2)}\n`, 'utf8');
  let deployedManifest: OfflineMediaPackManifestV1;
  try {
    deployedManifest = parseOfflineMediaPackManifestV1(JSON.parse(deployedManifestBytes.toString('utf8')));
  } catch {
    throw new ListenMvpPilotPackageError(
      'listen-pilot-deployable-manifest-invalid',
      `Published manifest is malformed: ${path.relative(resolvedDeployDirectory, manifestPath)}`,
    );
  }
  if (!deployedManifestBytes.equals(expectedManifestBytes)
    || JSON.stringify(deployedManifest) !== JSON.stringify(approved.manifest)) {
    throw new ListenMvpPilotPackageError(
      'listen-pilot-deployable-manifest-drift',
      `Deployed manifest differs from the approved canonical manifest: ${path.relative(resolvedDeployDirectory, manifestPath)}`,
    );
  }

  const names = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
  for (const expectedName of EXPECTED_CLIP_IDS.map(clipId => `${clipId}.m4a`)) {
    if (!names.has(expectedName)) {
      throw new ListenMvpPilotPackageError(
        'listen-pilot-deployable-audio-missing',
        `Published media is missing from deploy output: ${path.relative(resolvedDeployDirectory, path.join(mediaDirectory, expectedName))}`,
      );
    }
  }
  for (const check of approved.assetChecks) {
    const asset = approved.manifest.assets.find(candidate => candidate.clip.id === check.clipId);
    if (asset === undefined || asset.sha256 !== check.sha256 || asset.sha256 !== check.sourceAssetSha256) {
      throw new ListenMvpPilotPackageError(
        'listen-pilot-source-integrity-mismatch',
        `Approved source integrity is inconsistent for ${check.clipId}.`,
      );
    }
    const assetPath = path.resolve(resolvedDeployDirectory, asset.clip.path);
    let bytes: Buffer;
    try {
      bytes = await readFile(assetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ListenMvpPilotPackageError(
          'listen-pilot-deployable-audio-missing',
          `Published media is missing from deploy output: ${path.relative(resolvedDeployDirectory, assetPath)}`,
        );
      }
      throw error;
    }
    if (bytes.byteLength !== asset.clip.byteLength
      || bytes.byteLength !== check.bytes
      || digest(bytes) !== asset.sha256) {
      throw new ListenMvpPilotPackageError(
        'listen-pilot-deployable-audio-integrity-mismatch',
        `Published media does not match the approved bytes for ${check.clipId}.`,
      );
    }
  }
};

export async function assertListenMvpPilotDeployOutput(
  deployDirectory = DEFAULT_DEPLOY_DIRECTORY,
): Promise<void> {
  const result = await buildListenMvpPilotPackage();
  if (result.status !== 'ready') {
    throw new ListenMvpPilotPackageError(
      'listen-pilot-deployable-manifest-missing',
      'A published Listen pilot manifest is required in deploy output.',
    );
  }
  await assertListenMvpPilotDeployOutputAgainst(deployDirectory, result);
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

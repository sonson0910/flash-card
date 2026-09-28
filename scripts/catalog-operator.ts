import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  CATALOG_PIPELINE_LIMITS,
  type CatalogLexemeCandidateV1,
  type CatalogMembershipCandidateV1,
  type CatalogReviewerAuthorityV1,
  type CatalogSourceBundleV1,
  type CatalogReleaseManifest,
} from '../src/features/catalogPipeline/catalogContracts';
import {
  buildCatalogRelease,
  fingerprintCatalogSourceBundle,
  sha256Hex,
  type BuiltCatalogRelease,
  type CatalogReleaseBuildResult,
} from '../src/features/catalogPipeline/catalogBuilder';
import {
  parseCatalogChunkV1,
  parseCatalogReleaseManifestV1,
  parseCatalogReleaseManifestV2,
  parseCatalogSourceManifest,
  parseCatalogUnitDescriptorsV1,
  validateCatalogSourceBundle,
} from '../src/features/catalogPipeline/catalogValidation';
import {
  installCatalogRelease,
  type CatalogCacheInstallationPort,
} from '../src/features/catalogCache/catalogDelivery';

const MANIFEST_BYTES = 64 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface CatalogOperatorReport {
  readonly status: 'accepted' | 'built' | 'verified' | 'rejected';
  readonly catalogId?: string;
  readonly releaseId?: string;
  readonly lexemes?: number;
  readonly memberships?: number;
  readonly chunks?: number;
  readonly sourceDigest?: string;
  readonly reason?: string;
  readonly issues?: readonly unknown[];
}

const within = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const readBoundedFile = async (filePath: string, maximumBytes: number): Promise<Uint8Array> => {
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new TypeError('Catalog input must be a regular file.');
    if (stats.size > maximumBytes) throw new RangeError(`Catalog input exceeds ${maximumBytes} bytes.`);
    const buffer = new Uint8Array(stats.size + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumBytes) throw new RangeError(`Catalog input exceeds ${maximumBytes} bytes.`);
    return buffer.slice(0, offset);
  } finally {
    await handle.close();
  }
};

const safeRoot = async (manifestPath: string): Promise<{ manifestPath: string; root: string }> => {
  const absolute = path.resolve(manifestPath);
  if ((await lstat(absolute)).isSymbolicLink()) throw new TypeError('Catalog manifest must not be a symbolic link.');
  const resolved = await realpath(absolute);
  return { manifestPath: resolved, root: await realpath(path.dirname(resolved)) };
};

const safeRelativeFile = async (root: string, relativePath: string): Promise<string> => {
  let current = root;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new TypeError(`Catalog input path ${relativePath} contains a symbolic link.`);
    }
  }
  const resolved = await realpath(current);
  if (!within(root, resolved)) throw new TypeError(`Catalog input path ${relativePath} escapes its manifest directory.`);
  return resolved;
};

const json = (bytes: Uint8Array, label: string): unknown => {
  try {
    return JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    throw new TypeError(`${label} must contain valid UTF-8 JSON.`);
  }
};

const jsonLines = <T>(bytes: Uint8Array, label: string, maximumItems: number): readonly T[] => {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new TypeError(`${label} must contain valid UTF-8 JSONL.`);
  }
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  if (lines.length > maximumItems || lines.some(line => line.length === 0)) {
    throw new RangeError(`${label} contains too many records or an empty JSONL record.`);
  }
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch {
      throw new TypeError(`${label}:${index + 1} must contain valid JSON.`);
    }
  });
};

export async function loadCatalogSource(manifestInputPath: string): Promise<CatalogSourceBundleV1> {
  const source = await safeRoot(manifestInputPath);
  const manifest = parseCatalogSourceManifest(json(
    await readBoundedFile(source.manifestPath, MANIFEST_BYTES),
    'Catalog source manifest',
  ));
  let totalBytes = 0;
  const readFiles = async <T>(files: readonly string[], label: string, maximumItems: number): Promise<readonly T[]> => {
    const records: T[] = [];
    for (const relativePath of files) {
      const filePath = await safeRelativeFile(source.root, relativePath);
      const remaining = CATALOG_PIPELINE_LIMITS.maximumReleaseBytes - totalBytes;
      if (remaining < 1) throw new RangeError('Catalog source exceeds the total byte limit.');
      const bytes = await readBoundedFile(filePath, remaining);
      totalBytes += bytes.byteLength;
      records.push(...jsonLines<T>(bytes, `${label} ${relativePath}`, maximumItems - records.length));
    }
    return records;
  };
  const lexemes = await readFiles<CatalogLexemeCandidateV1>(
    manifest.lexemeFiles,
    'Lexeme source',
    CATALOG_PIPELINE_LIMITS.maximumLexemes,
  );
  const memberships = await readFiles<CatalogMembershipCandidateV1>(
    manifest.membershipFiles,
    'Membership source',
    CATALOG_PIPELINE_LIMITS.maximumReleaseMemberships,
  );
  if (manifest.manifestVersion === 1) return { manifest, lexemes, memberships };
  const descriptorPath = await safeRelativeFile(source.root, manifest.unitDescriptorFile);
  const remaining = CATALOG_PIPELINE_LIMITS.maximumReleaseBytes - totalBytes;
  if (remaining < 1) throw new RangeError('Catalog source exceeds the total byte limit.');
  const descriptorBytes = await readBoundedFile(descriptorPath, remaining);
  return {
    manifest,
    lexemes,
    memberships,
    unitDescriptors: parseCatalogUnitDescriptorsV1(json(descriptorBytes, 'Unit descriptor source')),
  };
}

export async function validateCatalogFiles(inputPath: string): Promise<CatalogOperatorReport> {
  const source = await loadCatalogSource(inputPath);
  const result = validateCatalogSourceBundle(source);
  if (result.status === 'quarantined') return { status: 'rejected', reason: 'invalid-source', issues: result.issues };
  return {
    status: 'accepted',
    catalogId: result.catalog.manifest.catalogId,
    lexemes: result.catalog.lexemes.length,
    memberships: result.catalog.memberships.length,
    sourceDigest: await fingerprintCatalogSourceBundle(result.catalog),
  };
}

export interface AtomicArtifactHooks {
  readonly beforeWrite?: (relativePath: string, ordinal: number) => Promise<void>;
}

const verificationCache: CatalogCacheInstallationPort = {
  begin: async descriptor => ({
    catalogId: descriptor.catalogId,
    releaseId: descriptor.releaseId,
    releaseKey: `${descriptor.catalogId}:${descriptor.releaseId}`,
    installId: 'read-only-verification',
  }),
  stage: async () => 'staged',
  activate: async () => undefined,
};

export async function writeBuiltReleaseAtomic(
  artifact: BuiltCatalogRelease,
  outputDirectory: string,
  hooks: AtomicArtifactHooks = {},
): Promise<void> {
  const output = path.resolve(outputDirectory);
  await mkdir(path.dirname(output), { recursive: true });
  try {
    await lstat(output);
    throw new Error('Catalog output directory already exists; refusing to overwrite it.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = await mkdtemp(path.join(path.dirname(output), `.${path.basename(output)}.tmp-`));
  try {
    const files = [
      { relativePath: 'release-manifest.json', bytes: artifact.manifestBytes },
      ...artifact.chunks.map(chunk => ({ relativePath: chunk.descriptor.path, bytes: chunk.bytes })),
    ];
    for (let index = 0; index < files.length; index += 1) {
      const item = files[index];
      await hooks.beforeWrite?.(item.relativePath, index);
      const target = path.resolve(temporary, item.relativePath);
      if (!within(temporary, target)) throw new TypeError('Catalog artifact path escapes the output directory.');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, item.bytes, { flag: 'wx' });
    }
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function buildCatalogFiles(
  inputPath: string,
  outputDirectory: string,
  reviewerAuthority: CatalogReviewerAuthorityV1,
  previousManifestPath?: string,
  initialRelease = false,
): Promise<CatalogOperatorReport> {
  const source = await loadCatalogSource(inputPath);
  const previous = previousManifestPath === undefined ? null : await loadReleaseArtifact(previousManifestPath);
  if (source.manifest.manifestVersion === 2 && previous === null && !initialRelease) {
    return { status: 'rejected', reason: 'lineage-proof-required' };
  }
  if (previous !== null && initialRelease) return { status: 'rejected', reason: 'invalid-lineage-options' };
  if (previous !== null && (
    previous.manifest.catalogId !== source.manifest.catalogId
    || previous.manifest.contentLanguage !== source.manifest.contentLanguage
  )) return { status: 'rejected', reason: 'incompatible-lineage' };
  const result: CatalogReleaseBuildResult = await buildCatalogRelease(source, {
    sequence: previous === null ? 1 : previous.manifest.sequence + 1,
    previousReleaseId: previous?.manifest.releaseId ?? null,
    ...(previous === null ? {} : { compatiblePreviousMemberships: previous.memberships }),
    reviewerAuthority,
  });
  if (result.status === 'rejected') {
    return { status: 'rejected', reason: result.reason, issues: result.path ? [{ path: result.path }] : undefined };
  }
  await writeBuiltReleaseAtomic(result.artifact, outputDirectory);
  return {
    status: 'built',
    catalogId: result.artifact.manifest.catalogId,
    releaseId: result.artifact.manifest.releaseId,
    lexemes: result.artifact.manifest.counts.lexemes,
    memberships: result.artifact.manifest.counts.memberships,
    chunks: result.artifact.manifest.counts.chunks,
  };
}

const parseCatalogReleaseManifest = (value: unknown): CatalogReleaseManifest => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Catalog release manifest must be an object.');
  }
  const manifestVersion = (value as Record<string, unknown>).manifestVersion;
  if (manifestVersion === 1) return parseCatalogReleaseManifestV1(value);
  if (manifestVersion === 2) return parseCatalogReleaseManifestV2(value);
  throw new TypeError('Catalog release manifest must use version 1 or 2.');
};

const loadReleaseArtifact = async (manifestInputPath: string): Promise<{
  manifest: CatalogReleaseManifest;
  memberships: readonly import('../src/features/multilingual/schemaV3').TrackMembershipV3[];
}> => {
  const source = await safeRoot(manifestInputPath);
  const manifest = parseCatalogReleaseManifest(json(
    await readBoundedFile(source.manifestPath, MANIFEST_BYTES),
    'Catalog release manifest',
  ));
  await installCatalogRelease(manifest, {
    fetchChunk: async relativePath => readBoundedFile(
      await safeRelativeFile(source.root, relativePath),
      CATALOG_PIPELINE_LIMITS.maximumChunkBytes,
    ),
  }, verificationCache);
  const memberships = [] as import('../src/features/multilingual/schemaV3').TrackMembershipV3[];
  for (const descriptor of manifest.chunks) {
    const bytes = await readBoundedFile(
      await safeRelativeFile(source.root, descriptor.path),
      CATALOG_PIPELINE_LIMITS.maximumChunkBytes,
    );
    if (await sha256Hex(bytes) !== descriptor.sha256) throw new TypeError('Catalog chunk SHA-256 does not match manifest.');
    memberships.push(...parseCatalogChunkV1(json(bytes, `Catalog chunk ${descriptor.id}`), {
      expectedReleaseId: manifest.releaseId,
      expectedOrdinal: descriptor.ordinal,
      expectedLexemeCount: descriptor.lexemeCount,
      expectedMembershipCount: descriptor.membershipCount,
    }).memberships);
  }
  if (manifest.manifestVersion === 2) {
    const descriptorByKey = new Map(manifest.unitDescriptors.map(descriptor => [
      `${descriptor.trackId}\u0000${descriptor.unitId}`,
      descriptor,
    ]));
    const ranksByUnit = new Map<string, number[]>();
    for (const membership of memberships) {
      const key = `${membership.trackId}\u0000${membership.lessonGroup}`;
      if (descriptorByKey.get(key)?.tier !== membership.tier) {
        throw new TypeError('Catalog V2 membership does not match a unit descriptor.');
      }
      ranksByUnit.set(key, [...(ranksByUnit.get(key) ?? []), membership.rank]);
    }
    if (manifest.unitDescriptors.some(descriptor => !ranksByUnit.has(`${descriptor.trackId}\u0000${descriptor.unitId}`))) {
      throw new TypeError('Catalog V2 descriptor has no membership.');
    }
    for (const ranks of ranksByUnit.values()) {
      const ordered = [...ranks].sort((left, right) => left - right);
      if (ordered.some((rank, index) => index > 0 && rank === ordered[index - 1])) {
        throw new TypeError('Catalog V2 memberships must have unique ranks within a unit.');
      }
      if (ordered.length > CATALOG_PIPELINE_LIMITS.maximumUnitMemberships) {
        throw new TypeError('Catalog V2 units may contain at most 20 memberships.');
      }
    }
  }
  return { manifest, memberships };
};

export async function verifyCatalogFiles(manifestInputPath: string): Promise<CatalogOperatorReport> {
  const result = await loadReleaseArtifact(manifestInputPath);
  return {
    status: 'verified',
    catalogId: result.manifest.catalogId,
    releaseId: result.manifest.releaseId,
    memberships: result.memberships.length,
    chunks: result.manifest.counts.chunks,
  };
}

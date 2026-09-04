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
  type CatalogSourceAssetRegistryV1,
  type CatalogSourceBundleV1,
} from '../src/features/catalogPipeline/catalogContracts';
import {
  buildCatalogRelease,
  fingerprintCatalogSourceBundle,
  type BuiltCatalogRelease,
  type CatalogReleaseBuildResult,
} from '../src/features/catalogPipeline/catalogBuilder';
import {
  parseCatalogReleaseManifestV1,
  parseCatalogSourceAssetRegistryV1,
  parseCatalogSourceManifestV1,
  validateCatalogSourceBundle,
} from '../src/features/catalogPipeline/catalogValidation';
import { installCatalogRelease } from '../src/features/catalogCache/catalogDelivery';

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
  const manifest = parseCatalogSourceManifestV1(json(
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
  return { manifest, lexemes, memberships };
}

export async function loadCatalogSourceAssetRegistry(
  registryInputPath: string,
): Promise<CatalogSourceAssetRegistryV1> {
  const registry = await safeRoot(registryInputPath);
  return parseCatalogSourceAssetRegistryV1(json(
    await readBoundedFile(
      registry.manifestPath,
      CATALOG_PIPELINE_LIMITS.maximumSourceAssetRegistryBytes,
    ),
    'Catalog source asset registry',
  ));
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
  rightsInputPath: string,
  reviewerAuthority: CatalogReviewerAuthorityV1,
): Promise<CatalogOperatorReport> {
  const source = await loadCatalogSource(inputPath);
  const trustedAssetRegistry = await loadCatalogSourceAssetRegistry(rightsInputPath);
  const result: CatalogReleaseBuildResult = await buildCatalogRelease(source, {
    sequence: 1,
    previousReleaseId: null,
    reviewerAuthority,
    trustedAssetRegistry,
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

export async function verifyCatalogFiles(manifestInputPath: string): Promise<CatalogOperatorReport> {
  const source = await safeRoot(manifestInputPath);
  const manifest = parseCatalogReleaseManifestV1(json(
    await readBoundedFile(source.manifestPath, MANIFEST_BYTES),
    'Catalog release manifest',
  ));
  const result = await installCatalogRelease(manifest, {
    fetchChunk: async relativePath => readBoundedFile(
      await safeRelativeFile(source.root, relativePath),
      CATALOG_PIPELINE_LIMITS.maximumChunkBytes,
    ),
  }, {
    begin: async descriptor => ({
      catalogId: descriptor.catalogId,
      releaseId: descriptor.releaseId,
      releaseKey: `${descriptor.catalogId}:${descriptor.releaseId}`,
      installId: 'read-only-verification',
    }),
    stage: async () => 'staged',
    activate: async () => undefined,
  });
  return {
    status: 'verified',
    catalogId: result.catalogId,
    releaseId: result.releaseId,
    memberships: result.installedMemberships,
    chunks: manifest.counts.chunks,
  };
}

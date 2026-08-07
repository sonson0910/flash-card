import { mapWithConcurrency } from '../../lib/asyncPool';
import {
  type CatalogChunkDescriptorV1,
  type CatalogChunkV1,
  type CatalogReleaseManifestV1,
} from '../catalogPipeline/catalogContracts';
import {
  parseCatalogChunkV1,
  parseCatalogReleaseManifestV1,
} from '../catalogPipeline/catalogValidation';
import {
  canonicalizeLexemeIdentity,
  canonicalizeTrackMembershipIdentity,
} from '../multilingual/lexemeIdentity';
import type { LexemeV3, TrackMembershipV3 } from '../multilingual/schemaV3';
import {
  activateCatalogInstall,
  beginCatalogInstall,
  stageCatalogChunk,
  type CatalogCacheEntry,
  type CatalogChunkReceipt,
  type CatalogInstallHandle,
  type CatalogReleaseDescriptor,
} from './catalogCache';

const FETCH_CONCURRENCY = 3;

export interface CatalogChunkFetchPort {
  /** Receives only a manifest-validated same-origin relative path. */
  fetchChunk(path: string): Promise<Uint8Array>;
}

export interface CatalogCacheInstallationPort {
  begin(descriptor: CatalogReleaseDescriptor): Promise<CatalogInstallHandle>;
  stage(
    handle: CatalogInstallHandle,
    receipt: CatalogChunkReceipt,
    entries: readonly CatalogCacheEntry[],
    lexemes: readonly LexemeV3[],
  ): Promise<'staged' | 'already-staged'>;
  activate(handle: CatalogInstallHandle): Promise<void>;
}

export interface CatalogReleaseInstallResult {
  readonly catalogId: string;
  readonly releaseId: string;
  readonly installedMemberships: number;
}

interface VerifiedChunk {
  readonly descriptor: CatalogChunkDescriptorV1;
  readonly value: CatalogChunkV1;
}

const browserCachePort: CatalogCacheInstallationPort = {
  begin: beginCatalogInstall,
  stage: stageCatalogChunk,
  activate: activateCatalogInstall,
};

const digestBytes = async (bytes: Uint8Array): Promise<string> => {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto SHA-256 is unavailable.');
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
  return Array.from(digest).map(value => value.toString(16).padStart(2, '0')).join('');
};

const decodeChunk = (bytes: Uint8Array, descriptor: CatalogChunkDescriptorV1): unknown => {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Catalog chunk ${descriptor.id} is not valid UTF-8.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Catalog chunk ${descriptor.id} is not valid JSON.`);
  }
};

const fetchAndVerifyChunk = async (
  manifest: CatalogReleaseManifestV1,
  descriptor: CatalogChunkDescriptorV1,
  source: CatalogChunkFetchPort,
): Promise<VerifiedChunk> => {
  const fetched = await source.fetchChunk(descriptor.path);
  if (!(fetched instanceof Uint8Array)) throw new TypeError(`Catalog chunk ${descriptor.id} did not return bytes.`);
  // Copy the untrusted buffer so a source adapter cannot mutate it between
  // digest verification and strict decoding.
  const bytes = fetched.slice();
  if (bytes.byteLength !== descriptor.byteLength) {
    throw new Error(`Catalog chunk ${descriptor.id} byte length does not match its descriptor.`);
  }
  const actualDigest = await digestBytes(bytes);
  if (actualDigest !== descriptor.sha256) {
    throw new Error(`Catalog chunk ${descriptor.id} SHA-256 does not match its descriptor.`);
  }
  const value = parseCatalogChunkV1(decodeChunk(bytes, descriptor), {
    expectedReleaseId: manifest.releaseId,
    expectedOrdinal: descriptor.ordinal,
    expectedLexemeCount: descriptor.lexemeCount,
    expectedMembershipCount: descriptor.membershipCount,
  });
  return { descriptor, value };
};

const lexemeIdentity = (value: LexemeV3): string => {
  const identity = canonicalizeLexemeIdentity(value);
  return JSON.stringify([
    identity.language,
    identity.normalizedLemma,
    identity.partOfSpeech,
    identity.senseKey,
  ]);
};

const membershipIdentity = (value: TrackMembershipV3): string => {
  const identity = canonicalizeTrackMembershipIdentity(value);
  return JSON.stringify([identity.trackId, identity.lexemeId]);
};

const assertUnique = (
  values: readonly string[],
  label: string,
): void => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Catalog release contains a duplicate ${label}.`);
    seen.add(value);
  }
};

const sameStringSet = (left: readonly string[], right: readonly string[]): boolean => (
  left.length === right.length
  && left.every(value => right.includes(value))
);

const validateReleaseGraph = (
  manifest: CatalogReleaseManifestV1,
  chunks: readonly VerifiedChunk[],
): ReadonlyMap<string, LexemeV3> => {
  if (chunks.length === 0 || manifest.counts.memberships === 0) {
    throw new Error('Catalog release must contain at least one membership.');
  }
  if (chunks.some(chunk => chunk.value.memberships.length === 0)) {
    throw new Error('Catalog delivery requires at least one membership in every chunk.');
  }
  const lexemes = chunks.flatMap(chunk => chunk.value.lexemes);
  const memberships = chunks.flatMap(chunk => chunk.value.memberships);
  assertUnique(lexemes.map(value => value.id), 'lexeme ID');
  assertUnique(lexemes.map(lexemeIdentity), 'lexeme identity');
  assertUnique(memberships.map(value => value.id), 'membership ID');
  assertUnique(memberships.map(membershipIdentity), 'membership identity');
  const lexemesById = new Map(lexemes.map(value => [value.id, value]));
  for (const value of lexemes) {
    if (value.language !== manifest.contentLanguage) {
      throw new Error(`Lexeme ${value.id} does not match the release content language.`);
    }
    if (value.provenance.editorialStatus !== 'published') {
      throw new Error(`Lexeme ${value.id} must be published before delivery.`);
    }
    const license = value.provenance.license.toLowerCase();
    const reviewer = value.provenance.reviewer.toLowerCase();
    if (
      license === 'noassertion'
      || license === 'non-publishable'
      || reviewer === 'unreviewed'
      || reviewer === 'unassigned'
    ) {
      throw new Error(`Lexeme ${value.id} lacks publishable provenance evidence.`);
    }
  }
  for (const value of memberships) {
    if (!lexemesById.has(value.lexemeId)) {
      throw new Error(`Membership ${value.id} references a missing lexeme.`);
    }
    if (value.editorialStatus !== 'published') {
      throw new Error(`Membership ${value.id} must be published before delivery.`);
    }
  }
  for (const chunk of chunks) {
    const actualTrackIds = [...new Set(chunk.value.memberships.map(value => value.trackId))];
    if (!sameStringSet(chunk.descriptor.trackIds, actualTrackIds)) {
      throw new Error(`Catalog chunk ${chunk.descriptor.id} trackIds do not match its memberships.`);
    }
  }
  return lexemesById;
};

const cacheEntry = (
  membership: TrackMembershipV3,
  lexeme: LexemeV3,
): CatalogCacheEntry => ({
  membershipId: membership.id,
  lexemeId: membership.lexemeId,
  language: lexeme.language,
  trackId: membership.trackId,
  tier: membership.tier,
  cefrLevel: membership.cefrLevel,
  topic: membership.topic,
  partOfSpeech: lexeme.partOfSpeech,
  skills: [...membership.skills],
  rank: membership.rank,
  normalizedLemma: lexeme.normalizedLemma,
  lemma: lexeme.lemma,
});

export async function installCatalogRelease(
  manifestInput: unknown,
  source: CatalogChunkFetchPort,
  cache: CatalogCacheInstallationPort = browserCachePort,
): Promise<CatalogReleaseInstallResult> {
  const manifest = parseCatalogReleaseManifestV1(manifestInput);
  const chunks = await mapWithConcurrency(
    manifest.chunks,
    FETCH_CONCURRENCY,
    descriptor => fetchAndVerifyChunk(manifest, descriptor, source),
  );
  const lexemesById = validateReleaseGraph(manifest, chunks);
  const descriptor: CatalogReleaseDescriptor = {
    catalogId: manifest.catalogId,
    releaseId: manifest.releaseId,
    schemaVersion: manifest.manifestVersion,
    contentLanguage: manifest.contentLanguage,
    chunkCount: manifest.counts.chunks,
    lexemeCount: manifest.counts.lexemes,
    membershipCount: manifest.counts.memberships,
    encodedBytes: manifest.counts.encodedBytes,
  };
  const handle = await cache.begin(descriptor);
  for (const chunk of chunks) {
    const entries = chunk.value.memberships.map(value => cacheEntry(
      value,
      lexemesById.get(value.lexemeId) as LexemeV3,
    ));
    await cache.stage(handle, {
      chunkId: chunk.descriptor.id,
      sha256: chunk.descriptor.sha256,
      lexemeCount: chunk.descriptor.lexemeCount,
      membershipCount: chunk.descriptor.membershipCount,
      encodedBytes: chunk.descriptor.byteLength,
    }, entries, chunk.value.lexemes);
  }
  await cache.activate(handle);
  return {
    catalogId: manifest.catalogId,
    releaseId: manifest.releaseId,
    installedMemberships: manifest.counts.memberships,
  };
}

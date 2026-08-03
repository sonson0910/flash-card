import { describe, expect, it } from 'vitest';
import { createLexemeId, createTrackMembershipId } from '../multilingual/lexemeIdentity';
import type { LexemeV3, TrackMembershipV3 } from '../multilingual/schemaV3';
import type { CatalogChunkV1, CatalogReleaseManifestV1 } from '../catalogPipeline/catalogContracts';
import type {
  CatalogCacheEntry,
  CatalogChunkReceipt,
  CatalogInstallHandle,
  CatalogReleaseDescriptor,
} from './catalogCache';
import {
  installCatalogRelease,
  type CatalogCacheInstallationPort,
  type CatalogChunkFetchPort,
} from './catalogDelivery';

const now = '2026-08-03T00:00:00.000Z';
const encoder = new TextEncoder();

const lexeme = (index: number): LexemeV3 => {
  const identity = {
    language: 'en', normalizedLemma: `word ${index}`, partOfSpeech: 'noun', senseKey: 'primary',
  };
  return {
    schemaVersion: 3,
    id: createLexemeId(identity),
    ...identity,
    lemma: `Word ${index}`,
    definitions: [{ language: 'vi', text: `Nghia ${index}` }],
    phonetics: [], examples: [], collocations: [], wordFamily: [],
    media: { audioUrl: null, imageUrl: null },
    compatibility: {
      legacyPartOfSpeech: 'noun', translation: `Nghia ${index}`, explanation: '', explanationTranslation: '',
      emoji: '', exampleSentence: '', exampleTranslation: '', synonyms: [], antonyms: [], register: '', commonMistake: '',
    },
    provenance: {
      source: 'licensed-editorial', license: 'CC-BY-4.0', reviewer: 'reviewer-1', editorialStatus: 'published',
    },
    contentVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
};

const membership = (item: LexemeV3, index: number, trackId = 'general'): TrackMembershipV3 => ({
  schemaVersion: 3,
  id: createTrackMembershipId({ trackId, lexemeId: item.id }),
  lexemeId: item.id,
  trackId,
  tier: 'foundation',
  cefrLevel: 'A1',
  topic: 'basics',
  legacyCategory: 'General',
  skills: ['reading'],
  rank: index,
  lessonGroup: 'pilot-1',
  editorialStatus: 'published',
  contentVersion: 1,
});

const chunk = (ordinal: number, item = lexeme(ordinal)): CatalogChunkV1 => ({
  formatVersion: 1,
  releaseId: 'english-release-1',
  ordinal,
  lexemes: [item],
  memberships: [membership(item, ordinal)],
});

const digest = async (bytes: Uint8Array): Promise<string> => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
).map(value => value.toString(16).padStart(2, '0')).join('');

const releaseFixture = async (chunks: readonly CatalogChunkV1[]) => {
  const bytes = await Promise.all(chunks.map(value => Promise.resolve(encoder.encode(JSON.stringify(value)))));
  const descriptors = await Promise.all(bytes.map(async (value, ordinal) => ({
    id: `chunk-${String(ordinal).padStart(4, '0')}`,
    ordinal,
    path: `english-release-1/chunk-${String(ordinal).padStart(4, '0')}.json`,
    sha256: await digest(value),
    byteLength: value.byteLength,
    lexemeCount: chunks[ordinal].lexemes.length,
    membershipCount: chunks[ordinal].memberships.length,
    trackIds: [...new Set(chunks[ordinal].memberships.map(value => value.trackId))],
  })));
  const manifest: CatalogReleaseManifestV1 = {
    manifestVersion: 1,
    catalogId: 'english-pilot',
    releaseId: 'english-release-1',
    sequence: 1,
    contentLanguage: 'en',
    supportLanguages: ['vi'],
    createdAt: now,
    previousReleaseId: null,
    counts: {
      lexemes: descriptors.reduce((total, value) => total + value.lexemeCount, 0),
      memberships: descriptors.reduce((total, value) => total + value.membershipCount, 0),
      chunks: descriptors.length,
      encodedBytes: descriptors.reduce((total, value) => total + value.byteLength, 0),
    },
    chunks: descriptors,
  };
  return { manifest, bytes };
};

const cacheFake = () => {
  const staged: { receipt: CatalogChunkReceipt; entries: readonly CatalogCacheEntry[] }[] = [];
  let active = 'old-release';
  let begins = 0;
  const handle: CatalogInstallHandle = {
    catalogId: 'english-pilot', releaseId: 'english-release-1', releaseKey: 'new-key', installId: 'install-1',
  };
  const port: CatalogCacheInstallationPort = {
    begin: async (_descriptor: CatalogReleaseDescriptor) => { begins += 1; return handle; },
    stage: async (_handle, receipt, entries) => {
      staged.push({ receipt, entries });
      return 'staged';
    },
    activate: async () => { active = 'english-release-1'; },
  };
  return { port, staged, active: () => active, begun: () => begins };
};

describe('catalog release delivery', () => {
  it('fetches with concurrency at most three, verifies bytes and activates denormalized entries', async () => {
    const fixture = await releaseFixture([chunk(0), chunk(1), chunk(2), chunk(3)]);
    let inFlight = 0;
    let maximumInFlight = 0;
    const source: CatalogChunkFetchPort = {
      fetchChunk: async path => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 1));
        const ordinal = fixture.manifest.chunks.find(value => value.path === path)?.ordinal ?? -1;
        inFlight -= 1;
        return fixture.bytes[ordinal];
      },
    };
    const cache = cacheFake();

    const result = await installCatalogRelease(fixture.manifest, source, cache.port);

    expect(result).toEqual({ catalogId: 'english-pilot', releaseId: 'english-release-1', installedMemberships: 4 });
    expect(maximumInFlight).toBe(3);
    expect(cache.staged).toHaveLength(4);
    expect(cache.begun()).toBe(1);
    expect(cache.staged[0].entries[0]).toMatchObject({
      language: 'en', trackId: 'general', normalizedLemma: 'word 0', partOfSpeech: 'noun',
    });
    expect(cache.active()).toBe('english-release-1');
  });

  it('rejects unsafe manifest paths before invoking the fetch port', async () => {
    const fixture = await releaseFixture([chunk(0)]);
    let fetches = 0;
    const source: CatalogChunkFetchPort = { fetchChunk: async () => { fetches += 1; return fixture.bytes[0]; } };
    const cache = cacheFake();

    await expect(installCatalogRelease({
      ...fixture.manifest,
      chunks: [{ ...fixture.manifest.chunks[0], path: 'https://evil.example/chunk.json' }],
    }, source, cache.port)).rejects.toThrow();

    expect(fetches).toBe(0);
    expect(cache.active()).toBe('old-release');
  });

  it.each(['byte-length', 'sha256'] as const)('rejects a %s mismatch without changing active', async failure => {
    const fixture = await releaseFixture([chunk(0)]);
    const descriptor = fixture.manifest.chunks[0];
    const byteLength = failure === 'byte-length' ? descriptor.byteLength + 1 : descriptor.byteLength;
    const manifest = {
      ...fixture.manifest,
      counts: { ...fixture.manifest.counts, encodedBytes: byteLength },
      chunks: [{
        ...descriptor,
        byteLength,
        sha256: failure === 'sha256' ? '0'.repeat(64) : descriptor.sha256,
      }],
    };
    const cache = cacheFake();

    await expect(installCatalogRelease(
      manifest,
      { fetchChunk: async () => fixture.bytes[0] },
      cache.port,
    )).rejects.toThrow(failure === 'byte-length' ? 'byte length' : 'SHA-256');

    expect(cache.staged).toEqual([]);
    expect(cache.begun()).toBe(0);
    expect(cache.active()).toBe('old-release');
  });

  it('uses fatal UTF-8 and strict JSON parsing before touching the cache', async () => {
    const fixture = await releaseFixture([chunk(0)]);
    const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
    const invalidDigest = await digest(invalidUtf8);
    const manifest = {
      ...fixture.manifest,
      counts: { ...fixture.manifest.counts, encodedBytes: invalidUtf8.byteLength },
      chunks: [{ ...fixture.manifest.chunks[0], byteLength: invalidUtf8.byteLength, sha256: invalidDigest }],
    };
    const cache = cacheFake();

    await expect(installCatalogRelease(
      manifest,
      { fetchChunk: async () => invalidUtf8 },
      cache.port,
    )).rejects.toThrow('UTF-8');
    expect(cache.staged).toEqual([]);
  });

  it('rejects duplicate entities and missing references across chunk boundaries', async () => {
    const repeated = lexeme(1);
    const duplicateFixture = await releaseFixture([chunk(0, repeated), chunk(1, repeated)]);
    const cache = cacheFake();
    await expect(installCatalogRelease(
      duplicateFixture.manifest,
      { fetchChunk: async path => duplicateFixture.bytes[duplicateFixture.manifest.chunks.find(value => value.path === path)?.ordinal ?? -1] },
      cache.port,
    )).rejects.toThrow('duplicate lexeme');
    expect(cache.active()).toBe('old-release');

    const absent = lexeme(99);
    const local = lexeme(2);
    const missingReferenceChunk: CatalogChunkV1 = {
      ...chunk(0, local),
      memberships: [membership(absent, 0)],
    };
    const missingFixture = await releaseFixture([missingReferenceChunk]);
    await expect(installCatalogRelease(
      missingFixture.manifest,
      { fetchChunk: async () => missingFixture.bytes[0] },
      cache.port,
    )).rejects.toThrow('missing lexeme');
    expect(cache.staged).toEqual([]);
  });

  it('rejects draft content and descriptor track drift before staging', async () => {
    const item = lexeme(0);
    const draftFixture = await releaseFixture([{
      ...chunk(0, item),
      lexemes: [{ ...item, provenance: { ...item.provenance, editorialStatus: 'draft' } }],
    }]);
    const cache = cacheFake();
    await expect(installCatalogRelease(
      draftFixture.manifest,
      { fetchChunk: async () => draftFixture.bytes[0] },
      cache.port,
    )).rejects.toThrow('published');

    const itemWithFalseEvidence = lexeme(1);
    const falseEvidenceFixture = await releaseFixture([{
      ...chunk(0, itemWithFalseEvidence),
      lexemes: [{
        ...itemWithFalseEvidence,
        provenance: { ...itemWithFalseEvidence.provenance, license: 'NOASSERTION', reviewer: 'unreviewed' },
      }],
    }]);
    await expect(installCatalogRelease(
      falseEvidenceFixture.manifest,
      { fetchChunk: async () => falseEvidenceFixture.bytes[0] },
      cache.port,
    )).rejects.toThrow('publishable provenance');

    const fixture = await releaseFixture([chunk(0)]);
    await expect(installCatalogRelease({
      ...fixture.manifest,
      chunks: [{ ...fixture.manifest.chunks[0], trackIds: ['ielts'] }],
    }, { fetchChunk: async () => fixture.bytes[0] }, cache.port)).rejects.toThrow('trackIds');
    expect(cache.staged).toEqual([]);
  });

  it('rejects membership-empty chunks before opening an install', async () => {
    const fixture = await releaseFixture([{ ...chunk(0), memberships: [] }, chunk(1)]);
    const cache = cacheFake();

    await expect(installCatalogRelease(
      fixture.manifest,
      { fetchChunk: async path => fixture.bytes[fixture.manifest.chunks.find(value => value.path === path)?.ordinal ?? -1] },
      cache.port,
    )).rejects.toThrow('every chunk');
    expect(cache.staged).toEqual([]);
    expect(cache.begun()).toBe(0);
    expect(cache.active()).toBe('old-release');
  });
});

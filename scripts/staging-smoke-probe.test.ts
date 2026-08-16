import { describe, expect, it } from 'vitest';
import {
  MAX_HEALTH_METADATA_BYTES,
  MAX_RELEASE_MANIFEST_BYTES,
  canonicalizeStagingOrigin,
  readStagingHealthMetadata,
  validateApplicationDocument,
  validateCatalogReleaseManifest,
} from './staging-smoke-probe';

const encoder = new TextEncoder();

const validHealth = JSON.stringify({
  status: 'ok',
  service: 'lingoflash',
  version: '1.0.0',
  revision: 'abc123',
  builtAt: '2026-08-16T00:00:00.000Z',
});

const validManifest = JSON.stringify({
  manifestVersion: 1,
  catalogId: 'english-pilot',
  releaseId: 'english-pilot-0001',
  sequence: 1,
  contentLanguage: 'en',
  supportLanguages: ['vi'],
  createdAt: '2026-08-16T00:00:00.000Z',
  previousReleaseId: null,
  counts: { lexemes: 1, memberships: 1, chunks: 1, encodedBytes: 100 },
  chunks: [{
    id: 'chunk-0001',
    ordinal: 0,
    path: 'english-pilot-0001/chunk-0001.json',
    sha256: 'a'.repeat(64),
    byteLength: 100,
    lexemeCount: 1,
    membershipCount: 1,
    trackIds: ['general'],
  }],
});

const jsonResponse = (body: BodyInit | null, headers: HeadersInit = {}): Response => new Response(body, {
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
});

const cancellableResponse = (headers: HeadersInit): { response: Response; cancelled: () => boolean } => {
  let wasCancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('body'));
    },
    cancel() {
      wasCancelled = true;
    },
  });
  return {
    response: new Response(body, { status: 200, headers }),
    cancelled: () => wasCancelled,
  };
};

describe('staging smoke probe', () => {
  it('canonicalizes a credential-free HTTPS root origin', () => {
    expect(canonicalizeStagingOrigin('https://staging.example.test/'))
      .toBe('https://staging.example.test');
  });

  it.each([
    'http://staging.example.test',
    'https://user@staging.example.test',
    'https://user:password@staging.example.test',
    'https://staging.example.test/health.json',
    'https://staging.example.test?mode=test',
    'https://staging.example.test#test',
    'not-a-url',
  ])('rejects a non-canonical staging origin: %s', value => {
    expect(() => canonicalizeStagingOrigin(value))
      .toThrow('STAGING_ORIGIN must be a canonical HTTPS origin.');
  });

  it('accepts an HTML application document and cancels its unused stream', async () => {
    const { response, cancelled } = cancellableResponse({ 'content-type': 'text/html; charset=utf-8' });
    await expect(validateApplicationDocument(response)).resolves.toBe(true);
    expect(cancelled()).toBe(true);
  });

  it('rejects and cancels an application response with the wrong media type', async () => {
    const { response, cancelled } = cancellableResponse({ 'content-type': 'text/plain' });
    await expect(validateApplicationDocument(response)).resolves.toBe(false);
    expect(cancelled()).toBe(true);
  });

  it('accepts exact bounded health metadata', async () => {
    await expect(readStagingHealthMetadata(jsonResponse(validHealth))).resolves.toMatchObject({
      status: 'ok',
      service: 'lingoflash',
      revision: 'abc123',
    });
  });

  it('accepts a health body at the byte limit and rejects limit plus one', async () => {
    const exact = validHealth.padEnd(MAX_HEALTH_METADATA_BYTES, ' ');
    const oversized = validHealth.padEnd(MAX_HEALTH_METADATA_BYTES + 1, ' ');
    await expect(readStagingHealthMetadata(jsonResponse(exact))).resolves.not.toBeNull();
    await expect(readStagingHealthMetadata(jsonResponse(oversized))).resolves.toBeNull();
  });

  it.each([
    ['wrong media type', { 'content-type': 'text/plain' }],
    ['gzip encoding', { 'content-encoding': 'gzip' }],
    ['Brotli encoding', { 'content-encoding': 'br' }],
    ['oversized declared length', { 'content-length': String(MAX_HEALTH_METADATA_BYTES + 1) }],
    ['malformed declared length', { 'content-length': '1e3' }],
  ])('rejects %s health metadata before trusting its body', async (_name, headers) => {
    await expect(readStagingHealthMetadata(jsonResponse(validHealth, headers))).resolves.toBeNull();
  });

  it('rejects malformed or schema-invalid health JSON', async () => {
    await expect(readStagingHealthMetadata(jsonResponse('{'))).resolves.toBeNull();
    await expect(readStagingHealthMetadata(jsonResponse(JSON.stringify({ revision: 'abc123' }))))
      .resolves.toBeNull();
  });

  it('accepts a valid catalog release manifest', async () => {
    await expect(validateCatalogReleaseManifest(jsonResponse(validManifest))).resolves.toBe(true);
  });

  it('rejects an HTML SPA fallback even when it carries a JSON media type', async () => {
    await expect(validateCatalogReleaseManifest(jsonResponse('<!doctype html><title>App</title>')))
      .resolves.toBe(false);
  });

  it('rejects malformed and schema-invalid catalog JSON', async () => {
    await expect(validateCatalogReleaseManifest(jsonResponse('{'))).resolves.toBe(false);
    await expect(validateCatalogReleaseManifest(jsonResponse('{}'))).resolves.toBe(false);
  });

  it('accepts a manifest at the byte limit and rejects limit plus one', async () => {
    const exact = validManifest.padEnd(MAX_RELEASE_MANIFEST_BYTES, ' ');
    const oversized = validManifest.padEnd(MAX_RELEASE_MANIFEST_BYTES + 1, ' ');
    await expect(validateCatalogReleaseManifest(jsonResponse(exact))).resolves.toBe(true);
    await expect(validateCatalogReleaseManifest(jsonResponse(oversized))).resolves.toBe(false);
  });

  it.each([
    ['missing media type', {}],
    ['wrong media type', { 'content-type': 'text/html' }],
    ['gzip encoding', { 'content-encoding': 'gzip' }],
    ['Brotli encoding', { 'content-encoding': 'br' }],
    ['oversized declared length', { 'content-length': String(MAX_RELEASE_MANIFEST_BYTES + 1) }],
  ])('rejects a manifest with %s', async (_name, headers) => {
    const response = new Response(validManifest, { status: 200, headers });
    await expect(validateCatalogReleaseManifest(response)).resolves.toBe(false);
  });

  it('rejects a declared length that does not match the decoded body', async () => {
    await expect(validateCatalogReleaseManifest(jsonResponse(validManifest, {
      'content-length': String(Buffer.byteLength(validManifest) + 1),
    }))).resolves.toBe(false);
  });

  it('cancels an oversized streaming manifest', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RELEASE_MANIFEST_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(validateCatalogReleaseManifest(response)).resolves.toBe(false);
    expect(cancelled).toBe(true);
  });

  it('fails closed when a response stream errors', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('transport failed'));
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(validateCatalogReleaseManifest(response)).resolves.toBe(false);
  });

  it('rejects and cancels a redirect response', async () => {
    const response = new Response(validManifest, {
      status: 302,
      headers: { location: 'https://other.example.test/catalog.json', 'content-type': 'application/json' },
    });
    await expect(validateCatalogReleaseManifest(response)).resolves.toBe(false);
    expect(response.bodyUsed).toBe(true);
  });
});

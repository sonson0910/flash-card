import { describe, expect, it } from 'vitest';
import { evaluateStagingSmoke } from '../src/features/releaseReadiness/operationalReadiness';
import { probeStagingSmoke, type StagingFetch } from './staging-smoke-probe';

const revision = 'a'.repeat(40);
const origin = 'https://staging.example.test';

const health = JSON.stringify({
  status: 'ok',
  service: 'lingoflash',
  version: '1.0.0',
  revision,
  builtAt: '2026-08-16T00:00:00.000Z',
});

const manifest = JSON.stringify({
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

const applicationHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

const validFetch = (calls: Array<{ url: string; init: RequestInit }>): StagingFetch => (
  async (input, init) => {
    const url = input.toString();
    calls.push({ url, init });
    const pathname = new URL(url).pathname;
    if (pathname === '/health.json') {
      return new Response(health, { headers: { 'content-type': 'application/json' } });
    }
    if (pathname === '/catalog/manifest.json') {
      return new Response(manifest, {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-cache, no-store, must-revalidate',
        },
      });
    }
    return new Response('<!doctype html><title>App</title>', { headers: applicationHeaders });
  }
);

describe('staging smoke orchestration', () => {
  it('uses one fail-closed request policy and returns deterministic evidence', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const smoke = await probeStagingSmoke({
      origin: `${origin}/`,
      expectedRevision: revision,
      releaseManifestPath: '/catalog/manifest.json',
      fetchImpl: validFetch(calls),
      timeoutMs: 1_000,
    });

    expect(calls.map(call => call.url)).toEqual([
      origin,
      `${origin}/health.json`,
      `${origin}/catalog/manifest.json`,
    ]);
    expect(calls.every(call => call.init.redirect === 'error')).toBe(true);
    expect(calls.every(call => new Headers(call.init.headers).get('accept-encoding') === 'identity'))
      .toBe(true);
    expect(new Set(calls.map(call => call.init.signal)).size).toBe(1);
    expect(calls[0].init.signal?.aborted).toBe(true);
    expect(smoke.probes).toEqual([
      { name: 'application-document', passed: true },
      { name: 'health-metadata', passed: true },
      { name: 'catalog-manifest', passed: true },
    ]);
    expect(evaluateStagingSmoke(smoke)).toEqual({ status: 'passed', reasons: [] });
  });

  it('aborts sibling requests after one network failure', async () => {
    let callCount = 0;
    let abortedSiblings = 0;
    const fetchImpl: StagingFetch = async (_input, init) => {
      callCount += 1;
      if (callCount === 1) throw new Error('network failed');
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          abortedSiblings += 1;
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      });
    };

    await expect(probeStagingSmoke({
      origin,
      expectedRevision: revision,
      releaseManifestPath: '/catalog/manifest.json',
      fetchImpl,
      timeoutMs: 1_000,
    })).rejects.toThrow('network failed');
    expect(callCount).toBe(3);
    expect(abortedSiblings).toBe(2);
  });

  it('aborts all requests when the shared timeout expires', async () => {
    let aborted = 0;
    const fetchImpl: StagingFetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        aborted += 1;
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    });

    await expect(probeStagingSmoke({
      origin,
      expectedRevision: revision,
      releaseManifestPath: '/catalog/manifest.json',
      fetchImpl,
      timeoutMs: 5,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted).toBe(3);
  });

  it('returns failed probes for typed SPA fallbacks instead of treating them as success', async () => {
    const fetchImpl: StagingFetch = async (input) => {
      const pathname = new URL(input.toString()).pathname;
      if (pathname === '/') {
        return new Response('not html', { headers: { 'content-type': 'text/plain' } });
      }
      return new Response('<!doctype html><title>App</title>', {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-cache, no-store, must-revalidate',
        },
      });
    };
    const smoke = await probeStagingSmoke({
      origin,
      expectedRevision: revision,
      releaseManifestPath: '/catalog/manifest.json',
      fetchImpl,
    });

    expect(evaluateStagingSmoke(smoke)).toMatchObject({ status: 'failed' });
    expect(smoke.probes).toEqual([
      { name: 'application-document', passed: false },
      { name: 'health-metadata', passed: false },
      { name: 'catalog-manifest', passed: false },
    ]);
  });
});

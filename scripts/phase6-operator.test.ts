import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repo = path.resolve(__dirname, '..');
const hosting = JSON.parse(fs.readFileSync(path.join(repo, 'firebase.json'), 'utf8')).hosting as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const headersFor = (...sources: string[]) => Object.fromEntries(hosting.headers
  .filter(rule => sources.includes(rule.source))
  .flatMap(rule => rule.headers.map(header => [header.key, header.value])));

const origin = 'https://staging.example.test';
const revision = 'a'.repeat(40);
const releaseId = 'r-261124da6107eb25204587aa';
const servedManifestPath = `/catalog/english-core/${releaseId}/release-manifest.json`;
const servedManifest = fs.readFileSync(path.join(repo, 'public', servedManifestPath), 'utf8');
const spaShell = '<!doctype html><html lang="en"><head></head><body><div id="root"></div></body></html>';
const manifestHeaders = headersFor('**', '/catalog/**/release-manifest.json');

const savedArgv = [...process.argv];
afterEach(() => {
  process.argv.splice(0, process.argv.length, ...savedArgv);
  process.exitCode = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

// Models Firebase Hosting for this firebase.json: '**' rewrites a missing path to /index.html with 200,
// and header rules match the request path, so the manifest glob still adds no-store and a JSON type.
const runSmoke = async (manifestPath: string, manifestBody: (pathname: string) => string) => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/health.json') {
      return new Response(JSON.stringify({ revision }), { status: 200, headers: headersFor('/health.json') });
    }
    if (url.pathname === '/') return new Response(spaShell, { status: 200, headers: headersFor('**', '/') });
    return new Response(manifestBody(url.pathname), { status: 200, headers: manifestHeaders });
  }));
  vi.stubEnv('STAGING_ORIGIN', origin);
  vi.stubEnv('EXPECTED_REVISION', revision);
  vi.stubEnv('CATALOG_MANIFEST_PATH', manifestPath);
  process.argv.splice(2, process.argv.length - 2, 'smoke');
  let printed = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
    printed += chunk;
    return true;
  }) as never);
  await import('./phase6-operator');
  return JSON.parse(printed) as { status: string; reasons: string[] };
};

describe('phase 6 staging smoke', () => {
  it('passes only when the named release manifest is served', async () => {
    const result = await runSmoke(servedManifestPath, () => servedManifest);
    expect(result).toEqual({ status: 'passed', reasons: [] });
    expect(process.exitCode).toBeUndefined();
  });

  it('fails the manifest probe when Hosting answers a missing manifest with the SPA document', async () => {
    const missingPath = '/catalog/english-core/r-000000000000000000000000/release-manifest.json';
    expect(fs.existsSync(path.join(repo, 'public', missingPath))).toBe(false);
    const result = await runSmoke(missingPath, () => spaShell);
    expect(result).toEqual({ status: 'failed', reasons: ['probe:catalog-manifest'] });
    expect(process.exitCode).toBe(1);
  });

  it('fails the manifest probe when the served manifest belongs to another release', async () => {
    const otherPath = '/catalog/english-core/r-000000000000000000000000/release-manifest.json';
    const result = await runSmoke(otherPath, () => servedManifest);
    expect(result.reasons).toEqual(['probe:catalog-manifest']);
  });

  it('requires a manifest path that names the catalog and release', async () => {
    await expect(runSmoke('/catalog/english-core/release-manifest.json', () => servedManifest))
      .rejects.toThrow('CATALOG_MANIFEST_PATH');
  });
});
